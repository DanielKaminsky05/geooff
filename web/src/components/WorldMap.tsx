import { memo, useCallback, useRef, type ReactElement } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { mapFor, pathSpan, TERRITORY_PARENT } from "../lib/maps";
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
/** A decorative italic-serif ocean label, stacked one WORD per line (e.g.
 * "PACIFIC" over "OCEAN") so it stays compact and reads like a printed atlas.
 * The block is vertically centred on (x, y). */
function OceanLabel({ x, y, rotate, size, text }: { x: number; y: number; rotate?: number; size: number; text: string }): ReactElement {
  const words = text.split(" ");
  const lineH = size * 1.1;
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
      {words.map((w, i) => (
        <tspan key={i} x={x} dy={i === 0 ? (-(words.length - 1) * lineH) / 2 : lineH}>
          {w}
        </tspan>
      ))}
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
      {/* North Atlantic at ~40°N, mid-ocean between the USA east coast and
          Spain/Portugal. */}
      <OceanLabel x={365} y={340} size={11} text="ATLANTIC OCEAN" />
      {/* South Atlantic, open water between Brazil and Africa. */}
      <OceanLabel x={430} y={500} size={9} text="SOUTH ATLANTIC" />
      {/* Pacific — labeled on BOTH sides, since this equirectangular projection
          splits it at the map edges. Two smaller labels (east + west); the
          primary-tile-only decoration means no seam duplication. */}
      <OceanLabel x={80} y={340} size={12} text="PACIFIC OCEAN" />
      <OceanLabel x={920} y={340} size={11} text="PACIFIC OCEAN" />
      {/* Indian Ocean, open water just south of Sri Lanka. */}
      <OceanLabel x={708} y={488} size={10} text="INDIAN OCEAN" />
      {/* Southern Ocean band below the continents, lifted off the bottom edge. */}
      <OceanLabel x={505} y={638} size={9} text="SOUTHERN OCEAN" />
    </g>
  );
}

// Decorative cartouche title per category. The world gets the classic "The
// World"; region / us-states maps get their own name so we never mislabel the
// pane (e.g. "The World" over the US). Falls back to a neutral "The Map".
const CARTOUCHE_TITLES: Partial<Record<CategoryId, string>> = {
  countries: "The World",
  "us-states": "The United States",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  "middle-east": "The Middle East",
  americas: "The Americas",
};

/**
 * Decorative atlas "furniture" pinned to the map CONTAINER (the pane), OUTSIDE
 * the zoom/pan transform: a double-ruled neatline hugging the pane edges, a
 * small title cartouche in the top margin, and an aged alternating-segment
 * scale bar in a bottom corner. Pure SVG/CSS, pointer-events:none, kept in the
 * margins so it never obscures the land/gameplay and tracks the pane at any
 * aspect (CSS edge/corner pinning, not viewBox-space). Present on both the
 * interactive map and the static reveal.
 */
