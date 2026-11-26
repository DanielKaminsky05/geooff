/**
 * Daily Trek — one prompt of the run.
 *
 * The prompt and timer FLOAT on the world map (no chrome strip). The map doubles
 * as the game board: countries you name light up, and your current position + the
 * destination (+ the dotted road and its stops) are overlaid so you always see
 * where you are and where you're headed. The page (DailyDive) re-mounts this per
 * prompt (so the clock re-seeds) and plays a journey leg between prompts.
 *
 * Submit round-trips `postAnswer` (the only call touching the secret valid set);
 * a valid, not-yet-named answer lights its country, adds points and feeds the
 * clock. Dedup is client-side. "Next"/expiry reports the result once via
 * `onComplete`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorldMap from "../../components/WorldMap";
import AnswerBar from "../match/AnswerBar";
import { useFeedClock } from "./useFeedClock";
import { postAnswer, RateLimitedError } from "./dailyApi";
import { project } from "./geo";
import { smoothPath } from "./smoothPath";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";
import { Walker } from "./Walker";
import { DAILY_BASE_SECONDS, DAILY_PROMPT_MAX } from "./contract";
import type { DailyDestination, DailyPrompt, DailyPromptResult, DailyRoute } from "./contract";

/** Once the player names every answer, auto-advance the leg this long later, so
 *  the full clear registers before moving on. */
const FULL_CLEAR_BUFFER_MS = 2000;

export interface DailyPlayProps {
  dailyDate: string;
  prompt: DailyPrompt;
  /** 0-based index of this prompt, and the total, for the HUD. */
  index: number;
  total: number;
  /** The active journey's route + destination, overlaid on the board. */
  route: DailyRoute;
  destination: DailyDestination;
  /** Where the traveler sits right now (0..1 along the route). */
  progress: number;
  /** Fired exactly once when the prompt ends (expiry or Next). */
  onComplete: (result: DailyPromptResult) => void;
  className?: string;
}

