/**
 * Daily Dive — page orchestrator (Track C).
 *
 * Owns the phase machine and composes the Track D (JourneyMap) and Track E
 * (DailyRecap) components via props so those tracks never edit this file:
 *
 *   loading        → fetchDailySet()
 *   played-already → recap of the saved run (one-and-done per day)
 *   select         → JourneySelect (make the wager)
 *   play           → DailyPlay + live JourneyMap (traveler eases to progress)
 *   finish         → postFinish → bank gold + saveResult + markPlayed
 *   recap          → DailyRecap (result + percentile + wallet)
 *
 * One-and-done: if `localDailyStore.isPlayedToday`, we never let the player
 * replay — we show the saved result's recap instead.
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
  DailyRunResult,
  JourneyId,
} from "../features/daily/contract";

type Phase = "loading" | "select" | "play" | "finish" | "recap";

/** The route + journey for a chosen id. */
function pick(set: DailySet, id: JourneyId): { journey: DailyJourney; route: DailyRoute } {
  const journey = set.journeys.find((j) => j.id === id)!;
  const route = set.routes.find((r) => r.journeyId === id)!;
  return { journey, route };
}

/**
 * A plausible client-side percentile fallback used only if /daily/finish is
 * unreachable (dev / offline). Maps capture ratio (points ÷ a rough theoretical
 * max) to a percentile on a gentle curve. The server's hardcoded curve is
 * authoritative when reachable.
 */
function fallbackPercentile(result: DailyRunResult, journey: DailyJourney): number {
  const ratio = journey.distance > 0 ? Math.min(1, result.points / (journey.distance * 1.5)) : 0;
  return Math.round(Math.min(99, Math.max(1, ratio * 100)));
}

export default function DailyDive() {
  const navigate = useNavigate();
  const goHome = useCallback(() => navigate("/"), [navigate]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [set, setSet] = useState<DailySet | null>(null);
  const [journeyId, setJourneyId] = useState<JourneyId | null>(null);
  const [progress, setProgress] = useState(0);
  const [percentile, setPercentile] = useState(0);
  const [walletBalance, setWalletBalance] = useState(() => localDailyStore.getWallet());
  const [recapResult, setRecapResult] = useState<DailyRunResult | null>(null);
  // Guards the finish round-trip from running twice (StrictMode / re-render).
  const finishingRef = useRef(false);

  // Load today's set; if already played, jump straight to the saved recap.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchDailySet();
      if (cancelled) return;
      setSet(loaded);
      const saved = localDailyStore.getResult(loaded.dailyDate);
      if (localDailyStore.isPlayedToday(loaded.dailyDate) && saved) {
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

  const handleSelect = useCallback((id: JourneyId) => {
    setJourneyId(id);
    setProgress(0);
    setPhase("play");
  }, []);

  const handleProgress = useCallback((p: number) => {
    setProgress(p);
  }, []);

  // DailyPlay hands us the assembled run; reconcile it with the server, bank the
  // gold, persist, lock the day, then show the recap.
  const handleFinish = useCallback(
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
        const newBalance = localDailyStore.addGold(finalResult.gold);
        localDailyStore.saveResult(finalResult);
        localDailyStore.markPlayed(finalResult.dailyDate);
        setRecapResult(finalResult);
        setPercentile(pct);
        setWalletBalance(newBalance);
        setPhase("recap");
      })();
    },
    [set, journeyId],
  );

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
    return (
      <main className="grid h-dvh grid-rows-[1fr_auto] bg-surface sm:grid-rows-1 sm:grid-cols-[1fr_minmax(0,22rem)]">
        {/* Live traveler map (Track D), driven by play progress. */}
        <div className="relative order-2 min-h-0 sm:order-1">
          <JourneyMap
            route={route}
            destination={set.destination}
            landmarks={journey.landmarks}
            progress={progress}
          />
        </div>
        {/* The 5-prompt loop. In the brief finish phase it stays mounted behind
            the reconciliation round-trip, then the recap replaces the page. */}
        <div className="order-1 min-h-0 sm:order-2">
          <DailyPlay
            set={set}
            journey={journey}
            onProgress={handleProgress}
            onFinish={handleFinish}
          />
        </div>
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

  // Defensive fallback (e.g. finish without a result): send the player home.
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface">
      <button type="button" onClick={goHome} className="rounded-xl bg-surface-raised px-5 py-3">
        Back home
      </button>
    </main>
  );
}
