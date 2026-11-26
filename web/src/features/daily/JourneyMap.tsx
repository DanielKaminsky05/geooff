/**
 * Daily Trek — journey map.
 *
 * The travel beat between prompts: a regional atlas that ZOOMS to the segment
 * just earned and animates the trekker + gold trail forward across it, so the
 * points you scored read as ground covered. `from`→`progress` is tweened
 * internally (easeOut), pausing on each landmark (a temple) to pop its gold.
 *
 * The drawn route and everything placed ON it (the trekker, the temples) share a
 * SINGLE geometry: the smooth curve sampled into a dense polyline. So the gold
 * "travelled" line, the red road, and the walker always coincide exactly.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { maps } from "../../lib/maps";
import type { DailyDestination, DailyLandmark, DailyRoute } from "../../lib/protocol";
import { project, fitViewBox } from "./geo";
import { sampleSmooth } from "./smoothPath";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";
import { Star } from "./Star";
import { Walker, WALK_SWING_DEG, WALK_LEG_LEN } from "./Walker";

export interface JourneyMapProps {
  route: DailyRoute;
  destination: DailyDestination;
  landmarks: DailyLandmark[];
  /** Target fraction (0..1) the traveler animates TO. */
  progress: number;
  /** Fraction the leg starts from; the traveler tweens from here to `progress`. */
  from?: number;
  /** Fired once the tween reaches `progress`. */
  onArrived?: () => void;
  /** Fired when the traveler reaches a landmark (with its gold), for the HUD. */
  onLandmark?: (gold: number) => void;
  /** When the run is over, the trekker reacts: cheers on "arrived", topples on
   *  "died". Omit while still travelling (the figure keeps walking). */
  outcome?: "arrived" | "died";
  className?: string;
}

const JUST_PASSED_WINDOW = 0.06;
/** Travel pace: ms per full route-fraction covered. This gives the trekker a
 *  CONSTANT speed — a far leg takes proportionally longer instead of every leg
 *  sharing one fixed time slot (which made long legs zip past faster than the
 *  walker could believably stride). Clamped so tiny hops aren't instant and a
 *  huge leg isn't endless. */
const TRAVEL_MS_PER_FRACTION = 14000;
const TRAVEL_MIN_MS = 500;
const TRAVEL_MAX_MS = 7000;
/** Stride length multiplier over strict zero-slip: each full leg cycle covers
 *  this much more ground, so the legs swing SLOWER (fewer, longer strides) and
 *  read as a walk instead of a blur. Higher = slower swing. */
const WALK_STRIDE_SCALE = 3;
/** How long the traveler pauses on a landmark to show its gold reward. */
const PAUSE_MS = 700;

