/**
 * Daily Dive — page orchestrator (Track C).
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
  DailyJourney,
  DailyRoute,
  DailyPromptResult,
  DailyRunResult,
  JourneyId,
} from "../features/daily/contract";
import { DAILY_PROMPT_MAX, DAILY_NAME_BONUS } from "../features/daily/contract";

/**
 * A prompt's contribution to the run: its capture base (0..150, clamped) plus a
 * flat bonus per named country (clamped to the pool size). Mirrors the server's
 * reconcile so the live leg animation agrees with the authoritative finish.
 */
function promptScore(r: DailyPromptResult): number {
  const base = Math.max(0, Math.min(DAILY_PROMPT_MAX, r.points));
  const named = r.total > 0 ? Math.min(Math.max(0, r.named), r.total) : Math.max(0, r.named);
  return base + DAILY_NAME_BONUS * named;
}

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

function pick(set: DailySet, id: JourneyId): { journey: DailyJourney; route: DailyRoute } {
  const journey = set.journeys.find((j) => j.id === id)!;
  const route = set.routes.find((r) => r.journeyId === id)!;
  return { journey, route };
}

/** Client-side percentile fallback used only if /daily/finish is unreachable.
 *  Approximates the day's score max from the per-prompt pool sizes we saw. */
function fallbackPercentile(result: DailyRunResult): number {
  const dayMax = result.perPrompt.reduce(
    (s, r) => s + DAILY_PROMPT_MAX + DAILY_NAME_BONUS * Math.max(0, r.total),
    0,
  );
  const ratio = dayMax > 0 ? Math.min(1, result.points / dayMax) : 0;
  return Math.round(Math.min(99, Math.max(1, ratio * 100)));
}

function assembleResult(
  dailyDate: string,
  journey: JourneyId,
  perPrompt: DailyPromptResult[],
): DailyRunResult {
  const points = Math.round(perPrompt.reduce((sum, r) => sum + promptScore(r), 0));
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

  const [percentile, setPercentile] = useState(0);
  const [walletBalance, setWalletBalance] = useState(() => localDailyStore.getWallet());
  const [recapResult, setRecapResult] = useState<DailyRunResult | null>(null);

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
    setJourneyId(id);
    setLegIndex(0);
    setSubPhase("prompt");
    setPhase("play");
  }, []);

  const runFinish = useCallback(
    (result: DailyRunResult) => {
      if (finishingRef.current || !set || !journeyId) return;
      finishingRef.current = true;
      setPhase("finish");
      void (async () => {
        let finalResult = result;
        let pct = fallbackPercentile(result);
        try {
          const res = await postFinish({ result });
          finalResult = res.result;
          pct = res.percentile;
        } catch (err) {
          console.warn("[DailyDive] finish failed — using client fallback.", err);
        }
        // Replay/testing: don't persist anything (no gold banked, no lock).
        const newBalance = ALLOW_REPLAY
          ? localDailyStore.getWallet() + finalResult.gold
          : localDailyStore.addGold(finalResult.gold);
        if (!ALLOW_REPLAY) {
          localDailyStore.saveResult(finalResult);
          localDailyStore.markPlayed(finalResult.dailyDate);
        }
        setRecapResult(finalResult);
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
    },
    [set, journeyId],
  );

  // Continue past the leg: either the next prompt, or finish after the last.
  const handleContinue = useCallback(() => {
    if (!set || !journeyId) return;
    prevProgressRef.current = legTargetRef.current;
    if (legIndex + 1 >= set.prompts.length) {
      runFinish(assembleResult(set.dailyDate, journeyId, perPromptRef.current));
    } else {
      setLegIndex((i) => i + 1);
      setSubPhase("prompt");
    }
  }, [set, journeyId, legIndex, runFinish]);

  if (phase === "loading" || !set) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface">
        <p className="text-muted">Charting today&apos;s route…</p>
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
      const landmarksPassed = journey.landmarks.filter(
        (l) => l.atFraction > start && l.atFraction <= target,
      ).length;
      const isLast = legIndex + 1 >= set.prompts.length;
      const gainedPts = justResult ? Math.round(promptScore(justResult)) : 0;
      const travelling = !legArrived && phase !== "finish";
      return (
        <main className="relative h-dvh bg-surface">
          <JourneyMap
            route={route}
            destination={set.destination}
            landmarks={journey.landmarks}
            from={start}
            progress={target}
            onArrived={() => setLegArrived(true)}
            className="absolute inset-0"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-[var(--color-chrome-gold)]/40 bg-[var(--color-chrome)]/90 px-5 py-4 text-center chrome-ink backdrop-blur">
              <p className="text-xs uppercase tracking-wide opacity-70">
                Leg {legIndex + 1} of {set.prompts.length}
              </p>
              <p className="text-sm">
                {justResult ? `Named ${justResult.named}${justResult.total ? ` of ${justResult.total}` : ""} · ` : ""}
                <span className="font-semibold text-[var(--color-chrome-gold)]">+{gainedPts} distance</span>
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
                  {Math.round(target * 100)}% of the way to {set.destination.name}
                </p>
              </div>
              {landmarksPassed > 0 && legArrived && (
                <p className="text-sm font-semibold text-[var(--color-chrome-gold)]">Landmark reached!</p>
              )}
              <button
                type="button"
                onClick={handleContinue}
                disabled={travelling || phase === "finish"}
                data-testid="leg-continue"
                className="mt-1 rounded-lg bg-[#f4efe3] px-6 py-2 font-semibold text-[var(--color-chrome)] transition hover:brightness-105 disabled:opacity-60"
              >
                {phase === "finish" ? "Arriving…" : travelling ? "Travelling…" : isLast ? "Reach the destination" : "Press on"}
              </button>
            </div>
          </div>
        </main>
      );
    }

    // Naming a prompt. Re-mounted per prompt (key) so the clock re-seeds.
    return (
      <main className="h-dvh bg-surface">
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
          className="absolute inset-0"
        />
        <DailyRecap
          result={recapResult}
          percentile={percentile}
          walletBalance={walletBalance}
          onClose={goHome}
        />
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
