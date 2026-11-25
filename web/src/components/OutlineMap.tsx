import { maps } from "../lib/maps";

/**
 * Antique-map marginalia drawn in the oceans of the backdrop: a flourished
 * compass rose, a dashed expedition route with X-mark waypoints, a little
 * sailing ship, a spouting whale, and a few mountain-range glyphs on the
 * continents — the "here be dragons" furniture of an old chart. All in the
 * world SVG's coordinate space (viewBox ~0 0 1010 666) so it scales with the
 * coastlines. Faint and decorative.
 */
function MapDecor() {
  const ink = "var(--map-ink)";
  return (
    <>
      {/* Dashed expedition route arcing across the oceans, with X waypoints. */}
      <g opacity={0.5}>
        <path
          d="M250 250 C 360 300, 430 300, 505 330 S 690 300, 770 365"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.6}
          strokeDasharray="5 5"
          strokeLinecap="round"
        />
        <g stroke="var(--color-accent)" strokeWidth={1.8} strokeLinecap="round">
          <path d="M246 246 l8 8 M254 246 l-8 8" />
          <path d="M501 326 l8 8 M509 326 l-8 8" />
          <path d="M766 361 l8 8 M774 361 l-8 8" />
        </g>
      </g>

      {/* Compass rose, lower-left ocean. */}
      <g transform="translate(120 560)" stroke={ink} fill="none" opacity={0.6}>
        <circle r={32} strokeWidth={1.2} />
        <circle r={22} strokeWidth={0.7} />
        {/* 4-point star */}
        <path
          d="M0 -30 L6 -6 L30 0 L6 6 L0 30 L-6 6 L-30 0 L-6 -6 Z"
          fill="color-mix(in srgb, var(--map-ink) 22%, transparent)"
          strokeWidth={1}
        />
        {/* diagonal thin rays */}
        <path d="M0 0 L15 -15 M0 0 L15 15 M0 0 L-15 15 M0 0 L-15 -15" strokeWidth={0.6} />
        <circle r={2.4} fill={ink} stroke="none" />
        <text
          x={0}
          y={-36}
          textAnchor="middle"
          fontSize={11}
          fontStyle="italic"
          fill={ink}
          stroke="none"
          fontFamily="var(--font-serif)"
        >
          N
        </text>
      </g>

      {/* Little sailing ship in the Indian Ocean. */}
      <g transform="translate(638 545)" stroke={ink} fill="none" opacity={0.58} strokeLinejoin="round">
        {/* hull */}
        <path d="M-15 6 Q 0 16, 15 6 L 12 6 L -12 6 Z" fill="color-mix(in srgb, var(--map-ink) 14%, transparent)" strokeWidth={1.1} />
        {/* mast */}
        <path d="M0 6 L0 -18" strokeWidth={1} />
        {/* sails */}
        <path d="M1 -16 Q 12 -10, 2 -2 Z" fill="color-mix(in srgb, var(--map-ink) 10%, transparent)" strokeWidth={0.9} />
        <path d="M-1 -14 Q -10 -9, -2 -3 Z" fill="color-mix(in srgb, var(--map-ink) 10%, transparent)" strokeWidth={0.9} />
      </g>

      {/* Spouting whale in the west Pacific. */}
      <g transform="translate(905 470)" stroke={ink} fill="none" opacity={0.55} strokeLinecap="round">
        <path
          d="M-16 2 Q -2 10, 12 4 Q 18 2, 20 -4 Q 14 0, 12 -2 Q 2 2, -16 2 Z"
          fill="color-mix(in srgb, var(--map-ink) 12%, transparent)"
          strokeWidth={1}
        />
        <path d="M20 -4 L26 -9 L23 -2 Z" fill="color-mix(in srgb, var(--map-ink) 12%, transparent)" strokeWidth={0.9} />
        {/* spout */}
        <path d="M-10 0 Q -12 -8, -9 -12 M-10 0 Q -8 -7, -6 -11 M-10 0 Q -14 -6, -13 -10" strokeWidth={0.7} />
      </g>

      {/* Mountain-range glyphs scattered on the continents. */}
      <g stroke={ink} fill="none" strokeWidth={0.9} strokeLinejoin="round" opacity={0.5}>
        <path d="M690 250 l7 -11 l5 7 l6 -9 l8 13 Z" />
        <path d="M322 470 l6 -10 l4 6 l5 -8 l7 12 Z" />
        <path d="M512 372 l6 -9 l4 6 l5 -7 l6 10 Z" />
      </g>
    </>
  );
}

/**
 * A faint, full-page world map backdrop for the Field Journal home page: every
 * country drawn as a thin sepia-ink coastline outline (no fills) on the cream
 * page, reusing the real country paths from the game map, overlaid with antique
 * chart marginalia (compass, route, ship, whale, peaks). Purely decorative —
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
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Coastlines — the faintest layer. */}
      <g stroke="var(--color-muted)" strokeWidth={0.6} opacity={0.34}>
        {world.locations.map((loc) => (
          <path key={loc.id} d={loc.path} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <MapDecor />
    </svg>
  );
}