function PaneFrame({ categoryId }: { categoryId: CategoryId }): ReactElement {
  const title = CARTOUCHE_TITLES[categoryId] ?? "The Map";
  return (
    <div className="map-frame" aria-hidden="true">
      {/* Neatline: outer heavy rule + finer inner rule. */}
      <div className="map-neatline-outer" />
      <div className="map-neatline-inner" />

      {/* Title cartouche in the top margin. */}
      <div className="map-cartouche">
        <div className="map-cartouche-title">{title}</div>
        <div className="map-cartouche-rule" />
      </div>

      {/* Aged scale bar (alternating segments) in the bottom-left margin. */}
      <div className="map-scale">
        <div className="map-scale-label">Scale of Leagues</div>
        <div className="map-scale-bar">
          <span className="map-scale-seg" />
          <span className="map-scale-seg" />
          <span className="map-scale-seg" />
          <span className="map-scale-seg" />
        </div>
        <div className="map-scale-ticks">
          <span>0</span>
          <span>1000</span>
        </div>
      </div>
    </div>
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
  const paintId = `map-paint-${seq}`;
  const isWorld = categoryId === "countries";

  // --- Cylindrical horizontal wrap plumbing (world map only) ---
  // We let react-zoom-pan-pinch pan freely (limitToBounds=false) and, on every
  // transform, (a) clamp Y to the same bounds it would have used (no vertical
  // wrap) and (b) wrap X: whenever the pan has drifted more than half a
  // world-width from the centre tile, add/subtract one world-width so we stay
  // near the primary tile. Because the ±WORLD_W clones are pixel-identical to
  // the primary, that snap is invisible and the map reads as a seamless cylinder.
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Re-entrancy guard: our own setTransform re-fires onTransform.
  const wrappingRef = useRef(false);

  // World-width in on-screen pixels at the current scale. The svg letterboxes
  // its 0..WORLD_W viewBox inside its box (xMidYMid meet), so one world unit is
  // min(boxW/WORLD_W, boxH/WORLD_H) px before rzpp's scale multiplies it.
  const worldWidthPx = (scale: number): number => {
    const el = svgRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    // getBoundingClientRect already includes rzpp's scale; divide it back out to
    // get the unscaled fit, then multiply by the scale we're told to use.
    const curScale = scale || 1;
    const pxPerUnit = Math.min(r.width / curScale / WORLD_W, r.height / curScale / WORLD_H);
    return pxPerUnit * WORLD_W * scale;
  };

  const handleTransform = useCallback((ref: ReactZoomPanPinchRef) => {
    if (!isWorld || wrappingRef.current) return;
    const wrapperEl = ref.instance.wrapperComponent;
    if (!wrapperEl) return;
    const scale = ref.state.scale;
    const ww = worldWidthPx(scale);
    if (ww <= 0) return;

    let { positionX, positionY } = ref.state;

    // Clamp Y to rzpp's own vertical bounds (content is 100% of the wrapper, so
    // minY = wrapperHeight*(1-scale), maxY = 0). This keeps the familiar
    // vertical-pan feel while X roams free for the wrap.
    const wrapperHeight = wrapperEl.clientHeight;
    const minY = Math.min(0, wrapperHeight * (1 - scale));
    const clampedY = Math.max(minY, Math.min(0, positionY));

    // Wrap X toward the centre tile. The map is centred initially, so treat the
    // current centred position as the home; shifting by whole world-widths lands
    // on an identical view one tile over.
    let wrappedX = positionX;
    while (wrappedX - positionXHomeRef.current > ww / 2) wrappedX -= ww;
    while (positionXHomeRef.current - wrappedX > ww / 2) wrappedX += ww;

    if (wrappedX !== positionX || clampedY !== positionY) {
      wrappingRef.current = true;
      // No animation: an instantaneous jump by a whole (invisible) world-width.
      ref.setTransform(wrappedX, clampedY, scale, 0);
      // Release the guard after the sync setTransform + its onTransform echo.
      wrappingRef.current = false;
    }
  }, [isWorld]);

  // The centred "home" X (captured on init) that the wrap snaps around.
  const positionXHomeRef = useRef(0);
  const handleInit = useCallback((ref: ReactZoomPanPinchRef) => {
    positionXHomeRef.current = ref.state.positionX;
  }, []);

  // Split land into two layers so the filled countries can share ONE group
  // watercolor+shadow filter (depth + painted texture) while the base land
  // stays flat — and so filled land paints above its neighbours, reading as
  // lifted off the sea.
  //
  // `clone` builds the DECORATIVE wrapped copies for the cylindrical-wrap tiles
  // (see below). Clones MUST be invisible to every board/test query and the
  // anti-cheat <title> gate, so they carry NO id / data-iso / data-filled /
  // <title> — only the geometry and the mirrored fill colour. The PRIMARY tile
  // (clone=false) keeps exactly one real <path> per country, unchanged.
  function buildLand(clone: boolean): { base: ReactElement[]; lifted: ReactElement[] } {
    const base: ReactElement[] = [];
    const lifted: ReactElement[] = [];
    for (const loc of locations) {
      // A dependent territory fills with its sovereign (Greenland→dk, …).
      const key = TERRITORY_PARENT[loc.id] ?? loc.id;
      const perItem = colorByIso?.get(key);
      const filled = colorByIso ? perItem !== undefined : filledIso.has(key);
      const fill = perItem ?? (filled ? color : "var(--color-land)");
      // Cap the border on tiny countries so the stroke doesn't swamp a microstate
      // or an archipelago island (Monaco, Cabo Verde…): full weight for normal
      // land, clamped to ~10% of the largest sub-shape's span for small ones.
      const strokeW = Math.max(0.08, Math.min(filled ? 0.6 : 0.45, pathSpan(loc.path) * 0.11));
      const path = clone ? (
        <path
          key={loc.id}
          d={loc.path}
          fill={fill}
          stroke="var(--map-land-border)"
          strokeWidth={strokeW}
          strokeLinejoin="round"
        />
      ) : (
        <path
          key={loc.id}
          id={loc.id}
          data-iso={loc.id}
          data-filled={filled ? "true" : "false"}
          d={loc.path}
          fill={fill}
          stroke="var(--map-land-border)"
          strokeWidth={strokeW}
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
    return { base, lifted };
  }

  const primary = buildLand(false);
  // Clone land only matters for the wrapping WORLD map. For region/us-states
  // maps (no wrap) we never build it.
  const cloneLand = isWorld ? buildLand(true) : null;

  // One tile of the map: decoration (world only) + base land + lifted land.
  // `clone` tiles are purely decorative (aria-hidden, no interactivity, no test
  // hooks) and translated by ±WORLD_W so a continuous copy sits either side of
  // the primary tile for seamless horizontal wrapping.
  const tile = (land: { base: ReactElement[]; lifted: ReactElement[] }, clone: boolean, dx: number) => (
    <g
      key={dx}
      transform={dx ? `translate(${dx} 0)` : undefined}
      aria-hidden={clone ? "true" : undefined}
      style={clone ? { pointerEvents: "none" } : undefined}
    >
      {/* World-only printed-atlas decoration, behind the land so land covers
          it. Guarded off the cropped region / us-states maps whose viewBox
          wouldn't suit these world-space positions. Rendered on the PRIMARY tile
          only (not the wrap clones) so the ocean names don't repeat at the seam. */}
      {isWorld && !clone && (
        <g>
          <OceanLabels />
        </g>
      )}
      {/* Base (unguessed) parchment land with thin sepia coastlines. */}
      <g>{land.base}</g>
      {/* Filled land: watercolor wash + inked edges, painted above (flat, no
          lift shadow). */}
      <g filter={`url(#${paintId})`}>{land.lifted}</g>
    </g>
  );

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
      ref={svgRef}
      viewBox={viewBox}
      width="100%"
      height="100%"
      role="img"
      aria-label="World map"
      preserveAspectRatio="xMidYMid meet"
      // The wrap tiles sit at x = ±WORLD_W, outside the viewBox; let them show
      // (and get clipped by the pane's own overflow:hidden) as you pan across
      // the seam. Region/us-states maps keep the default clip.
      style={{ display: "block", background: "transparent", overflow: isWorld ? "visible" : undefined }}
    >
      <defs>
        {/* ONE group-level WATERCOLOR filter for the filled land: a soft
            turbulence displaces the painted fill for a wobbly, mottled
            hand-brushed edge, and a second turbulence overlays a faint mottle
            so the wash reads as pigment on paper rather than a flat colour.
            Group-scoped (not per-path) so ~250 paths stay cheap. */}
        <filter id={paintId} x="-15%" y="-15%" width="130%" height="130%">
          {/* Wobble the shape edges a touch (brushed coastline). */}
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.022" numOctaves={2} seed={7} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={2.2} xChannelSelector="R" yChannelSelector="G" result="warped" />
          {/* Age the pigment lightly: a touch of desaturation + a small wash so
              the fill reads as watercolour, but stays close to the true seat
              colour (the HUD shows the unfiltered colour, so over-washing made
              the green read grey/blue — keep it faithful). */}
          <feColorMatrix in="warped" type="saturate" values="0.82" result="muted" />
          <feComponentTransfer in="muted" result="painted">
            <feFuncR type="linear" slope="0.88" intercept="0.07" />
            <feFuncG type="linear" slope="0.88" intercept="0.07" />
            <feFuncB type="linear" slope="0.88" intercept="0.07" />
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

      {/* Cylindrical horizontal wrap: for the world, flank the real (primary)
          tile with purely-decorative clones translated by ±WORLD_W so panning
          past either edge always shows continuous map. The pan offset is
          snapped back by one world-width at each seam (see onTransform) so the
          clones are only ever briefly on-screen and the snap is invisible. */}
      {cloneLand && tile(cloneLand, true, -WORLD_W)}
      {tile(primary, false, 0)}
      {cloneLand && tile(cloneLand, true, WORLD_W)}
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
        <PaneFrame categoryId={categoryId} />
      </div>
    );
  }

  return (
    <div className={`${className ?? ""} absolute inset-0`} data-testid="world-map">
      {/* Backdrop OUTSIDE the transform so the paper/sea stays fixed while the
          land pans/zooms over it. */}
      {backdrop}
      <TransformWrapper
        minScale={1}
        maxScale={8}
        centerOnInit
        disablePadding
        doubleClick={{ mode: "zoomIn" }}
        // World map wraps horizontally: let X roam free (we clamp Y and wrap X
        // ourselves in onTransform). Region/us-states maps keep the default
        // clamped bounds unchanged.
        limitToBounds={!isWorld}
        onInit={isWorld ? handleInit : undefined}
        onTransform={isWorld ? handleTransform : undefined}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          {svg}
        </TransformComponent>
      </TransformWrapper>
      {/* Atlas furniture pinned to the pane, OUTSIDE the transform so it stays
          fixed in the margins while the land pans/zooms. */}
      <PaneFrame categoryId={categoryId} />
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