/** True when the user asked for reduced motion (guarded for SSR / no matchMedia). */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function JourneyMap({
  route,
  destination,
  landmarks,
  progress,
  from = progress,
  onArrived,
  onLandmark,
  outcome,
  className,
}: JourneyMapProps) {
  const target = Math.max(0, Math.min(1, progress));
  const start = Math.max(0, Math.min(1, from));

  // One geometry for everything: the smooth curve sampled into dense points.
  // Key on stable primitives, not the mutable `route.points` / `destination.at`
  // references: `journeyId` ("short"|"medium"|"long") uniquely identifies the route's
  // points, and `destination.name` its location — so the parent passing a fresh object
  // with the same data won't needlessly rebuild this dense geometry.
  const { geo, dest } = useMemo(() => {
    const pts = sampleSmooth(route.points.map(project));
    return { geo: buildRouteGeometry(pts), dest: project(destination.at) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.journeyId, destination.name]);

  // Tween `shown` from start → target, PAUSING on each landmark crossed to pop a
  // gold reward — so reaching a temple is a felt beat, not a blur.
  const [shown, setShown] = useState(start);
  const [reward, setReward] = useState<{ gold: number; x: number; y: number } | null>(null);
  // True only while the trekker is actively sliding along the path; false while
  // paused at a temple or once the leg ends, so the legs stand instead of pumping.
  const [moving, setMoving] = useState(false);
  const reduceMotion = useMemo(() => prefersReducedMotion(), []);
  const onArrivedRef = useRef(onArrived);
  onArrivedRef.current = onArrived;
  const onLandmarkRef = useRef(onLandmark);
  onLandmarkRef.current = onLandmark;
  useEffect(() => {
    if (target <= start + 1e-4) {
      setShown(target);
      onArrivedRef.current?.();
      return;
    }
    // Reduced motion: skip the walk/chase-cam tween. Snap to the target, award any
    // landmarks crossed, and still fire onArrived once so the phase machine advances.
    if (reduceMotion) {
      setShown(target);
      landmarks
        .filter((l) => l.atFraction > start + 1e-4 && l.atFraction <= target + 1e-6)
        .forEach((l) => onLandmarkRef.current?.(l.gold));
      onArrivedRef.current?.();
      return;
    }
    let cancelled = false;
    let raf = 0;
    const timers: number[] = [];
    // Linear: a steady, constant pace between stops (the "stop" beat comes from
    // standing still at each temple), so the gait tempo stays even.
    const ease = (t: number) => t;

    // Landmark fractions crossed on this leg, in order — the pause points.
    const stops = landmarks
      .map((l) => l.atFraction)
      .filter((f) => f > start + 1e-4 && f <= target + 1e-6)
      .sort((a, b) => a - b);
    const waypoints = stops.slice();
    if (waypoints.length === 0 || waypoints[waypoints.length - 1] < target - 1e-6) {
      waypoints.push(target);
    }

    const animateTo = (fromF: number, to: number, dur: number) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (cancelled) return;
          const t = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
          setShown(fromF + (to - fromF) * ease(t));
          if (t < 1) raf = requestAnimationFrame(step);
          else resolve();
        };
        raf = requestAnimationFrame(step);
      });
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    void (async () => {
      let prev = start;
      setMoving(true);
      for (const w of waypoints) {
        // Constant speed: duration scales with the distance (route fraction)
        // actually covered on this segment, clamped at both ends.
        const dur = Math.min(TRAVEL_MAX_MS, Math.max(TRAVEL_MIN_MS, (w - prev) * TRAVEL_MS_PER_FRACTION));
        await animateTo(prev, w, dur);
        if (cancelled) return;
        const lm = landmarks.find((l) => Math.abs(l.atFraction - w) < 1e-6);
        if (lm && stops.includes(w)) {
          // Stand still while the gold pops at the temple, then walk on.
          setMoving(false);
          const at = pointAtFraction(geo, w);
          setReward({ gold: lm.gold, x: at.x, y: at.y });
          onLandmarkRef.current?.(lm.gold);
          await wait(PAUSE_MS);
          if (cancelled) return;
          setReward(null);
          setMoving(true);
        }
        prev = w;
      }
      setMoving(false);
      if (!cancelled) onArrivedRef.current?.();
    })();

    return () => {
      cancelled = true;
      setMoving(false);
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [start, target, landmarks, geo, reduceMotion]);

  const traveler = pointAtFraction(geo, shown);
  // Facing = sign of the tangent so the trekker walks forwards, not backwards.
  const ahead = pointAtFraction(geo, Math.min(1, shown + 0.01));
  const facing = ahead.x >= traveler.x ? 1 : -1;

  // Camera: a steady zoom per leg that stays CENTERED on the trekker, panning the
  // map as he walks. The span (zoom) is derived once from a window of road around
  // the leg so it doesn't wobble; the centre tracks the traveler every frame.
  const span = useMemo(() => {
    const mid = (start + target) / 2;
    const half = 0.11;
    const lo = Math.max(0, mid - half);
    const hi = Math.min(1, mid + half);
    const seg: { x: number; y: number }[] = [];
    for (let i = 0; i <= 14; i++) seg.push(pointAtFraction(geo, lo + ((hi - lo) * i) / 14));
    const parts = fitViewBox(seg, { pad: 1.4, min: 150 }).split(" ").map(Number);
    return { w: parts[2], h: parts[3] };
  }, [geo, start, target]);

  // Chase cam: the centre tracks the traveler, so this one string must rebuild
  // each frame — but it's a single allocation, nothing more.
  const viewBox = `${traveler.x - span.w / 2} ${traveler.y - span.h / 2} ${span.w} ${span.h}`;

  // Full (static) route line — point set never changes with `shown`, so memoize it
  // once per geometry instead of re-serializing every frame.
  const fullLine = useMemo(() => geo.points.map((p) => `${p.x},${p.y}`).join(" "), [geo]);

  // Travelled gold line: the SAME sampled points up to the traveler — exact overlay.
  // `geo.cumulative` is monotonically increasing, so the points with
  // `cumulative[i] <= targetLen` are an exact prefix: find the cutoff index with a
  // cheap scan and `slice` it (O(points-up-to-now)) rather than filtering all points.
  const travelledLine = useMemo(() => {
    const targetLen = geo.length * shown;
    let cut = 0;
    while (cut < geo.cumulative.length && geo.cumulative[cut] <= targetLen) cut++;
    const pts = geo.points.slice(0, cut);
    pts.push(traveler);
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  }, [geo, shown, traveler.x, traveler.y]);

  // Marker scale relative to the (zoomed) view, so icons stay a steady size.
  const u = Math.max(1, span.w || 170) / 100;

  // Stride phase locked to ground covered: one full two-step cycle per the
  // distance the feet actually reach (so planted feet don't slide), advanced by
  // the travelled distance. When `shown` stops changing, the phase freezes.
  const footTravel = 2 * Math.sin((WALK_SWING_DEG * Math.PI) / 180) * WALK_LEG_LEN;
  const groundPerCycle = footTravel * 2 * (u * 0.7) * WALK_STRIDE_SCALE;
  const stridePhase = groundPerCycle > 0 ? ((geo.length * shown) / groundPerCycle) * Math.PI * 2 : 0;

  // Landmark positions depend only on the (static) geometry + landmark fractions,
  // never on `shown` — so resolve them once instead of per frame. The lit/justPassed
  // flags below stay reactive to `shown`.
  const landmarkPositions = useMemo(
    () => landmarks.map((lm) => pointAtFraction(geo, lm.atFraction)),
    [geo, landmarks],
  );

  const landEls = useMemo(
    () =>
      (maps.countries?.locations ?? []).map((loc) => (
        <path key={loc.id} d={loc.path} fill="var(--color-land)" stroke="var(--map-land-border)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      )),
    [],
  );

  const rootClassName = ["daily-journey-map", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} style={{ position: "relative", width: "100%", height: "100%" }} aria-label={`Journey to ${destination.name}`}>
      <svg viewBox={viewBox} role="img" aria-label={`Route to ${destination.name}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} strokeLinejoin="round" strokeLinecap="round">
        <rect x={-2000} y={-2000} width={4000} height={4000} fill="var(--map-ocean-bottom)" />
        {landEls}

        {geo.points.length >= 2 && (
          <>
            <polyline points={fullLine} fill="none" stroke="var(--map-terracotta)" strokeWidth={3} strokeOpacity={0.5} strokeDasharray="5 6" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
            <polyline points={travelledLine} fill="none" stroke="var(--color-chrome-gold)" strokeWidth={4} strokeOpacity={0.95} strokeLinecap="round" vectorEffect="non-scaling-stroke" data-testid="journey-route" />
          </>
        )}

        {landmarks.map((lm: DailyLandmark, i) => {
          const at = landmarkPositions[i];
          const lit = shown >= lm.atFraction;
          const justPassed = lit && shown - lm.atFraction <= JUST_PASSED_WINDOW;
          // Always drawn (so you see temples ahead on the path); dimmed until reached.
          return (
            <g key={`lm-${i}-${lm.atFraction}`} data-testid="journey-landmark" data-lit={lit ? "true" : "false"} data-fraction={lm.atFraction}>
              <g transform={`translate(${at.x} ${at.y}) scale(${u * 0.55})`} opacity={lit ? 1 : 0.5}>
                {justPassed && !reduceMotion && (
                  <circle r={1} fill="none" stroke="var(--color-chrome-gold)" strokeWidth={0.4}>
                    <animate attributeName="r" values="1;6" dur="1.3s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.9;0" dur="1.3s" repeatCount="indefinite" />
                  </circle>
                )}
                <Temple />
              </g>
            </g>
          );
        })}

        {/* Destination — ringed star + label. */}
        <g data-testid="journey-destination">
          <circle cx={dest.x} cy={dest.y} r={1.9 * u} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
          <Star cx={dest.x} cy={dest.y} r={1.2 * u} fill="var(--color-accent)" />
          <text x={dest.x} y={dest.y - 2.8 * u} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={2.6 * u} fill="var(--map-ink)" style={{ paintOrder: "stroke" }} stroke="var(--map-paper)" strokeWidth={0.8 * u} strokeOpacity={0.85}>
            {destination.name}
          </text>
        </g>

        {/* Trekker — a little walking figure facing the way it travels. */}
        {geo.length > 0 && (
          <g data-testid="journey-traveler" data-x={traveler.x} data-y={traveler.y} data-outcome={outcome ?? ""} transform={`translate(${traveler.x} ${traveler.y}) scale(${u * 0.7})`}>
            <g transform={`scale(${facing} 1)`}>
              <Walker outcome={outcome} phase={stridePhase} moving={moving} />
            </g>
          </g>
        )}

        {/* Landmark reward — a rising "+gold" while the traveler pauses here. */}
        {reward && (
          <g
            key={`${reward.x},${reward.y}`}
            data-testid="landmark-reward"
            transform={`translate(${reward.x} ${reward.y}) scale(${u})`}
            style={{ pointerEvents: "none" }}
          >
            <g className="daily-gold-pop">
              <circle cy={-7} r={1.7} fill="var(--color-chrome-gold)" stroke="var(--map-ink)" strokeWidth={0.25} />
              <text y={-9.6} textAnchor="middle" fontFamily="var(--font-serif)" fontWeight={700} fontSize={3.6} fill="var(--color-chrome-gold)" style={{ paintOrder: "stroke" }} stroke="var(--map-paper)" strokeWidth={1} strokeOpacity={0.9}>
                +{reward.gold}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * A small classical temple (gold) for a landmark — steps, four columns, an
 * entablature and a pediment roof, drawn in unit space (base at the origin).
 */
function Temple() {
  const gold = "var(--color-chrome-gold)";
  const shade = "#b8862b";
  const ink = "var(--map-ink)";
  // Base coords put the temple above the origin; shift it down by half its height
  // so the marker is CENTERED on the line point.
  return (
    <g transform="translate(0 3.05)" stroke={ink} strokeWidth={0.14} strokeLinejoin="round">
      {/* steps */}
      <rect x={-3.1} y={-0.95} width={6.2} height={0.95} rx={0.12} fill={shade} />
      <rect x={-2.6} y={-1.55} width={5.2} height={0.65} fill={gold} />
      {/* columns */}
      {[-2.15, -0.9, 0.35, 1.6].map((cx, i) => (
        <g key={i}>
          <rect x={cx} y={-3.75} width={0.6} height={2.25} fill={gold} />
          <rect x={cx + 0.38} y={-3.75} width={0.22} height={2.25} fill={shade} stroke="none" />
        </g>
      ))}
      {/* entablature */}
      <rect x={-2.85} y={-4.3} width={5.7} height={0.62} fill={shade} />
      {/* pediment roof */}
      <polygon points="-3.2,-4.3 3.2,-4.3 0,-6.1" fill={gold} />
    </g>
  );
}

