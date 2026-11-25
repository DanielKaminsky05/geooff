/**
 * Daily Dive — one prompt of the run (Track C).
 *
 * Renders a SINGLE prompt: its label, a feed-the-clock meter (useFeedClock), an
 * answer input, and a WorldMap highlighting the countries named for this prompt.
 * The page (DailyDive) owns the 5-prompt sequence and re-mounts this per prompt
 * (so the clock re-seeds), playing a journey leg between prompts.
 *
 * On submit it round-trips `postAnswer` (the only call that touches the secret
 * valid set). A valid, not-yet-named answer lights its country, adds its points,
 * and feeds the clock. The server is stateless, so DEDUP IS CLIENT-SIDE. "Next"
 * early-advances (forfeiting remaining time); expiry auto-advances. Either way it
 * reports this prompt's result through `onComplete` exactly once.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import WorldMap from "../../components/WorldMap";
import AnswerBar from "../match/AnswerBar";
import { useFeedClock } from "./useFeedClock";
import { postAnswer, RateLimitedError } from "./dailyApi";
import { DAILY_BASE_SECONDS } from "./contract";
import type { DailyPrompt, DailyPromptResult } from "./contract";

export interface DailyPlayProps {
  dailyDate: string;
  prompt: DailyPrompt;
  /** 0-based index of this prompt, and the total, for the HUD. */
  index: number;
  total: number;
  /** Fired exactly once when the prompt ends (expiry or Next). */
  onComplete: (result: DailyPromptResult) => void;
  className?: string;
}

export default function DailyPlay({
  dailyDate,
  prompt,
  index,
  total,
  onComplete,
  className,
}: DailyPlayProps) {
  // Named isos (client-side dedup), points and the prompt's valid-answer total.
  const namedRef = useRef<Set<string>>(new Set());
  const [named, setNamed] = useState<Set<string>>(() => namedRef.current);
  const pointsRef = useRef(0);
  const totalRef = useRef(0);
  const [, forceTally] = useState(0);

  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [rejectSignal, setRejectSignal] = useState(0);
  const [acceptSignal, setAcceptSignal] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Report this prompt's result exactly once (expiry AND a Next tap can race).
  const doneRef = useRef(false);
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete({
      promptId: prompt.id,
      named: namedRef.current.size,
      total: totalRef.current,
      points: pointsRef.current,
    });
  }, [onComplete, prompt.id]);

  const clock = useFeedClock(finish);

  const handleSubmit = useCallback(
    (text: string): boolean => {
      if (submitting || doneRef.current) return false;
      setSubmitting(true);
      setRejectMsg(null);
      void (async () => {
        try {
          const res = await postAnswer({ dailyDate, promptId: prompt.id, answer: text });
          if (res.promptTotal !== undefined) totalRef.current = res.promptTotal;

          if (res.valid && res.iso) {
            const iso = res.iso.toLowerCase();
            if (namedRef.current.has(iso)) {
              setRejectMsg("Already named");
              setRejectSignal((s) => s + 1);
            } else {
              namedRef.current.add(iso);
              pointsRef.current += res.points ?? 0;
              setNamed(new Set(namedRef.current));
              setAcceptSignal((s) => s + 1);
              clock.addTime();
              forceTally((n) => n + 1);
            }
          } else {
            setRejectMsg(res.reason === "empty" ? "Type a country" : "Not a match");
            setRejectSignal((s) => s + 1);
          }
        } catch (err) {
          setRejectMsg(
            err instanceof RateLimitedError ? "Slow down a moment" : "Could not reach the server",
          );
          if (!(err instanceof RateLimitedError)) console.warn("[DailyPlay] answer failed", err);
          setRejectSignal((s) => s + 1);
        } finally {
          setSubmitting(false);
        }
      })();
      return true;
    },
    [submitting, dailyDate, prompt.id, clock],
  );

  const colorByIso = useMemo(() => {
    const m = new Map<string, string>();
    for (const iso of named) m.set(iso, "var(--color-player1)");
    return m;
  }, [named]);

  const meterPct = Math.min(100, (clock.secondsLeft / DAILY_BASE_SECONDS) * 100);
  const low = clock.secondsLeft <= 5;
  const total_ = totalRef.current;

  return (
    <section className={`flex h-full flex-col ${className ?? ""}`} data-testid="daily-play">
      <header className="chrome-bar chrome-ink flex flex-col gap-3 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide opacity-70">
            Prompt {index + 1} of {total}
          </span>
          <span className="text-sm tabular-nums" data-testid="feed-clock-seconds">
            {clock.secondsLeft}s
          </span>
        </div>
        <h2 className="text-lg font-semibold">{prompt.label}</h2>
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
            {named.size}
            {total_ ? ` of ${total_}` : ""} named
            {pointsRef.current ? ` · ${Math.round(pointsRef.current)} pts` : ""}
          </span>
          <button
            type="button"
            onClick={finish}
            data-testid="daily-next"
            className="rounded-lg bg-surface-raised px-4 py-2 font-semibold transition hover:brightness-125"
          >
            {index + 1 >= total ? "Finish" : "Next"}
          </button>
        </div>
      </header>

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
        clearSignal={0}
        acceptSignal={acceptSignal}
        rejectSignal={rejectSignal}
        rejectMsg={rejectMsg}
        disabled={submitting}
      />
    </section>
  );
}
