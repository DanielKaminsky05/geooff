/**
 * Daily Dive — journey map (owned by Track D).
 *
 * Renders a REGIONAL atlas fitted to the chosen route (the whole-world view
 * makes a real route — a few hundred km — an invisible speck), with the route
 * drawn on it, a traveler token eased to `progress` (0..1) along the route, and
 * landmark pins revealed as they're passed. Purely presentational — driven
 * entirely by props, so the page can animate `progress` without knowing the
 * internals.
 *
 * The prop signature is the FROZEN CONTRACT. We fit by projecting the route to
 * world-SVG coordinates (geo.project, shared with the land paths' coordinate
 * space) and setting the svg viewBox to a padded bounding box around it.
 */

import { useMemo } from "react";

import { maps } from "../../lib/maps";
import type { DailyDestination, DailyLandmark, DailyRoute } from "../../lib/protocol";
import { project, fitViewBox } from "./geo";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";

export interface JourneyMapProps {
  /** The active journey's route polyline (start → destination). */
  route: DailyRoute;
  /** The day's destination city (drawn as the end marker). */
  destination: DailyDestination;
  /** Landmarks along this journey (pins; revealed once progress passes them). */
  landmarks: DailyLandmark[];
  /** 0..1 — fraction of the route the traveler has covered. */
  progress: number;
  className?: string;
}

/** How close (in fraction) a landmark counts as "just passed" for the glow ring. */
const JUST_PASSED_WINDOW = 0.08;

export default function JourneyMap({
  route,
  destination,
  landmarks,
  progress,
  className,
}: JourneyMapProps) {
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Project the route + destination once; derive geometry + a fitted viewBox.
  const { geo, dest, viewBox } = useMemo(() => {
    const pts = route.points.map(project);
    const dest = project(destination.at);
    return {
      geo: buildRouteGeometry(pts),
      dest,
      viewBox: fitViewBox([...pts, dest]),
    };
  }, [route.points, destination.at]);

  const polyline = geo.points.map((p) => `${p.x},${p.y}`).join(" ");
  const traveler = pointAtFraction(geo, clampedProgress);

  // The already-travelled leg: every waypoint up to the traveler, then the
  // traveler itself — drawn solid/gold so progress reads at a glance.
  const travelledPolyline = (() => {
    const targetLen = geo.length * clampedProgress;
    const pts = geo.points.filter((_, i) => geo.cumulative[i] <= targetLen);
    pts.push(traveler);
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  })();

  const land = maps.countries?.locations ?? [];
  // Size markers/labels relative to the fitted view so they read the same
  // whether the trek spans a region or a continent.
  const u = Math.max(1, Number(viewBox.split(" ")[2]) || 230) / 100;
  const rootClassName = ["daily-journey-map", className].filter(Boolean).join(" ");

  return (
    <div
      className={rootClassName}
      style={{ position: "relative", width: "100%", height: "100%" }}
      aria-label={`Journey to ${destination.name}`}
    >
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={`Route to ${destination.name}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Sea wash + regional land, fitted to the route. */}
        <rect x={-2000} y={-2000} width={4000} height={4000} fill="var(--map-ocean-bottom)" />
        {land.map((loc) => (
          <path
            key={loc.id}
            d={loc.path}
            fill="var(--color-land)"
            stroke="var(--map-land-border)"
            strokeWidth={0.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {geo.points.length >= 2 && (
          <>
            {/* Full route, faint, so the whole road reads at a glance. */}
            <polyline
              points={polyline}
              fill="none"
              stroke="var(--map-terracotta)"
              strokeWidth={2}
              strokeOpacity={0.45}
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />
            {/* Travelled portion, solid + gold up to the token. */}
            <polyline
              points={travelledPolyline}
              fill="none"
              stroke="var(--color-chrome-gold)"
              strokeWidth={3}
              strokeOpacity={0.95}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              data-testid="journey-route"
            />
          </>
        )}

        {/* Landmark pins — revealed only once the traveler has passed them (the
            `<g>` stays in the DOM either way so counts/aria are stable). */}
        {landmarks.map((lm: DailyLandmark, i) => {
          const at = pointAtFraction(geo, lm.atFraction);
          const lit = clampedProgress >= lm.atFraction;
          const justPassed = lit && clampedProgress - lm.atFraction <= JUST_PASSED_WINDOW;
          return (
            <g
              key={`lm-${i}-${lm.atFraction}`}
              data-testid="journey-landmark"
              data-lit={lit ? "true" : "false"}
              data-fraction={lm.atFraction}
            >
              {lit && (
                <>
                  {justPassed && (
                    <circle cx={at.x} cy={at.y} r={3 * u} fill="none" stroke="var(--color-chrome-gold)" strokeWidth={1.5} strokeOpacity={0.6} vectorEffect="non-scaling-stroke">
                      <animate attributeName="r" values={`${1.5 * u};${4.5 * u}`} dur="1.4s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values="0.8;0" dur="1.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={at.x} cy={at.y} r={1.6 * u} fill="var(--color-chrome-gold)" stroke="var(--map-ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                </>
              )}
            </g>
          );
        })}

        {/* Destination: ringed star + serif label. */}
        <g data-testid="journey-destination">
          <circle cx={dest.x} cy={dest.y} r={2.6 * u} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <Star cx={dest.x} cy={dest.y} r={1.8 * u} fill="var(--color-accent)" />
          <text
            x={dest.x}
            y={dest.y - 4 * u}
            textAnchor="middle"
            fontFamily="var(--font-serif)"
            fontSize={4 * u}
            fill="var(--map-ink)"
            style={{ paintOrder: "stroke" }}
            stroke="var(--map-paper)"
            strokeWidth={u}
            strokeOpacity={0.85}
          >
            {destination.name}
          </text>
        </g>

        {/* Traveler token — transitions smoothly as `progress` changes. */}
        {geo.length > 0 && (
          <g
            data-testid="journey-traveler"
            data-x={traveler.x}
            data-y={traveler.y}
            transform={`translate(${traveler.x} ${traveler.y})`}
            style={{ transition: "transform 650ms ease-out" }}
          >
            <circle r={2.4 * u} fill="var(--color-accent)" stroke="var(--map-paper)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <circle r={0.9 * u} fill="var(--map-paper)" />
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