export default function DailyPlay({
  dailyDate,
  prompt,
  index,
  total,
  route,
  destination,
  progress,
  onComplete,
  className,
}: DailyPlayProps) {
  const namedRef = useRef<Set<string>>(new Set());
  const [named, setNamed] = useState<Set<string>>(() => namedRef.current);
  const pointsRef = useRef(0); // raw rarity-weighted points captured so far
  const promptMaxRef = useRef(0); // this prompt's full weighted pool (from server)
  const totalRef = useRef(0);
  const [, forceTally] = useState(0);

  // Capture base for THIS prompt: your captured share of its pool, 0..150.
  // Reported to the parent at the end; NOT shown during play (keeps the points
  // a surprise until the leg reveal).
  const captureBase = (): number =>
    promptMaxRef.current > 0
      ? Math.min(DAILY_PROMPT_MAX, (DAILY_PROMPT_MAX * pointsRef.current) / promptMaxRef.current)
      : 0;

  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [rejectSignal, setRejectSignal] = useState(0);
  const [acceptSignal, setAcceptSignal] = useState(0);

  // Number of postAnswer requests still in flight. On finish we briefly wait for
  // these to settle (capped) so a last optimistic answer isn't lost to the race
  // between its late response and the onComplete snapshot.
  const inFlightRef = useRef(0);
  // Full-clear auto-advance: once every answer is named, move on after a short
  // buffer so the player sees they cleared it. Holds the pending timer id.
  const fullClearTimerRef = useRef<number | null>(null);

  // False once this prompt unmounts (the parent re-keys per leg): lets the async
  // answer handler bail instead of touching state on a gone component.
  const mountedRef = useRef(true);

  const doneRef = useRef(false);
  // Max time finish() will wait for in-flight answers to settle before
  // snapshotting anyway — a hung request can't block the UI forever.
  const FINISH_SETTLE_CAP_MS = 1500;
  const finish = useCallback(() => {
    if (doneRef.current) return;
    // Fire-once latch taken synchronously, so repeated clicks / an expiry racing
    // a Next click still report exactly one result.
    doneRef.current = true;
    const report = () => {
      // If we unmounted while polling for in-flight answers (e.g. the player
      // navigated away), don't report a stale result into the parent.
      if (!mountedRef.current) return;
      // Report the capture base (0..150); the server adds the per-name bonus.
      // Snapshot namedRef/pointsRef AFTER waiting, so a late answer is included.
      onComplete({
        promptId: prompt.id,
        named: namedRef.current.size,
        total: totalRef.current,
        points: captureBase(),
        namedIsos: [...namedRef.current],
      });
    };
    if (inFlightRef.current <= 0) {
      report();
      return;
    }
    // Wait for in-flight answers to drain, but no longer than the cap.
    const start = Date.now();
    const poll = () => {
      if (inFlightRef.current <= 0 || Date.now() - start >= FINISH_SETTLE_CAP_MS) {
        report();
      } else {
        setTimeout(poll, 50);
      }
    };
    setTimeout(poll, 50);
  }, [onComplete, prompt.id]);

  const clock = useFeedClock(finish);
  // Stable across renders (useFeedClock memoizes it), unlike the clock object,
  // whose identity changes every tick as secondsLeft counts down. Depending on
  // this in handleSubmit keeps that callback from rebuilding 10×/second.
  const addClockTime = clock.addTime;

  // On unmount: mark gone and clear any pending full-clear timer.
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (fullClearTimerRef.current != null) window.clearTimeout(fullClearTimerRef.current);
    },
    [],
  );

  const handleSubmit = useCallback(
    (text: string): boolean => {
      if (doneRef.current) return false;
      setRejectMsg(null);
      // Fire-and-track: the field clears optimistically and keeps focus; multiple
      // guesses can be in flight (the server is stateless, dedup is client-side).
      // Count in-flight requests so finish() can wait for them to settle.
      inFlightRef.current += 1;
      void (async () => {
        try {
          const res = await postAnswer({ dailyDate, promptId: prompt.id, answer: text });
          // The prompt may have ended + unmounted while this was in flight (the
          // settle cap in finish() is shorter than the request timeout). Drop the
          // late response rather than update a gone component's state.
          if (!mountedRef.current) return;
          if (res.promptTotal !== undefined) totalRef.current = res.promptTotal;
          if (res.promptMax !== undefined) promptMaxRef.current = res.promptMax;

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
              addClockTime();
              forceTally((n) => n + 1);
              // Named them all → auto-advance after a short buffer (once).
              if (
                totalRef.current > 0 &&
                namedRef.current.size >= totalRef.current &&
                fullClearTimerRef.current == null
              ) {
                fullClearTimerRef.current = window.setTimeout(finish, FULL_CLEAR_BUFFER_MS);
              }
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
          inFlightRef.current -= 1;
        }
      })();
      return true;
    },
    [dailyDate, prompt.id, addClockTime, finish],
  );

  const colorByIso = useMemo(() => {
    const m = new Map<string, string>();
    for (const iso of named) m.set(iso, "var(--color-player1)");
    return m;
  }, [named]);

  // Journey overlay, drawn INSIDE the WorldMap's svg (world coords) so it
  // pans/zooms with the board. Memoized so the ~250-path map doesn't repaint
  // while naming (it only changes if the route/position changes).
  const overlayEl = useMemo(() => {
    const pts = route.points.map(project);
    const geo = buildRouteGeometry(pts);
    const line = smoothPath(pts);
    const you = pointAtFraction(geo, Math.max(0, Math.min(1, progress)));
    const dest = project(destination.at);
    return (
      <g aria-hidden="true" style={{ pointerEvents: "none" }}>
        <path d={line} fill="none" stroke="var(--map-terracotta)" strokeWidth={3.2} strokeOpacity={0.85} strokeDasharray="5 6" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
        {pts.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={1.3} fill="var(--map-terracotta)" stroke="var(--map-paper)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        ))}
        <circle cx={dest.x} cy={dest.y} r={3} fill="none" stroke="var(--color-accent)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <Star cx={dest.x} cy={dest.y} r={1.9} fill="var(--color-accent)" />
        <text x={dest.x} y={dest.y - 4.5} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={7} fill="var(--map-ink)" style={{ paintOrder: "stroke" }} stroke="var(--map-paper)" strokeWidth={1.5} strokeOpacity={0.85}>
          {destination.name}
        </text>
        {/* "You are here": a little idle trekker standing on the spot, instead of
            a plain dot — feet at the point. A soft paper halo keeps it legible
            over any country colour. */}
        <g data-testid="you-are-here" transform={`translate(${you.x} ${you.y}) scale(0.9)`}>
          <ellipse cx={0} cy={0} rx={2.4} ry={0.9} fill="var(--map-paper)" opacity={0.55} />
          <Walker />
        </g>
      </g>
    );
  }, [route.points, destination.at, progress]);

  const meterPct = Math.min(100, (clock.secondsLeft / DAILY_BASE_SECONDS) * 100);
  const low = clock.secondsLeft <= 5;
  const total_ = totalRef.current;

  return (
    <section className={`flex h-full flex-col ${className ?? ""}`} data-testid="daily-play">
      <div className="relative min-h-0 flex-1">
        {/* The board: named countries light up here; the journey rides inside
            the map's svg so it pans/zooms with it. */}
        <WorldMap
          filledIso={named}
          colorByIso={colorByIso}
          color="var(--color-player1)"
          categoryId="countries"
          overlay={overlayEl}
          wrap={false}
        />

        {/* Prompt counter + Next/Finish — top-LEFT (the HUD owns the top-right). */}
        <span className="pointer-events-none absolute left-3 top-3 z-10 text-xs font-semibold uppercase tracking-wide text-muted [text-shadow:0_1px_2px_var(--map-paper)]">
          Prompt {index + 1} of {total}
        </span>
        <button
          type="button"
          onClick={finish}
          data-testid="daily-next"
          className="absolute left-3 top-9 z-10 rounded-lg bg-[var(--color-chrome)]/85 px-4 py-2 text-sm font-semibold text-[var(--color-chrome-ink)] backdrop-blur transition hover:brightness-125"
        >
          {index + 1 >= total ? "Finish" : "Next"}
        </button>

        {/* Timer + prompt + meter + tally, floating centred on the map. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 px-4 pt-3">
          <span
            data-testid="feed-clock-seconds"
            className="rounded-full bg-[var(--color-chrome)]/85 px-3 py-0.5 text-sm font-semibold tabular-nums text-[var(--color-chrome-ink)] backdrop-blur"
            style={{ color: low ? "var(--color-accent)" : undefined }}
          >
            {clock.secondsLeft}s
          </span>
          <h2 className="daily-prompt-pop max-w-xl rounded-lg bg-[var(--map-paper)]/70 px-4 py-1.5 text-center text-xl font-semibold text-foreground backdrop-blur-[2px]">
            {prompt.label}
          </h2>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-black/20" role="progressbar" aria-valuenow={clock.secondsLeft} aria-label="Time remaining">
            <div
              className="h-full rounded-full transition-[width] duration-100 ease-linear"
              style={{ width: `${meterPct}%`, background: low ? "var(--color-accent)" : "var(--color-chrome-gold)" }}
            />
          </div>
          <span data-testid="prompt-tally" className="text-sm font-semibold text-foreground [text-shadow:0_1px_2px_var(--map-paper),0_0_6px_var(--map-paper)]">
            {named.size}
            {total_ ? ` of ${total_}` : ""} named
          </span>
        </div>
      </div>

      <AnswerBar
        onSubmit={handleSubmit}
        clearSignal={0}
        acceptSignal={acceptSignal}
        rejectSignal={rejectSignal}
        rejectMsg={rejectMsg}
        disabled={false}
        autoFocus
      />
    </section>
  );
}

/** A small five-point star centred on (cx, cy). */
function Star({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return <polygon points={pts.join(" ")} fill={fill} />;
}
