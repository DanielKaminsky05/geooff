import { memo, type ReactElement } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { mapFor, TERRITORY_PARENT } from "../lib/maps";
import type { CategoryId } from "../lib/protocol";

export interface WorldMapProps {
  /** ISO alpha-2 LOWERCASE codes that are filled. */
  filledIso: Set<string>;
  /** CSS color for filled countries (e.g. "var(--color-player1)"). */
  color: string;
  /**
   * Per-item fill colors (id → color). When given it takes precedence over
   * `filledIso`/`color` — used by the shared Last Standing map to colour each
   * claimed item by the player who took it.
   */
  colorByIso?: Map<string, string>;
  /** Which set's map to render (default "countries"). */
  categoryId?: CategoryId;
  /**
   * When false, suppress the per-country <title> tooltip so hovering can't
   * reveal the spelling of a country. Defaults true (your own map). Opponents'
   * maps pass false (anti-cheat-lite).
   */
  revealNames?: boolean;
  /**
   * When false, render a plain (non-zoom/pan) svg — used by the end-of-prompt
   * reveal, which just needs a static highlighted snapshot. Defaults true.
   */
  interactive?: boolean;
  /**
   * Overrides the container test id (default "world-map"). The reveal map passes
   * its own so it is not mistaken for a player's board in queries/tests.
   */
  testId?: string;
  className?: string;
}

// Each TransformComponent / reveal needs a unique filter id so multiple maps on
// one page don't share (and clip to the first mounted map's) defs.
let filterSeq = 0;

// The @svg-maps/world equirectangular viewBox is "0 0 1010 666". The map spans
// roughly 83.6°N (y=0) to 56°S (y=666); the equator therefore sits a little
// below the vertical centre. These constants place the decorative graticule,
// equator line and ocean labels in that world coordinate space.
const WORLD_W = 1010;
const WORLD_H = 666;
const EQUATOR_Y = 390; // ~0° latitude in this projection
// The map top (y=0) is ~83.6°N, so in this equirectangular space the vertical
// scale is EQUATOR_Y / 83.6 px per degree of latitude. latToY places any
// parallel in the same coordinate space the equator/graticule use, so the
// reference lines line up exactly with the existing decoration.
const PX_PER_DEG_LAT = EQUATOR_Y / 83.6;
const latToY = (lat: number): number => EQUATOR_Y - lat * PX_PER_DEG_LAT;

/**
 * Faint lat/long graticule + dashed sepia equator, drawn in world coordinates.
 * Low-contrast so it reads as printed grid lines on the atlas page, not UI.
 * World-only (positions suit the full equirectangular viewBox).
 */
function Graticule(): ReactElement {
  const lines: ReactElement[] = [];
  // Meridians every ~84px (≈ every 30° of longitude).
  for (let x = 0; x <= WORLD_W; x += WORLD_W / 12) {
    lines.push(
      <line key={`v${x}`} x1={x} y1={0} x2={x} y2={WORLD_H} stroke="var(--map-ink)" strokeWidth={0.25} strokeOpacity={0.14} />,
    );
  }
  // Parallels every ~95px (≈ every 20° of latitude).
  for (let y = 0; y <= WORLD_H; y += WORLD_H / 7) {
    lines.push(
      <line key={`h${y}`} x1={0} y1={y} x2={WORLD_W} y2={y} stroke="var(--map-ink)" strokeWidth={0.25} strokeOpacity={0.14} />,
    );
  }
  return (
    <g aria-hidden="true">
      {lines}
      {/* Dashed terracotta equator */}
      <line
        x1={0}
        y1={EQUATOR_Y}
        x2={WORLD_W}
        y2={EQUATOR_Y}
        stroke="var(--map-terracotta)"
        strokeWidth={0.8}
        strokeOpacity={0.6}
        strokeDasharray="5 4"
      />
    </g>
  );
}

