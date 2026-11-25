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

/** Client-side percentile fallback used only if /daily/finish is unreachable. */
function fallbackPercentile(result: DailyRunResult, journey: DailyJourney): number {
  const ratio = journey.distance > 0 ? Math.min(1, result.points / (journey.distance * 1.5)) : 0;
  return Math.round(Math.min(99, Math.max(1, ratio * 100)));
}

function assembleResult(
  dailyDate: string,
  journey: JourneyId,
  perPrompt: DailyPromptResult[],
): DailyRunResult {
  const points = perPrompt.reduce((sum, r) => sum + r.points, 0);
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
  const [progress, setProgress] = useState(0); // animated traveler position 0..1

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
        setPercentile(fallbackPercentile(saved, pick(loaded, saved.journey).journey));
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

  // When a leg begins, animate the traveler from the committed start to the new
  // target (a frame later, so the CSS transition in JourneyMap plays).
  useEffect(() => {
    if (phase !== "play" || subPhase !== "leg") return;
    const id = requestAnimationFrame(() => setProgress(legTargetRef.current));
    return () => cancelAnimationFrame(id);
  }, [phase, subPhase, legIndex]);

  const handleSelect = useCallback((id: JourneyId) => {
    perPromptRef.current = [];
    cumPointsRef.current = 0;
    prevProgressRef.current = 0;
    legTargetRef.current = 0;
    setJourneyId(id);
    setLegIndex(0);
    setProgress(0);
    setSubPhase("prompt");
    setPhase("play");
  }, []);

  const runFinish = useCallback(
    (result: DailyRunResult) => {
      if (finishingRef.current || !set || !journeyId) return;
      finishingRef.current = true;
      setPhase("finish");
      void (async () => {
        const { journey } = pick(set, journeyId);
        let finalResult = result;
        let pct = fallbackPercentile(result, journey);
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
      cumPointsRef.current += result.points;
      const { journey } = pick(set, journeyId);
      legTargetRef.current =
        journey.distance > 0 ? Math.min(1, cumPointsRef.current / journey.distance) : 1;
      setProgress(prevProgressRef.current); // start the leg where we left off
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
      return (
        <main className="relative h-dvh bg-surface">
          <JourneyMap
            route={route}
            destination={set.destination}
            landmarks={journey.landmarks}
            progress={progress}
            className="absolute inset-0"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <div className="pointer-events-auto flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-[var(--color-chrome-gold)]/40 bg-[var(--color-chrome)]/90 px-5 py-4 text-center chrome-ink backdrop-blur">
              <p className="text-xs uppercase tracking-wide opacity-70">
                Leg {legIndex + 1} of {set.prompts.length}
              </p>
              {justResult && (
                <p className="text-sm">
                  You named {justResult.named}
                  {justResult.total ? ` of ${justResult.total}` : ""} this leg.
                </p>
              )}
              {landmarksPassed > 0 && (
                <p className="text-sm font-semibold text-[var(--color-chrome-gold)]">
                  Landmark reached!
                </p>
              )}
              <button
                type="button"
                onClick={handleContinue}
                disabled={phase === "finish"}
                data-testid="leg-continue"
                className="mt-1 rounded-lg bg-[#f4efe3] px-6 py-2 font-semibold text-[var(--color-chrome)] transition hover:brightness-105 disabled:opacity-60"
              >
                {phase === "finish" ? "Arriving…" : isLast ? "Reach the destination" : "Press on"}
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
    return (
      <main className="min-h-dvh bg-surface">
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
