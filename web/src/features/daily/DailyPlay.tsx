/**
 * Daily Dive — the 5-prompt run (Track C).
 *
 * Walks the chosen journey's five prompts in sequence. For each prompt it shows
 * the label, a feed-the-clock meter (useFeedClock), an answer input, and a
 * WorldMap highlighting the countries the player has named for THIS prompt.
 *
 * On submit it round-trips `postAnswer` (the only call that touches the secret
 * valid set). A valid, not-yet-named answer lights its country up, adds its
 * points, and feeds the clock. The server is stateless, so DEDUP IS CLIENT-SIDE:
 * we never re-count an iso already named this prompt.
 *
 * "Next" early-advances (forfeiting remaining time); expiry auto-advances. After
 * prompt 5 it assembles a DB-ready `DailyRunResult` (placeholder gold/outcome —
 * the server reconciles those at /daily/finish) and hands it to the page via
 * `onFinish`. Live progress (0..1 toward the journey distance + cumulative
 * points) is reported through `onProgress` so the page can animate the traveler.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorldMap from "../../components/WorldMap";
import AnswerBar from "../match/AnswerBar";
import { useFeedClock } from "./useFeedClock";
import { postAnswer, RateLimitedError } from "./dailyApi";
import { localDailyStore } from "./DailyStore";
import { DAILY_BASE_SECONDS } from "./contract";
import type {
  DailySet,
  DailyJourney,
  DailyPromptResult,
  DailyRunResult,
} from "./contract";

/** Mutable tally for one prompt as the player names countries. */
interface PromptTally {
  /** Lowercase iso codes named this prompt (client-side dedup). */
  named: Set<string>;
  /** Points accrued this prompt (pre-completion-bonus). */
  points: number;
  /** Total valid answers for this prompt, from the latest answer response. */
  total: number;
}

function emptyTally(): PromptTally {
  return { named: new Set(), points: 0, total: 0 };
}

export interface DailyPlayProps {
  set: DailySet;
  journey: DailyJourney;
  /** Live progress for the traveler: fraction 0..1 of the journey distance
   *  covered, plus cumulative run points. Called as points accrue. */
  onProgress: (progress: number, cumulativePoints: number) => void;
  /** The assembled run (placeholder gold/outcome; server reconciles at finish). */
  onFinish: (result: DailyRunResult) => void;
  className?: string;
}