// The four classic reference parallels. Each gets a faint dashed line at
// latToY(lat) plus a small italic-serif sepia label, consistent with the
// dashed equator — pure geography decoration, not country answers.
const REFERENCE_PARALLELS: { lat: number; label: string }[] = [
  { lat: 66.5, label: "Arctic Circle" },
  { lat: 23.5, label: "Tropic of Cancer" },
  { lat: -23.5, label: "Tropic of Capricorn" },
  { lat: -66.5, label: "Antarctic Circle" },
];

/**
 * Faint DASHED, LABELED latitude reference lines (tropics + polar circles),
 * placed with latToY so they share the equator/graticule coordinate space.
 * Kept subtle (same ink/weight family as the graticule) so they read as printed
 * atlas lines. World-only. Pure geography decoration — reveals no country.
 */
function ReferenceParallels(): ReactElement {
  return (
    <g aria-hidden="true">
      {REFERENCE_PARALLELS.map(({ lat, label }) => {
        const y = latToY(lat);
        return (
          <g key={label}>
            <line
              x1={0}
              y1={y}
              x2={WORLD_W}
              y2={y}
              stroke="var(--map-ink)"
              strokeWidth={0.4}
              strokeOpacity={0.3}
              strokeDasharray="3 5"
            />
            {/* Label sits just above the line, out over the open Pacific on the
                left edge so it rarely collides with land. */}
            <text
              x={14}
              y={y - 3}
              fill="var(--map-ink)"
              fillOpacity={0.5}
              fontFamily="var(--font-serif)"
              fontStyle="italic"
              fontSize={9}
              style={{ userSelect: "none" }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** A single decorative italic-serif ocean label. */
function OceanLabel({ x, y, rotate, size, text }: { x: number; y: number; rotate?: number; size: number; text: string }): ReactElement {
  return (
    <text
      x={x}
      y={y}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
      textAnchor="middle"
      fill="var(--map-ink)"
      fillOpacity={0.42}
      fontFamily="var(--font-serif)"
      fontStyle="italic"
      fontSize={size}
      letterSpacing={size * 0.22}
      aria-hidden="true"
      style={{ userSelect: "none" }}
    >
      {text}
    </text>
  );
}

/**
 * Static italic-serif labels over open-ocean regions of the WORLD viewBox.
 * Pure geography decoration (not country answers), so fine to render; positions
 * only suit the full world map, hence world-only.
 */
function OceanLabels(): ReactElement {
  return (
    <g aria-hidden="true">
      <OceanLabel x={320} y={300} size={16} text="A T L A N T I C   O C E A N" />
      <OceanLabel x={150} y={470} size={14} text="P A C I F I C   O C E A N" />
      <OceanLabel x={930} y={320} size={14} text="P A C I F I C" />
      <OceanLabel x={720} y={470} size={14} text="I N D I A N   O C E A N" />
      <OceanLabel x={505} y={648} size={12} text="S O U T H E R N   O C E A N" />
    </g>
  );
}

/**
 * Understated SVG compass rose in an open-ocean area (south Pacific), drawn in
 * sepia ink at low opacity. World-only decoration.
 */
function Compass(): ReactElement {
  const cx = 170;
  const cy = 300;
  const r = 26;
  const ink = "var(--map-ink)";
  return (
    <g aria-hidden="true" stroke={ink} fill={ink} opacity={0.3}>
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={r * 0.62} fill="none" strokeWidth={0.4} />
      {/* Eight-point star: long N/S/E/W spokes, short diagonals. */}
      <polygon
        points={`${cx},${cy - r} ${cx + r * 0.16},${cy - r * 0.16} ${cx + r},${cy} ${cx + r * 0.16},${cy + r * 0.16} ${cx},${cy + r} ${cx - r * 0.16},${cy + r * 0.16} ${cx - r},${cy} ${cx - r * 0.16},${cy - r * 0.16}`}
        fillOpacity={0.5}
        strokeWidth={0.3}
      />
      <text x={cx} y={cy - r - 3} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={9} strokeWidth={0} fillOpacity={0.9}>
        N
      </text>
    </g>
  );
}

/**
 * Renders the world map as an <svg> with one <path> per country, styled as a
 * light printed political ATLAS on aged paper (Victoria-3 look).
 *
 * Full-bleed architecture (kept from the flat base): the aged paper + pale sea
 * wash + vignette are painted on the CONTAINER backdrop (see `.map-ocean`); the
 * svg itself is transparent and sits above it. The sea/paper fills the whole
 * pane edge-to-edge with no bare side bands.
 *
 * On top of the paper the svg draws (world-only) a faint graticule, a dashed
 * terracotta equator, italic-serif ocean labels and a compass rose; then the
 * land. Unguessed land is warm parchment with thin sepia coastlines; named land
 * gets a hand-painted WATERCOLOR wash via ONE group-level feTurbulence +
 * feDisplacementMap (mottled/wobbly) plus inked edges and a soft lift shadow —
 * group-scoped, never per-path, so ~250 paths stay cheap.
 */
function WorldMapInner({ filledIso, color, colorByIso, categoryId = "countries", revealNames = true, interactive = true, testId = "world-map", className }: WorldMapProps) {
  const { viewBox, locations } = mapFor(categoryId);
  const seq = (filterSeq++).toString(36);
  const liftId = `map-lift-${seq}`;
  const paintId = `map-paint-${seq}`;
  const isWorld = categoryId === "countries";

  // Split land into two layers so the filled countries can share ONE group
  // watercolor+shadow filter (depth + painted texture) while the base land
  // stays flat — and so filled land paints above its neighbours, reading as
  // lifted off the sea.
  const base: ReactElement[] = [];
  const lifted: ReactElement[] = [];
  for (const loc of locations) {
    // A dependent territory fills with its sovereign (Greenland→dk, …).
    const key = TERRITORY_PARENT[loc.id] ?? loc.id;
    const perItem = colorByIso?.get(key);
    const filled = colorByIso ? perItem !== undefined : filledIso.has(key);
    const fill = perItem ?? (filled ? color : "var(--color-land)");
    const path = (
      <path
        key={loc.id}
        id={loc.id}
        data-iso={loc.id}
        data-filled={filled ? "true" : "false"}
        d={loc.path}
        fill={fill}
        stroke="var(--map-land-border)"
        strokeWidth={filled ? 0.5 : 0.35}
        strokeLinejoin="round"
      >
        {/* Only reveal names of countries already guessed — a tooltip on
            unguessed ones would leak the answer. And only on your own map:
            an opponent's hover tooltip would otherwise leak spellings you
            haven't named yet. */}
        {filled && revealNames && <title>{loc.name}</title>}
      </path>
    );
    (filled ? lifted : base).push(path);
  }

  // Pin absolutely to fill the pane without contributing an intrinsic size.
  // A portrait region viewBox (the Americas run Arctic→Patagonia) gave the
  // <svg height="100%"> an aspect-ratio-derived intrinsic height that blew out
  // its grid/flex track far past the viewport, so the map rendered stuck
  // scrolled to the top with South America below the fold. Taking it out of
  // flow (inset-0 over the `relative` pane) makes it track the pane's real box;
  // `xMidYMid meet` then fits the whole region, portrait or wide. The svg has
  // NO paper/sea fill — that is the container backdrop below.
  const svg = (
    <svg
      viewBox={viewBox}
      width="100%"
      height="100%"
      role="img"
      aria-label="World map"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", background: "transparent" }}
    >
      <defs>
        {/* ONE group-level soft lift shadow for filled land (depth). */}
        <filter id={liftId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.5" floodColor="#4a371c" floodOpacity="0.4" />
        </filter>

        {/* ONE group-level WATERCOLOR filter for the filled land: a soft
            turbulence displaces the painted fill for a wobbly, mottled
            hand-brushed edge, and a second turbulence overlays a faint mottle
            so the wash reads as pigment on paper rather than a flat colour.
            Group-scoped (not per-path) so ~250 paths stay cheap. */}
        <filter id={paintId} x="-15%" y="-15%" width="130%" height="130%">
          {/* Wobble the shape edges a touch (brushed coastline). */}
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.022" numOctaves={2} seed={7} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={2.2} xChannelSelector="R" yChannelSelector="G" result="warped" />
          {/* Age the pigment: desaturate the vivid seat colour toward a faded
              wash, then lift the low end + pull the high end down so it reads as
              thin watercolour on paper rather than a flat neon fill. Colours
              stay distinguishable (hue preserved), just muted. */}
          <feColorMatrix in="warped" type="saturate" values="0.5" result="muted" />
          <feComponentTransfer in="muted" result="painted">
            <feFuncR type="linear" slope="0.72" intercept="0.2" />
            <feFuncG type="linear" slope="0.72" intercept="0.2" />
            <feFuncB type="linear" slope="0.72" intercept="0.2" />
          </feComponentTransfer>
          {/* A faint mottle over the wash → pigment granulation on paper. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves={2} seed={11} result="grain" />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.14 0"
            result="grainA"
          />
          <feComposite in="grainA" in2="painted" operator="in" result="grainMasked" />
          <feMerge>
            <feMergeNode in="painted" />
            <feMergeNode in="grainMasked" />
          </feMerge>
        </filter>
      </defs>

      {/* World-only printed-atlas decoration, behind the land so land covers
          it. Guarded off the cropped region / us-states maps whose viewBox
          wouldn't suit these world-space positions. */}
      {isWorld && (
        <g>
          <Graticule />
          <OceanLabels />
          <Compass />
        </g>
      )}

      {/* Base (unguessed) parchment land with thin sepia coastlines. */}
      <g>{base}</g>
      {/* Filled land: watercolor wash + inked/lifted edges, painted above. */}
      <g filter={`url(#${liftId})`}>
        <g filter={`url(#${paintId})`}>{lifted}</g>
      </g>
    </svg>
  );

  // Full-bleed backdrop: aged paper + pale sea wash + vignette that fills the
  // whole container (100% w/h) at any pane aspect, so there are NO bare side
  // bands where the svg letterboxes.
  const backdrop = <div className="map-ocean absolute inset-0" aria-hidden="true" />;

  // Static snapshot (the reveal): no zoom/pan layer, just backdrop + svg. The
  // svg sits above the fixed full-bleed backdrop.
  if (!interactive) {
    return (
      <div className={`${className ?? ""} absolute inset-0`} data-testid={testId}>
        {backdrop}
        <div className="absolute inset-0">{svg}</div>
      </div>
    );
  }

  return (
    <div className={`${className ?? ""} absolute inset-0`} data-testid="world-map">
      {/* Backdrop OUTSIDE the transform so the paper/sea stays fixed while the
          land pans/zooms over it. */}
      {backdrop}
      <TransformWrapper minScale={1} maxScale={8} centerOnInit disablePadding doubleClick={{ mode: "zoomIn" }}>
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          {svg}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function sameColors(a: Map<string, string> | undefined, b: Map<string, string> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Re-rendering a map walks every path (~250 for the world), so compare the
 * fill inputs by CONTENT: a room_state snapshot rebuilds every filled Set even
 * when nothing changed, and that must not repaint all the maps. Comparing a
 * ≤250-entry set is far cheaper than reconciling the SVG.
 */
function propsEqual(prev: WorldMapProps, next: WorldMapProps): boolean {
  return (
    prev.color === next.color &&
    prev.categoryId === next.categoryId &&
    prev.revealNames === next.revealNames &&
    prev.interactive === next.interactive &&
    prev.testId === next.testId &&
    prev.className === next.className &&
    sameSet(prev.filledIso, next.filledIso) &&
    sameColors(prev.colorByIso, next.colorByIso)
  );
}

export const WorldMap = memo(WorldMapInner, propsEqual);
export default WorldMap;
