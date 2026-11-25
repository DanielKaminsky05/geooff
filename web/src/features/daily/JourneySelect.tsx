/**
 * Daily Dive — route choice (Track C).
 *
 * The wager, made BEFORE you play and WITHOUT seeing the prompts: three routes
 * to the day's destination, drawn on the map. You pick which road to take —
 * longer roads reach further (and carry more reward) but demand a stronger run.
 * The prompts and the gold at stake are deliberately hidden; the only thing you
 * choose is the route.
 */

import { useMemo, useState } from "react";
import { maps } from "../../lib/maps";
import { fitViewBox, project } from "./geo";
import type { DailySet, JourneyId } from "./contract";

const ORDER: JourneyId[] = ["short", "medium", "long"];

const FEEL: Record<JourneyId, { title: string; blurb: string }> = {
  short: { title: "The short road", blurb: "A nearer start. A surer bet." },
  medium: { title: "The long road", blurb: "Begin farther out. A real stretch." },
  long: { title: "The far road", blurb: "A world away — only if you know your geography." },
};

export interface JourneySelectProps {
  set: DailySet;
  /** Commit to a route and start the run. */
  onSelect: (journeyId: JourneyId) => void;
  className?: string;
}

export default function JourneySelect({ set, onSelect, className }: JourneySelectProps) {
  // The route highlighted on the map (hover, defaulting to medium so the map is
  // never bare). Picking a card starts the run.
  const [focus, setFocus] = useState<JourneyId>("long");
  const dest = project(set.destination.at);
  const routeOf = (id: JourneyId) => set.routes.find((r) => r.journeyId === id);
  const land = maps.countries?.locations ?? [];

  // Fit the atlas to all three routes + the destination, so the roads are
  // visible rather than a speck on the whole world.
  const viewBox = useMemo(() => {
    const pts = [project(set.destination.at)];
    for (const r of set.routes) for (const p of r.points) pts.push(project(p));
    return fitViewBox(pts, { pad: 1.6 });
  }, [set.routes, set.destination.at]);
  // Marker size relative to the fitted view (regional vs continental).
  const u = Math.max(1, Number(viewBox.split(" ")[2]) || 230) / 100;

  return (
    <section
      className={`mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-5 p-5 ${className ?? ""}`}
      data-testid="journey-select"
    >
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Today&apos;s destination</p>
        <h1 className="text-3xl font-semibold">{set.destination.name}</h1>
        <p className="mt-1 text-sm text-muted">Choose your road. You won&apos;t see the prompts first.</p>
      </header>

      {/* The three candidate routes on a regional atlas; the focused one stands out. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
          strokeLinejoin="round"
        >
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
          {ORDER.map((id) => {
            const route = routeOf(id);
            if (!route) return null;
            const on = focus === id;
            const pts = route.points.map(project);
            const stroke = on ? "var(--color-chrome-gold)" : "var(--map-terracotta)";
            return (
              <g key={id} opacity={on ? 1 : 0.5}>
                {/* Dotted road. */}
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={on ? 3 : 1.8}
                  strokeDasharray="1 7"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Each stop along the way. */}
                {pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={(on ? 1.8 : 1.3) * u}
                    fill={stroke}
                    stroke="var(--map-paper)"
                    strokeWidth={0.8}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            );
          })}
          <circle
            cx={dest.x}
            cy={dest.y}
            r={2.4 * u}
            fill="var(--color-accent)"
            stroke="var(--map-paper)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* Which road? No prompts, no gold — just the choice. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ORDER.map((id) => {
          const feel = FEEL[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              onMouseEnter={() => setFocus(id)}
              onFocus={() => setFocus(id)}
              data-testid={`journey-card-${id}`}
              className={`flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition hover:brightness-105 ${
                focus === id
                  ? "border-[var(--color-chrome-gold)] bg-surface-raised"
                  : "border-[var(--color-chrome-gold)]/40 bg-surface-raised"
              }`}
            >
              <span className="text-lg font-semibold">{feel.title}</span>
              <span className="text-sm text-muted">{feel.blurb}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