export default function DailyPlay({
  set,
  journey,
  onProgress,
  onFinish,
  className,
}: DailyPlayProps) {
  const prompts = set.prompts;
  const [index, setIndex] = useState(0);
  const prompt = prompts[index];

  // Per-prompt tallies, one slot per prompt. Kept in a ref (source of truth for
  // assembling the result) mirrored into state so the HUD re-renders.
  const talliesRef = useRef<PromptTally[]>(prompts.map(() => emptyTally()));
  const [tally, setTally] = useState<PromptTally>(() => talliesRef.current[0]);

  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [rejectSignal, setRejectSignal] = useState(0);
  const [acceptSignal, setAcceptSignal] = useState(0);
  const [clearSignal, setClearSignal] = useState(0);
  // Disable the input briefly while a /daily/answer round-trip is in flight.
  const [submitting, setSubmitting] = useState(false);

  // Cumulative points across all prompts so far (for traveler progress). Kept
  // as explicit state, bumped by each newly-scored answer.
  const [cumulativePoints, setCumulativePoints] = useState(0);

  // Report progress whenever cumulative points change. distance==0 guard avoids
  // a divide-by-zero; clamp to 1 so an over-performing run doesn't overshoot.
  useEffect(() => {
    const progress = journey.distance > 0 ? Math.min(1, cumulativePoints / journey.distance) : 0;
    onProgress(progress, cumulativePoints);
  }, [cumulativePoints, journey.distance, onProgress]);

  /** Snapshot every prompt's tally into the DB-ready per-prompt result shape. */
  const buildResult = useCallback((): DailyRunResult => {
    const perPrompt: DailyPromptResult[] = prompts.map((p, i) => {
      const t = talliesRef.current[i];
      return { promptId: p.id, named: t.named.size, total: t.total, points: t.points };
    });
    const points = perPrompt.reduce((sum, r) => sum + r.points, 0);
    return {
      runId: crypto.randomUUID(),
      dailyDate: set.dailyDate,
      journey: journey.id,
      points,
      perPrompt,
      // Placeholders: the server reconciles completion bonuses, gold and outcome
      // against the chosen journey at /daily/finish.
      gold: 0,
      outcome: "died",
      playerId: localDailyStore.getPlayerId(),
    };
  }, [prompts, set.dailyDate, journey.id]);

  /** Advance to the next prompt, or finish after the last. */
  const advance = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= prompts.length) {
        onFinish(buildResult());
        return i; // stay; the page swaps us out for the finish phase.
      }
      setTally(talliesRef.current[next]);
      setClearSignal((s) => s + 1);
      setRejectMsg(null);
      return next;
    });
  }, [prompts.length, onFinish, buildResult]);

  // Expiry auto-advances. The clock is re-armed on the next prompt via reset().
  const clock = useFeedClock(advance);

  // Re-arm the clock at the START of each prompt (forfeiting the prior prompt's
  // remaining time — feed-the-clock never banks across prompts).
  useEffect(() => {
    clock.reset();
    // Only on prompt change; clock.reset is stable (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const handleSubmit = useCallback(
    (text: string): boolean => {
      if (submitting) return false; // keep the text; one round-trip at a time.
      setSubmitting(true);
      setRejectMsg(null);
      void (async () => {
        try {
          const res = await postAnswer({
            dailyDate: set.dailyDate,
            promptId: prompt.id,
            answer: text,
          });
          const cur = talliesRef.current[index];
          if (res.promptTotal !== undefined) cur.total = res.promptTotal;

          if (res.valid && res.iso) {
            const iso = res.iso.toLowerCase();
            if (cur.named.has(iso)) {
              // Already named this prompt — no points, no time (client dedup).
              setRejectMsg("Already named");
              setRejectSignal((s) => s + 1);
            } else {
              const earned = res.points ?? 0;
              cur.named.add(iso);
              cur.points += earned;
              setCumulativePoints((p) => p + earned);
              setAcceptSignal((s) => s + 1);
              clock.addTime();
              // New object so the memo + map repaint see the change.
              setTally({ named: new Set(cur.named), points: cur.points, total: cur.total });
            }
          } else {
            setRejectMsg(
              res.reason === "duplicate"
                ? "Already named"
                : res.reason === "empty"
                  ? "Type a country"
                  : "Not a match",
            );
            setRejectSignal((s) => s + 1);
          }
        } catch (err) {
          if (err instanceof RateLimitedError) {
            setRejectMsg("Slow down a moment");
          } else {
            setRejectMsg("Could not reach the server");
            console.warn("[DailyPlay] answer failed", err);
          }
          setRejectSignal((s) => s + 1);
        } finally {
          setSubmitting(false);
        }
      })();
      return true; // sent (optimistic clear in the input)
    },
    [submitting, set.dailyDate, prompt.id, index, clock],
  );

  const named = tally.named; // lowercase iso set for the map highlight.
  const colorByIso = useMemo(() => {
    const m = new Map<string, string>();
    for (const iso of named) m.set(iso, "var(--color-player1)");
    return m;
  }, [named]);

  // Feed-the-clock meter width. The bar fills relative to a baseline (the base
  // seconds) so bonus time can briefly overfill — capped at 100%.
  const meterPct = Math.min(100, (clock.secondsLeft / DAILY_BASE_SECONDS) * 100);
  const low = clock.secondsLeft <= 5;

  return (
    <section className={`flex h-full flex-col ${className ?? ""}`} data-testid="daily-play">
      <header className="chrome-bar chrome-ink flex flex-col gap-3 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide opacity-70">
            Prompt {index + 1} of {prompts.length}
          </span>
          <span className="text-sm tabular-nums" data-testid="feed-clock-seconds">
            {clock.secondsLeft}s
          </span>
        </div>
        <h2 className="text-lg font-semibold">{prompt.label}</h2>
        {/* Feed-the-clock meter. */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-black/25"
          role="progressbar"
          aria-label="Time remaining"
          aria-valuenow={clock.secondsLeft}
        >
          <div
            className="h-full rounded-full transition-[width] duration-100 ease-linear"
            style={{
              width: `${meterPct}%`,
              background: low ? "var(--color-accent)" : "var(--color-chrome-gold)",
            }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span data-testid="prompt-tally">
            {tally.named.size}
            {tally.total ? ` of ${tally.total}` : ""} named
            {tally.points ? ` · ${Math.round(tally.points)} pts` : ""}
          </span>
          <button
            type="button"
            onClick={advance}
            data-testid="daily-next"
            className="rounded-lg bg-surface-raised px-4 py-2 font-semibold transition hover:brightness-125"
          >
            {index + 1 >= prompts.length ? "Finish" : "Next"}
          </button>
        </div>
      </header>

      {/* The player's named countries for THIS prompt, highlighted on the atlas. */}
      <div className="relative min-h-0 flex-1">
        <WorldMap
          filledIso={named}
          colorByIso={colorByIso}
          color="var(--color-player1)"
          categoryId="countries"
        />
      </div>

      <AnswerBar
        onSubmit={handleSubmit}
        clearSignal={clearSignal}
        acceptSignal={acceptSignal}
        rejectSignal={rejectSignal}
        rejectMsg={rejectMsg}
        disabled={submitting}
      />
    </section>
  );
}
