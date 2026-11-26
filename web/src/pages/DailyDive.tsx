/**
 * Daily Trek — page orchestrator.
 *
 * Phase machine:
 *   loading → fetchDailySet()
 *   select  → JourneySelect (pick which road; no prompts/gold shown)
 *   play    → alternates two sub-phases per prompt:
 *               "prompt" → DailyPlay (name countries on the world map)
 *               "leg"    → JourneyMap, the character advances along the route to
 *                          the new position, revealing any landmarks passed
 *   finish  → postFinish → bank gold + saveResult + markPlayed
 *   recap   → DailyRecap (result + percentile + wallet)
 *
 * One-and-done: if `localDailyStore.isPlayedToday`, we show the saved recap
 * instead of letting the player replay.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import JourneySelect from "../features/daily/JourneySelect";
import DailyPlay from "../features/daily/DailyPlay";
import JourneyMap from "../features/daily/JourneyMap";
import DailyRecap from "../features/daily/DailyRecap";
import { fetchDailySet, postFinish } from "../features/daily/dailyApi";
import { localDailyStore } from "../features/daily/DailyStore";
import type {
  DailySet,
  DailyPromptResult,
  DailyRunResult,
  JourneyId,
} from "../features/daily/contract";
import { DAILY_PROMPT_MAX, DAILY_NAME_BONUS } from "../features/daily/contract";
import { capturePercentile } from "../features/daily/percentile";
import { promptScore, pick } from "../features/daily/runScore";
import { promptTier, FULL_CLEAR_MESSAGE } from "../features/daily/tiers";

type Phase = "loading" | "select" | "play" | "finish" | "recap";
type SubPhase = "prompt" | "leg";

/**
 * TESTING: bypass the one-and-done localStorage lock so a run can be replayed.
 * On in dev, or with `?replay` in the URL. When on, we also skip ALL persistence
 * (no played-lock, no saved result, no gold banked) so repeated test runs don't
 * accumulate or lock anything. Production (built, no `?replay`) is one-and-done.
 */
const ALLOW_REPLAY =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("replay"));

/** Read the user's reduced-motion preference once (SSR-guarded). When true, we
 *  don't trap the player behind the travel animation — consistent with the
 *  JourneyMap snapping to its target instantly. */
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Client-side percentile fallback used only if /daily/finish is unreachable.
 *  Approximates the day's score max from the per-prompt pool sizes we saw, then
 *  runs it through the SAME capturePercentile S-curve the server uses — a linear
 *  ratio*100 here would show a different number than the authoritative finish. */
function fallbackPercentile(result: DailyRunResult): number {
  const dayMax = result.perPrompt.reduce(
    (s, r) => s + DAILY_PROMPT_MAX + DAILY_NAME_BONUS * Math.max(0, r.total),
    0,
  );
  const ratio = dayMax > 0 ? Math.min(1, result.points / dayMax) : 0;
  return capturePercentile(ratio);
}

function assembleResult(
  dailyDate: string,
  journey: JourneyId,
  perPrompt: DailyPromptResult[],
): DailyRunResult {
  // promptScore is already integer per prompt, so the sum matches the server's
  // Σ round(...) exactly — no final rounding (which would reintroduce drift).
  const points = perPrompt.reduce((sum, r) => sum + promptScore(r), 0);
  return {
    runId: crypto.randomUUID(),
    dailyDate,
    journey,
    points,
    perPrompt,
    // Placeholders — the server reconciles gold/outcome at /daily/finish.
    gold: 0,
    outcome: "died",
    playerId: localDailyStore.getPlayerId(),
  };
}

