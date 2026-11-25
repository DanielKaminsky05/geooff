import { maps } from "../lib/maps";

/**
 * A faint, full-page world map backdrop for the Field Journal home page: every
 * country drawn as a thin sepia-ink coastline outline (no fills) on the cream
 * page, reusing the real country paths from the game map. Purely decorative —
 * aria-hidden and non-interactive — and kept subtle so UI text stays readable.
 */
export default function OutlineMap() {
  const world = maps.countries;
  if (!world) return null;
  return (
    <svg
      viewBox={world.viewBox}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="var(--color-muted)"
      strokeWidth={0.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      opacity={0.38}
    >
      {world.locations.map((loc) => (
        <path key={loc.id} d={loc.path} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
