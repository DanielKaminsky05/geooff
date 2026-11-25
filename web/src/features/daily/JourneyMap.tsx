/**
 * Daily Dive — journey map (owned by Track D).
 *
 * Renders the atlas world as a backdrop with the active journey's route drawn
 * on it, a traveler token eased to `progress` (0..1) along the route, and
 * landmark pins that light up as they're passed. Purely presentational — driven
 * entirely by props, so Track C can place it and animate `progress` without
 * knowing its internals.
 *
 * The prop signature below is the FROZEN CONTRACT; Track D fills in the body
 * (use `geo.ts` project()/WORLD_VIEWBOX to align with the atlas) but keeps props.
 */

import { useMemo } from "react";

import OutlineMap from "../../components/OutlineMap";
import type { DailyDestination, DailyLandmark, DailyRoute } from "../../lib/protocol";
import { WORLD_VIEWBOX, project } from "./geo";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";

export interface JourneyMapProps {
  /** The active journey's route polyline (start → destination). */
  route: DailyRoute;
  /** The day's destination city (drawn as the end marker). */
  destination: DailyDestination;
  /** Landmarks along this journey (pins; lit once progress passes atFraction). */
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

  // Project every waypoint once; derive cumulative-length geometry from it so
  // landmark/traveler placement is by arc length, aligned with the atlas.
  const geo = useMemo(
    () => buildRouteGeometry(route.points.map(project)),
    [route.points],
  );

  const polyline = geo.points.map((p) => `${p.x},${p.y}`).join(" ");
  const traveler = pointAtFraction(geo, clampedProgress);
  const dest = project(destination.at);

  const rootClassName = ["daily-journey-map", className].filter(Boolean).join(" ");

  return (
    <div
      className={rootClassName}
      style={{ position: "relative", width: "100%", height: "100%" }}
      aria-label={`Journey to ${destination.name}`}
    >
      {/* Aged-paper atlas backdrop (fills the container). */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <OutlineMap />
      </div>

      {/* Journey overlay, same world viewBox so it lines up with the backdrop. */}
      <svg
        viewBox={WORLD_VIEWBOX}
        role="img"
        aria-label={`Route to ${destination.name}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {geo.points.length >= 2 && (
          /* The journey route, drawn as a dashed terracotta thread. */
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--map-terracotta)"
            strokeWidth={1.6}
            strokeOpacity={0.45}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            data-testid="journey-route"
          />
        )}

        {/* Landmark pins along the route by arc length. */}
        {landmarks.map((lm: DailyLandmark, i) => {
          const at = pointAtFraction(geo, lm.atFraction);
          const lit = clampedProgress >= lm.atFraction;
          const justPassed =
            lit && clampedProgress - lm.atFraction <= JUST_PASSED_WINDOW;
          return (
            <g
              key={`lm-${i}-${lm.atFraction}`}
              data-testid="journey-landmark"
              data-lit={lit ? "true" : "false"}
              data-fraction={lm.atFraction}
            >
              {justPassed && (
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={6}
                  fill="none"
                  stroke="var(--color-chrome-gold)"
                  strokeWidth={1.2}
                  strokeOpacity={0.6}
                  vectorEffect="non-scaling-stroke"
                >
                  <animate
                    attributeName="r"
                    values="3;8"
                    dur="1.4s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="stroke-opacity"
                    values="0.7;0"
                    dur="1.4s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                cx={at.x}
                cy={at.y}
                r={2.6}
                fill={lit ? "var(--color-chrome-gold)" : "var(--map-paper)"}
                stroke={lit ? "var(--color-chrome-gold)" : "var(--map-ink)"}
                strokeWidth={1}
                strokeOpacity={lit ? 1 : 0.7}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* Destination: ringed star + serif label. */}
        <g data-testid="journey-destination">
          <circle
            cx={dest.x}
            cy={dest.y}
            r={5}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          <Star cx={dest.x} cy={dest.y} r={3.4} fill="var(--color-accent)" />
          <text
            x={dest.x}
            y={dest.y - 8}
            textAnchor="middle"
            fontFamily="var(--font-serif)"
            fontSize={11}
            fill="var(--map-ink)"
            style={{ paintOrder: "stroke" }}
            stroke="var(--map-paper)"
            strokeWidth={2.5}
            strokeOpacity={0.8}
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
            style={{ transition: "transform 600ms ease-out" }}
          >
            <circle
              r={3.6}
              fill="var(--color-accent)"
              stroke="var(--map-paper)"
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
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