export default function DailyDive() {
  const navigate = useNavigate();
  const goHome = useCallback(() => navigate("/"), [navigate]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [set, setSet] = useState<DailySet | null>(null);
  const [journeyId, setJourneyId] = useState<JourneyId | null>(null);

  // Play sub-state: which prompt, and whether we're naming or travelling.
  const [subPhase, setSubPhase] = useState<SubPhase>("prompt");
  const [legIndex, setLegIndex] = useState(0);
  const [legArrived, setLegArrived] = useState(false); // the leg's travel tween finished

  const perPromptRef = useRef<DailyPromptResult[]>([]);
  const cumPointsRef = useRef(0);
  const prevProgressRef = useRef(0); // committed progress at the start of this leg
  const legTargetRef = useRef(0); // progress this leg animates to
  const finishingRef = useRef(false);
  // Idempotency latch for "Continue": holds the legIndex we've already advanced
  // from, so a fast double-click can't advance twice (and skip a prompt). Reset
  // to -1 when the next prompt mounts. A matching legArrived guard lives below.
  const advancedFromRef = useRef(-1);
  const arrivedForLegRef = useRef(-1);

  const [percentile, setPercentile] = useState(0);
  const [walletBalance, setWalletBalance] = useState(() => localDailyStore.getWallet());
  const [recapResult, setRecapResult] = useState<DailyRunResult | null>(null);
  const [recapAnswers, setRecapAnswers] = useState<
    Record<string, { iso: string; name: string }[]> | undefined
  >(undefined);
  const [recapGoldLost, setRecapGoldLost] = useState(0);
  // Set when /daily/finish was unreachable and the recap is a local, unofficial
  // result (no server reconciliation / no banked gold).
  const [finishOffline, setFinishOffline] = useState(false);

  // Persistent HUD: total points (updated only when a leg's walk ends, never
  // during the naming challenge — so the per-prompt score stays a surprise) and
  // gold collected at landmarks so far.
  const [hudPoints, setHudPoints] = useState(0);
  const [hudGold, setHudGold] = useState(0);
  const runGoldRef = useRef(0);

  // Load today's set; if already played, jump to the saved recap.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchDailySet();
      if (cancelled) return;
      setSet(loaded);
      const saved = localDailyStore.getResult(loaded.dailyDate);
      if (!ALLOW_REPLAY && localDailyStore.isPlayedToday(loaded.dailyDate) && saved) {
        setRecapResult(saved);
        setPercentile(fallbackPercentile(saved));
        setWalletBalance(localDailyStore.getWallet());
        setPhase("recap");
      } else {
        setPhase("select");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback((id: JourneyId) => {
    perPromptRef.current = [];
    cumPointsRef.current = 0;
    prevProgressRef.current = 0;
    legTargetRef.current = 0;
    advancedFromRef.current = -1;
    arrivedForLegRef.current = -1;
    runGoldRef.current = 0;
    setHudPoints(0);
    setHudGold(0);
    setJourneyId(id);
    setLegIndex(0);
    setSubPhase("prompt");
    setPhase("play");
  }, []);

  // Gold ticks up as landmarks are reached; points are revealed when the leg's
  // walk finishes (handled at the JourneyMap's onArrived below).
  const handleLandmark = useCallback((gold: number) => {
    runGoldRef.current += gold;
    setHudGold(runGoldRef.current);
  }, []);
  const markLegArrived = useCallback(
    (index: number) => {
      // onArrived can fire more than once (a re-tween, StrictMode double-invoke).
      // Run the arrival bookkeeping once per leg; reset in handlePromptComplete
      // when the next leg begins.
      if (arrivedForLegRef.current === index) return;
      arrivedForLegRef.current = index;
      setLegArrived(true);
      setHudPoints(Math.round(cumPointsRef.current));
    },
    [],
  );
  const handleLegArrived = useCallback(() => {
    markLegArrived(legIndex);
  }, [legIndex, markLegArrived]);

  const runFinish = useCallback(
    (result: DailyRunResult) => {
      if (finishingRef.current || !set || !journeyId) return;
      finishingRef.current = true;
      setPhase("finish");
      void (async () => {
        let finalResult = result;
        let pct = fallbackPercentile(result);
        let answers: Record<string, { iso: string; name: string }[]> | undefined;
        let goldLost = 0;
        let offline = false;
        try {
          const res = await postFinish({ result });
          finalResult = res.result;
          pct = res.percentile;
          answers = res.answers;
          goldLost = res.goldLost ?? 0;
        } catch (err) {
          console.warn("[DailyDive] finish failed — using client fallback.", err);
          offline = true;
          // Honest fallback: derive the outcome from the local progress the
          // player actually achieved (the same cumulative points vs. journey
          // distance the live leg animation used). We can't bank gold without
          // the server, so keep it at 0 — but don't mislabel a reached run.
          const { journey } = pick(set, journeyId);
          const reached =
            journey.distance > 0 ? cumPointsRef.current >= journey.distance : true;
          finalResult = { ...result, outcome: reached ? "arrived" : "died" };
        }
        setFinishOffline(offline);
        // Replay/testing: don't persist anything (no gold banked, no lock). Clamp
        // the display balance the same way addGold does (non-negative, rounded)
        // so a malformed gold value can't show a negative replay wallet.
        const newBalance = ALLOW_REPLAY
          ? localDailyStore.getWallet() + Math.max(0, Math.round(finalResult.gold))
          : localDailyStore.addGold(finalResult.gold);
        if (!ALLOW_REPLAY) {
          localDailyStore.saveResult(finalResult);
          localDailyStore.markPlayed(finalResult.dailyDate);
        }
        setRecapResult(finalResult);
        setRecapAnswers(answers);
        setRecapGoldLost(goldLost);
        setPercentile(pct);
        setWalletBalance(newBalance);
        setPhase("recap");
      })();
    },
    [set, journeyId],
  );

  // A prompt ended: bank its result, compute the new progress, travel the leg.
  const handlePromptComplete = useCallback(
    (result: DailyPromptResult) => {
      if (!set || !journeyId) return;
      perPromptRef.current = [...perPromptRef.current, result];
      cumPointsRef.current += promptScore(result);
      const { journey } = pick(set, journeyId);
      legTargetRef.current =
        journey.distance > 0 ? Math.min(1, cumPointsRef.current / journey.distance) : 1;
      setLegArrived(false);
      setSubPhase("leg");
      // Reduced motion: the JourneyMap snaps to its target instantly, so don't
      // trap the player behind the (CSS-neutralised) travel animation. Run the
      // arrival bookkeeping now — HUD points update and the reveal shows — so
      // Continue is enabled immediately without waiting on onArrived.
      if (PREFERS_REDUCED_MOTION) markLegArrived(legIndex);
    },
    [set, journeyId, legIndex, markLegArrived],
  );

  // Continue past the leg: either the next prompt, or finish after the last.
  const handleContinue = useCallback(() => {
    if (!set || !journeyId) return;
    // Idempotency: only advance once per leg. A fast double-click would
    // otherwise bump legIndex twice and silently skip a prompt. (The last leg
    // is additionally guarded by runFinish's finishingRef.)
    if (advancedFromRef.current === legIndex) return;
    advancedFromRef.current = legIndex;
    prevProgressRef.current = legTargetRef.current;
    if (legIndex + 1 >= set.prompts.length) {
      runFinish(assembleResult(set.dailyDate, journeyId, perPromptRef.current));
    } else {
      setLegIndex((i) => i + 1);
      setSubPhase("prompt");
    }
  }, [set, journeyId, legIndex, runFinish]);

  // Persistent run HUD — running points + gold, top-right, over play and legs.
  const hud = (
    <div
      data-testid="daily-hud"
      className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col items-end gap-1"
    >
      <div className="flex items-center gap-2 rounded-lg bg-[var(--color-chrome)]/85 px-3 py-1 chrome-ink backdrop-blur">
        <span className="text-[10px] uppercase tracking-wider opacity-70">Points</span>
        <span data-testid="hud-points" className="font-display text-lg font-black tabular-nums">
          {hudPoints.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-[var(--color-chrome)]/85 px-3 py-1 chrome-ink backdrop-blur">
        <span className="text-[10px] uppercase tracking-wider opacity-70">Gold</span>
        <span
          data-testid="hud-gold"
          className="font-display text-lg font-black tabular-nums"
          style={{ color: "var(--color-chrome-gold)" }}
        >
          {hudGold.toLocaleString()}
        </span>
      </div>
    </div>
  );

  if (phase === "loading" || !set) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface">
        <p role="status" aria-live="polite" aria-busy="true" className="text-muted">
          Charting today&apos;s route…
        </p>
      </main>
    );
  }

  if (phase === "select") {
    return (
      <main className="min-h-dvh bg-surface">
        <JourneySelect set={set} onSelect={handleSelect} />
      </main>
    );
  }

  if ((phase === "play" || phase === "finish") && journeyId) {
    const { journey, route } = pick(set, journeyId);

    // Travelling leg: the character advances; a panel shows the leg result.
    if (subPhase === "leg" || phase === "finish") {
      const justResult = perPromptRef.current[legIndex];
      const start = prevProgressRef.current;
      const target = legTargetRef.current;
      const isLast = legIndex + 1 >= set.prompts.length;
      const gainedPts = justResult ? promptScore(justResult) : 0;
      const tier = justResult ? promptTier(justResult.named, justResult.total) : null;
      // Reaching the destination (progress hits 100%) is a win whenever it
      // happens — on the final leg, or EARLY with prompts to spare — so the
      // trekker celebrates there. Only a final leg that fell short is a death.
      const reachedDest = target >= 1 - 1e-6;
      const legOutcome: "arrived" | "died" | undefined = legArrived
        ? reachedDest
          ? "arrived"
          : isLast
            ? "died"
            : undefined
        : undefined;
      // Reduced motion: never gate Continue on the travel tween (the map snaps
      // instantly and arrival bookkeeping already ran in handlePromptComplete).
      const travelling = !PREFERS_REDUCED_MOTION && !legArrived && phase !== "finish";
      return (
        <main className="relative h-dvh bg-surface">
          <JourneyMap
            route={route}
            destination={set.destination}
            landmarks={journey.landmarks}
            from={start}
            progress={target}
            onArrived={handleLegArrived}
            onLandmark={handleLandmark}
            outcome={legOutcome}
            className="absolute inset-0"
          />
          {hud}

          {/* Flashy tier reveal — big, top-middle, only AFTER the walk finishes. */}
          {legArrived && justResult && tier && (
            <div
              key={legIndex}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="pointer-events-none absolute inset-x-0 top-14 z-20 flex flex-col items-center gap-2 px-8 text-center"
            >
              <div
                className="daily-tier-pop max-w-full break-words font-display font-black uppercase leading-[1.05]"
                style={{ color: tier.color, fontSize: "clamp(1.4rem, 8vw, 3.5rem)" }}
              >
                {tier.label}
              </div>
              <div
                className="daily-recap-pop rounded-full bg-[var(--color-chrome)]/85 px-4 py-1 text-base font-bold chrome-ink backdrop-blur"
                style={{ animationDelay: "120ms" }}
              >
                +{gainedPts} pts · {justResult.named}
                {justResult.total ? `/${justResult.total}` : ""} named
              </div>
              {tier.full && (
                <div
                  className="daily-tier-pop text-sm font-black uppercase tracking-[0.2em]"
                  style={{ color: tier.color, animationDelay: "200ms" }}
                >
                  {FULL_CLEAR_MESSAGE}
                </div>
              )}
            </div>
          )}

          {/* Reached the destination (possibly early): the gold is banked/safe,
              and the rest of the run is purely for points. A subtle gold-rimmed
              banner marks the moment. */}
          {reachedDest && legArrived && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
              <div className="daily-recap-pop rounded-full border border-[var(--color-chrome-gold)]/60 bg-[var(--color-chrome)]/90 px-4 py-1.5 text-center text-sm font-semibold chrome-ink backdrop-blur">
                <span style={{ color: "var(--color-chrome-gold)" }}>Reached {set.destination.name}</span>
                <span className="opacity-75"> — gold secured</span>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-[var(--color-chrome-gold)]/40 bg-[var(--color-chrome)]/90 px-5 py-4 text-center chrome-ink backdrop-blur">
              <p className="text-xs uppercase tracking-wide opacity-70">
                Leg {legIndex + 1} of {set.prompts.length}
              </p>
              {/* Overall progress toward the destination. */}
              <div className="w-full">
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full rounded-full bg-[var(--color-chrome-gold)] transition-[width] duration-[2800ms] ease-out"
                    style={{ width: `${Math.round((legArrived ? target : start) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs opacity-70">
                  {reachedDest
                    ? "Gold secured — the rest of the run is for points"
                    : `${Math.round(target * 100)}% of the way to ${set.destination.name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleContinue}
                disabled={travelling || phase === "finish"}
                data-testid="leg-continue"
                className="mt-1 rounded-lg bg-[#f4efe3] px-6 py-2 font-semibold text-[var(--color-chrome)] transition hover:brightness-105 disabled:opacity-60"
              >
                {phase === "finish"
                  ? "Arriving…"
                  : travelling
                    ? "Travelling…"
                    : isLast
                      ? reachedDest
                        ? "See your result"
                        : "Reach the destination"
                      : reachedDest
                        ? "Keep going for points"
                        : "Press on"}
              </button>
            </div>
          </div>
        </main>
      );
    }

    // Naming a prompt. Re-mounted per prompt (key) so the clock re-seeds.
    return (
      <main className="relative h-dvh bg-surface">
        <DailyPlay
          key={legIndex}
          dailyDate={set.dailyDate}
          prompt={set.prompts[legIndex]}
          index={legIndex}
          total={set.prompts.length}
          route={route}
          destination={set.destination}
          progress={prevProgressRef.current}
          onComplete={handlePromptComplete}
        />
        {hud}
      </main>
    );
  }

  if (phase === "recap" && recapResult) {
    // Show the final journey state behind the recap so it overlays the map
    // (where you arrived, or where you died) instead of replacing it.
    const { journey, route } = pick(set, journeyId ?? recapResult.journey);
    const endProgress = journey.distance > 0 ? Math.min(1, recapResult.points / journey.distance) : 0;
    return (
      <main className="relative h-dvh bg-surface">
        <JourneyMap
          route={route}
          destination={set.destination}
          landmarks={journey.landmarks}
          from={endProgress}
          progress={endProgress}
          outcome={recapResult.outcome}
          className="absolute inset-0"
        />
        <DailyRecap
          result={recapResult}
          percentile={percentile}
          progress={endProgress}
          answers={recapAnswers}
          goldLost={recapGoldLost}
          prompts={set.prompts}
          walletBalance={walletBalance}
          onClose={goHome}
        />
        {finishOffline && (
          <div
            role="alert"
            data-testid="daily-recap-offline"
            className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4"
          >
            <p className="rounded-lg bg-[var(--color-chrome)]/90 px-3 py-1 text-center text-xs text-[var(--color-chrome-ink)] backdrop-blur">
              Couldn&apos;t reach the server — showing an unofficial result.
            </p>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface">
      <button type="button" onClick={goHome} className="rounded-xl bg-surface-raised px-5 py-3">
        Back home
      </button>
    </main>
  );
}
