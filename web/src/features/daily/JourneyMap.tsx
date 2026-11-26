/**
 * Daily Dive — journey map (owned by Track D).
 *
 * The travel beat between prompts: a regional atlas that ZOOMS to the segment
 * just earned and animates the character + gold trail forward across it, so the
 * points you scored read as ground covered. `from`→`progress` is tweened
 * internally (easeOut) and the camera frames that segment.
 *
 * Positions are world-SVG coords (geo.project), aligned with the land paths.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { maps } from "../../lib/maps";
import type { DailyDestination, DailyLandmark, DailyRoute } from "../../lib/protocol";
import { project, fitViewBox } from "./geo";
import { smoothPath } from "./smoothPath";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";

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
  className?: string;
}

const JUST_PASSED_WINDOW = 0.06;
const TWEEN_MS = 2800;
/** How long the traveler pauses on a landmark to show its gold reward. */
const PAUSE_MS = 700;

export default function JourneyMap({
  route,
  destination,
  landmarks,
  progress,
  from = progress,
  onArrived,
  className,
}: JourneyMapProps) {
  const target = Math.max(0, Math.min(1, progress));
  const start = Math.max(0, Math.min(1, from));

  const { geo, dest } = useMemo(() => {
    const pts = route.points.map(project);
    return { geo: buildRouteGeometry(pts), dest: project(destination.at) };
  }, [route.points, destination.at]);

  // Tween `shown` from start → target, PAUSING on each landmark crossed to pop a
  // gold reward — so reaching a landmark is a felt beat, not a blur. The traveler
  // and gold trail grow with `shown`; the camera frames this leg's segment.
  const [shown, setShown] = useState(start);
  const [reward, setReward] = useState<{ gold: number; x: number; y: number } | null>(null);
  const onArrivedRef = useRef(onArrived);
  onArrivedRef.current = onArrived;
  useEffect(() => {
    if (target <= start + 1e-4) {
      setShown(target);
      onArrivedRef.current?.();
      return;
    }
    let cancelled = false;
    let raf = 0;
    const timers: number[] = [];
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    // Landmark fractions crossed on this leg, in order — the pause points.
    const stops = landmarks
      .map((l) => l.atFraction)
      .filter((f) => f > start + 1e-4 && f <= target + 1e-6)
      .sort((a, b) => a - b);
    const waypoints = stops.slice();
    if (waypoints.length === 0 || waypoints[waypoints.length - 1] < target - 1e-6) {
      waypoints.push(target);
    }

    const animateTo = (from: number, to: number, dur: number) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (cancelled) return;
          const t = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
          setShown(from + (to - from) * ease(t));
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
      const span = target - start;
      for (const w of waypoints) {
        await animateTo(prev, w, Math.max(350, TWEEN_MS * ((w - prev) / span)));
        if (cancelled) return;
        const lm = landmarks.find((l) => Math.abs(l.atFraction - w) < 1e-6);
        if (lm && stops.includes(w)) {
          const at = pointAtFraction(geo, w);
          setReward({ gold: lm.gold, x: at.x, y: at.y });
          await wait(PAUSE_MS);
          if (cancelled) return;
          setReward(null);
        }
        prev = w;
      }
      if (!cancelled) onArrivedRef.current?.();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [start, target, landmarks, geo]);

  // Camera: frame THIS leg's segment (zoomed in), with a little context and the
  // destination once we're near it. Static per leg; the character moves within.
  const viewBox = useMemo(() => {
    const a = Math.min(start, target);
    // Always frame some road ahead so the leg reads as travel even when the
    // segment is short, plus a little margin behind.
    const b = Math.min(1, Math.max(Math.max(start, target), a + 0.2) + 0.05);
    const lo = Math.max(0, a - 0.05);
    const seg: { x: number; y: number }[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) seg.push(pointAtFraction(geo, lo + ((b - lo) * i) / steps));
    if (target > 0.82) seg.push(dest);
    return fitViewBox(seg, { pad: 1.5, min: 150 });
  }, [geo, start, target, dest]);

  const traveler = pointAtFraction(geo, shown);
  const travelledPath = (() => {
    const targetLen = geo.length * shown;
    const pts = geo.points.filter((_, i) => geo.cumulative[i] <= targetLen);
    pts.push(traveler);
    return smoothPath(pts);
  })();
  const fullLine = smoothPath(geo.points);

  // Marker/label scale relative to the (zoomed) view. Smaller than before.
  const u = Math.max(1, Number(viewBox.split(" ")[2]) || 170) / 100;

  // Land is static — memoize so per-frame tweening doesn't reconcile ~250 paths.
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
            <path d={fullLine} fill="none" stroke="var(--map-terracotta)" strokeWidth={3} strokeOpacity={0.55} strokeDasharray="5 6" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
            <path d={travelledPath} fill="none" stroke="var(--color-chrome-gold)" strokeWidth={4} strokeOpacity={0.95} strokeLinecap="round" vectorEffect="non-scaling-stroke" data-testid="journey-route" />
          </>
        )}

        {landmarks.map((lm: DailyLandmark, i) => {
          const at = pointAtFraction(geo, lm.atFraction);
          const lit = shown >= lm.atFraction;
          const justPassed = lit && shown - lm.atFraction <= JUST_PASSED_WINDOW;
          return (
            <g key={`lm-${i}-${lm.atFraction}`} data-testid="journey-landmark" data-lit={lit ? "true" : "false"} data-fraction={lm.atFraction}>
              {lit && (
                <>
                  {justPassed && (
                    <circle cx={at.x} cy={at.y} r={2 * u} fill="none" stroke="var(--color-chrome-gold)" strokeWidth={1.2} strokeOpacity={0.6} vectorEffect="non-scaling-stroke">
                      <animate attributeName="r" values={`${u};${3.5 * u}`} dur="1.3s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values="0.8;0" dur="1.3s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={at.x} cy={at.y} r={1.1 * u} fill="var(--color-chrome-gold)" stroke="var(--map-ink)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                </>
              )}
            </g>
          );
        })}

        {/* Destination — small ringed star + label. */}
        <g data-testid="journey-destination">
          <circle cx={dest.x} cy={dest.y} r={1.9 * u} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
          <Star cx={dest.x} cy={dest.y} r={1.2 * u} fill="var(--color-accent)" />
          <text x={dest.x} y={dest.y - 2.8 * u} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={2.6 * u} fill="var(--map-ink)" style={{ paintOrder: "stroke" }} stroke="var(--map-paper)" strokeWidth={0.8 * u} strokeOpacity={0.85}>
            {destination.name}
          </text>
        </g>

        {/* Traveler. */}
        {geo.length > 0 && (
          <g data-testid="journey-traveler" data-x={traveler.x} data-y={traveler.y} transform={`translate(${traveler.x} ${traveler.y})`}>
            <circle r={1.7 * u} fill="var(--color-accent)" stroke="var(--map-paper)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            <circle r={0.6 * u} fill="var(--map-paper)" />
          </g>
        )}

        {/* Landmark reward — a rising "+gold" while the traveler pauses here. */}
        {reward && (
          <g
            key={`${reward.x},${reward.y}`}
            data-testid="landmark-reward"
            transform={`translate(${reward.x} ${reward.y})`}
            style={{ pointerEvents: "none" }}
          >
            <g className="daily-gold-pop">
              <circle r={1.5 * u} fill="var(--color-chrome-gold)" stroke="var(--map-ink)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
              <text
                y={-2.6 * u}
                textAnchor="middle"
                fontFamily="var(--font-serif)"
                fontWeight={700}
                fontSize={3.6 * u}
                fill="var(--color-chrome-gold)"
                style={{ paintOrder: "stroke" }}
                stroke="var(--map-paper)"
                strokeWidth={1 * u}
                strokeOpacity={0.9}
              >
                +{reward.gold}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
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
