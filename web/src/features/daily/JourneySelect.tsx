/**
 * Daily Dive — route choice, overlaid on the game board (Track C).
 *
 * No separate carded screen: the three roads are clickable dotted lines (with
 * their stops) drawn directly on the world board you'll play on, which you can
 * pan/zoom. A floating "Select your road" prompt sits on top. Click a road to
 * commit — the run begins and the first prompt pops up. Prompts and gold stay
 * hidden; the only choice is the road.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import WorldMap from "../../components/WorldMap";
import { project } from "./geo";
import { smoothPath } from "./smoothPath";
import type { DailySet, JourneyId } from "./contract";

const ORDER: JourneyId[] = ["short", "medium", "long"];
const LABEL: Record<JourneyId, string> = {
  short: "The short road",
  medium: "The winding road",
  long: "The far road",
};

const EMPTY: Set<string> = new Set();

export interface JourneySelectProps {
  set: DailySet;
  /** Commit to a road and start the run (first prompt pops up). */
  onSelect: (journeyId: JourneyId) => void;
  className?: string;
}

export default function JourneySelect({ set, onSelect, className }: JourneySelectProps) {
  const [hover, setHover] = useState<JourneyId | null>(null);

  // Keep a ref to the latest onSelect so the memo below does not need it in
  // its dependency array. Without this, an un-memoized parent would give
  // onSelect a new identity every render, busting the memo on every keystroke.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });

  // The roads + destination, drawn inside the map's svg (world coords) so they
  // pan/zoom with the board. Memoized on hover so the map repaints only then.
  const roads = useMemo(() => {
    const dest = project(set.destination.at);
    const routeOf = (id: JourneyId) => set.routes.find((r) => r.journeyId === id);
    return (
      <g>
        {ORDER.map((id) => {
          const route = routeOf(id);
          if (!route) return null;
          const pts = route.points.map(project);
          const line = smoothPath(pts);
          const on = hover === id;
          const stroke = on ? "var(--color-chrome-gold)" : "var(--map-terracotta)";
          const origin = pts[0];
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`${LABEL[id]} — journey choice`}
              data-testid={`journey-card-${id}`}
              onClick={() => onSelectRef.current(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  if (e.key === " ") e.preventDefault();
                  onSelectRef.current(id);
                }
              }}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover((h) => (h === id ? null : h))}
              onFocus={() => setHover(id)}
              onBlur={() => setHover((h) => (h === id ? null : h))}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
              opacity={hover && !on ? 0.5 : 1}
            >
              {/* Wide invisible hit area so the thin road is easy to click. */}
              <path d={line} fill="none" stroke="transparent" strokeWidth={22} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "stroke" }} />
              <path d={line} fill="none" stroke={stroke} strokeWidth={on ? 5 : 3.4} strokeDasharray="5 6" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
              {/* Stops (the locations along the way) reveal only on hover. */}
              {on &&
                pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2} fill={stroke} stroke="var(--map-paper)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
                ))}
              <text
                x={origin.x}
                y={origin.y - 5}
                textAnchor="middle"
                fontFamily="var(--font-serif)"
                fontSize={on ? 10 : 8}
                fontWeight={on ? 700 : 400}
                fill={on ? "var(--color-accent)" : "var(--map-ink)"}
                style={{ paintOrder: "stroke" }}
                stroke="var(--map-paper)"
                strokeWidth={1.8}
                strokeOpacity={0.9}
              >
                {LABEL[id]}
              </text>
            </g>
          );
        })}

        {/* Destination. */}
        <g style={{ pointerEvents: "none" }}>
          <circle cx={dest.x} cy={dest.y} r={3} fill="none" stroke="var(--color-accent)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          <Star cx={dest.x} cy={dest.y} r={1.9} fill="var(--color-accent)" />
          <text x={dest.x} y={dest.y - 5} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={8} fill="var(--map-ink)" style={{ paintOrder: "stroke" }} stroke="var(--map-paper)" strokeWidth={1.6} strokeOpacity={0.85}>
            {set.destination.name}
          </text>
        </g>
      </g>
    );
  // set.routes / set.destination.at / set.destination.name are fixed for the
  // lifetime of this screen (they come from today's immutable DailySet), so
  // listing them is safe even though they are object references — they will
  // never change identity while JourneySelect is mounted.
  }, [set.routes, set.destination.at, set.destination.name, hover]);

  return (
    <div className={`relative h-dvh w-full ${className ?? ""}`} data-testid="journey-select">
      <WorldMap filledIso={EMPTY} color="var(--color-player1)" categoryId="countries" overlay={roads} wrap={false} />

      {/* Start prompt, floating — "select your road", styled like a prompt. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 px-4 pt-4 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted [text-shadow:0_1px_2px_var(--map-paper)]">
          Today&apos;s destination · {set.destination.name}
        </p>
        <h1 className="daily-prompt-pop rounded-lg bg-[var(--map-paper)]/70 px-5 py-1.5 text-2xl font-semibold text-foreground backdrop-blur-[2px]">
          Select your road
        </h1>
        <p className="text-sm text-muted [text-shadow:0_1px_2px_var(--map-paper)]">
          A longer road carries more reward — and more risk. Click one to set out.
        </p>
      </div>
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
