/**
 * Daily Dive — one prompt of the run (Track C).
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

import { useCallback, useMemo, useRef, useState } from "react";
import WorldMap from "../../components/WorldMap";
import AnswerBar from "../match/AnswerBar";
import { useFeedClock } from "./useFeedClock";
import { postAnswer, RateLimitedError } from "./dailyApi";
import { project } from "./geo";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";
import { DAILY_BASE_SECONDS } from "./contract";
import type { DailyDestination, DailyPrompt, DailyPromptResult, DailyRoute } from "./contract";

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
  const pointsRef = useRef(0);
  const totalRef = useRef(0);
  const [, forceTally] = useState(0);

  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [rejectSignal, setRejectSignal] = useState(0);
  const [acceptSignal, setAcceptSignal] = useState(0);
  const [submitting, setSubmitting] = useState(false);

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

  // Journey overlay geometry (projected into the world viewBox, so it aligns
  // with the WorldMap's country paths).
  const overlay = useMemo(() => {
    const pts = route.points.map(project);
    const geo = buildRouteGeometry(pts);
    return {
      line: pts.map((p) => `${p.x},${p.y}`).join(" "),
      stops: pts,
      you: pointAtFraction(geo, Math.max(0, Math.min(1, progress))),
      dest: project(destination.at),
    };
  }, [route.points, destination.at, progress]);

  const meterPct = Math.min(100, (clock.secondsLeft / DAILY_BASE_SECONDS) * 100);
  const low = clock.secondsLeft <= 5;
  const total_ = totalRef.current;

  return (
    <section className={`flex h-full flex-col ${className ?? ""}`} data-testid="daily-play">
      <div className="relative min-h-0 flex-1">
        {/* The board: named countries light up here. */}
        <WorldMap
          filledIso={named}
          colorByIso={colorByIso}
          color="var(--color-player1)"
          categoryId="countries"
          interactive={false}
        />

        {/* Journey overlay: the road, its stops, your position and the goal. */}
        <svg
          viewBox="0 0 1010 666"
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <polyline
            points={overlay.line}
            fill="none"
            stroke="var(--map-terracotta)"
            strokeWidth={1.6}
            strokeOpacity={0.55}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          {overlay.stops.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={2.2} fill="var(--map-terracotta)" stroke="var(--map-paper)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
          ))}
          {/* Destination */}
          <g>
            <circle cx={overlay.dest.x} cy={overlay.dest.y} r={5.5} fill="none" stroke="var(--color-accent)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
            <Star cx={overlay.dest.x} cy={overlay.dest.y} r={3.6} fill="var(--color-accent)" />
            <text x={overlay.dest.x} y={overlay.dest.y - 8} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={12} fill="var(--map-ink)" style={{ paintOrder: "stroke" }} stroke="var(--map-paper)" strokeWidth={2.4} strokeOpacity={0.85}>
              {destination.name}
            </text>
          </g>
          {/* You are here */}
          <g data-testid="you-are-here">
            <circle cx={overlay.you.x} cy={overlay.you.y} r={4.5} fill="var(--color-chrome-gold)" stroke="var(--map-paper)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          </g>
        </svg>

        {/* Prompt counter (corner) + Next/Finish — floating, no chrome strip. */}
        <span className="pointer-events-none absolute left-3 top-3 z-10 text-xs font-semibold uppercase tracking-wide text-muted [text-shadow:0_1px_2px_var(--map-paper)]">
          Prompt {index + 1} of {total}
        </span>
        <button
          type="button"
          onClick={finish}
          data-testid="daily-next"
          className="absolute right-3 top-3 z-10 rounded-lg bg-[var(--color-chrome)]/85 px-4 py-2 text-sm font-semibold text-[var(--color-chrome-ink)] backdrop-blur transition hover:brightness-125"
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
            {pointsRef.current ? ` · ${Math.round(pointsRef.current)} pts` : ""}
          </span>
        </div>
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
