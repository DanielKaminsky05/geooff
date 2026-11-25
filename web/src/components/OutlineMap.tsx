import { maps } from "../lib/maps";

/*
 * Projection calibration for the @svg-maps/world paths (equirectangular-ish):
 * the equator sits at y≈464, ~3.138 px per degree of latitude, and
 * x = 475.32 + 2.8732·lon. Used to lay a graticule (meridians/parallels) and
 * the tropics/equator over the real coastlines so the backdrop reads as a
 * proper printed atlas rather than floating outlines.
 */
const X0 = 475.32;
const PX_PER_DEG_LON = 2.8732;
const EQUATOR_Y = 464;
const PX_PER_DEG_LAT = 3.138;
const lonToX = (lon: number) => X0 + PX_PER_DEG_LON * lon;
const latToY = (lat: number) => EQUATOR_Y - PX_PER_DEG_LAT * lat;

const MERIDIANS = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
const PARALLELS = [-60, -30, 0, 30, 60];
const TROPIC = 23.4366;

function OceanName({ x, y, size, text }: { x: number; y: number; size: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontFamily="var(--font-serif)"
      fontStyle="italic"
      fontSize={size}
      letterSpacing={size * 0.22}
      fill="var(--map-ink)"
      opacity={0.42}
    >
      {text}
    </text>
  );
}

/**
 * The Field Journal home backdrop: the real world rendered as an aged printed
 * atlas that fills the page. Continents are tinted parchment land with thin
 * sepia coastlines, overlaid with a faint graticule (meridians + parallels), a
 * dashed terracotta equator and tropics, and italic serif ocean names — the
 * paper + sea wash behind it is painted on the container (.home-bg). Purely
 * decorative: aria-hidden, non-interactive, kept subtle so UI text stays legible.
 */
export default function OutlineMap() {
  const world = maps.countries;
  if (!world) return null;
  const [vx, vy, vw, vh] = world.viewBox.split(/\s+/).map(Number);
  const x0 = vx;
  const x1 = vx + vw;
  const y0 = vy;
  const y1 = vy + vh;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  return (
    <svg
      viewBox={world.viewBox}
      aria-hidden="true"
      focusable="false"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Graticule: faint sepia meridians + parallels. */}
      <g stroke="var(--map-ink)" strokeWidth={0.4} opacity={0.2}>
        {MERIDIANS.map((lon) => {
          const x = lonToX(lon);
          if (x < x0 || x > x1) return null;
          return <line key={`m${lon}`} x1={x} y1={y0} x2={x} y2={y1} />;
        })}
        {PARALLELS.map((lat) => {
          const y = latToY(lat);
          return <line key={`p${lat}`} x1={x0} y1={y} x2={x1} y2={y} />;
        })}
      </g>

      {/* Equator (solid) + tropics (dashed), in terracotta. */}
      <g stroke="var(--map-terracotta)" strokeWidth={0.6} opacity={0.4} fill="none">
        <line x1={x0} y1={latToY(0)} x2={x1} y2={latToY(0)} />
        <line x1={x0} y1={latToY(TROPIC)} x2={x1} y2={latToY(TROPIC)} strokeDasharray="4 4" />
        <line x1={x0} y1={clamp(latToY(-TROPIC), y0, y1)} x2={x1} y2={clamp(latToY(-TROPIC), y0, y1)} strokeDasharray="4 4" />
      </g>

      {/* Continents: tinted parchment land with thin sepia coastlines. */}
      <g
        fill="var(--color-land)"
        fillOpacity={0.55}
        stroke="var(--map-land-border)"
        strokeWidth={0.6}
        strokeOpacity={0.7}
      >
        {world.locations.map((loc) => (
          <path key={loc.id} d={loc.path} vectorEffect="non-scaling-stroke" />
        ))}
      </g>

      {/* Ocean names in italic serif. */}
      <OceanName x={365} y={340} size={13} text="ATLANTIC" />
      <OceanName x={430} y={505} size={10} text="S. ATLANTIC" />
      <OceanName x={85} y={345} size={13} text="PACIFIC" />
      <OceanName x={922} y={345} size={12} text="PACIFIC" />
      <OceanName x={712} y={498} size={12} text="INDIAN" />
      <OceanName x={505} y={640} size={10} text="SOUTHERN OCEAN" />
    </svg>
  );
}
