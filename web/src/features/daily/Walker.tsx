/**
 * Daily Trek — the trekker figure (hat + pack + trekking pole), drawn in unit
 * space with feet at the origin.
 *
 * The legs swing and the body bobs driven by `phase` (travelled distance) while
 * `moving`, so the gait matches the slide and freezes to a stand when it stops.
 * At journey's end `outcome` swaps to a victory hop ("arrived") or a
 * topple-and-fade ("died") — see index.css. With no props it stands idle, which
 * is how DailyPlay uses it as the "you are here" marker during a prompt.
 */

/** Leg-swing geometry, shared with JourneyMap's stride-phase calc so the gait is
 *  locked to distance travelled (no foot-slide / walking in place). SWING is the
 *  swing amplitude; LEG_LEN the leg length in the walker's local units. */
export const WALK_SWING_DEG = 24;
export const WALK_LEG_LEN = 2.2;

export function Walker({
  outcome,
  phase = 0,
  moving = false,
}: {
  outcome?: "arrived" | "died";
  phase?: number;
  moving?: boolean;
}) {
  const skin = "#f4e6cf";
  const body = "var(--color-accent)";
  const ink = "var(--map-ink)";
  const rootClass =
    outcome === "arrived" ? "daily-cheer" : outcome === "died" ? "daily-faint" : "";
  // Legs swing from the hip and the body bobs, both driven by the travelled
  // distance (phase). Stand (angle 0) whenever stopped or at an outcome, so the
  // trekker never walks in place.
  const stepping = moving && !outcome;
  const legAngle = stepping ? WALK_SWING_DEG * Math.sin(phase) : 0;
  const bobY = stepping ? -0.22 * Math.abs(Math.sin(phase)) : 0;
  // Arm thrusts overhead on a victorious arrival; normal forward lean otherwise.
  const armTransform = outcome === "arrived" ? "rotate(-104 0.6 -4)" : "rotate(14 0.6 -4)";
  return (
    <g className={rootClass}>
      {/* trekking pole */}
      <line x1={1.5} y1={-2} x2={2.4} y2={0.2} stroke={ink} strokeWidth={0.26} strokeLinecap="round" />
      {/* legs (swing from the hip, opposite phases) */}
      <rect transform={`rotate(${-legAngle} 0 -2.2)`} x={-0.36} y={-2.2} width={0.72} height={2.2} rx={0.32} fill={body} stroke={ink} strokeWidth={0.1} />
      <rect transform={`rotate(${legAngle} 0 -2.2)`} x={-0.36} y={-2.2} width={0.72} height={2.2} rx={0.32} fill={body} stroke={ink} strokeWidth={0.1} />
      <g transform={`translate(0 ${bobY})`}>
        {/* backpack */}
        <rect x={-1.65} y={-4.2} width={1.25} height={2} rx={0.38} fill="var(--color-chrome-gold)" stroke={ink} strokeWidth={0.12} />
        {/* torso */}
        <rect x={-0.72} y={-4.3} width={1.44} height={2.3} rx={0.55} fill={body} stroke="var(--map-paper)" strokeWidth={0.2} />
        {/* forward arm (raised in triumph on arrival) */}
        <rect x={0.35} y={-4} width={0.52} height={2} rx={0.26} fill={body} stroke={ink} strokeWidth={0.08} transform={armTransform} />
        {/* head */}
        <circle cx={0} cy={-5} r={0.98} fill={skin} stroke={ink} strokeWidth={0.12} />
        {/* hat */}
        <rect x={-1.15} y={-5.65} width={2.3} height={0.4} rx={0.2} fill={body} stroke={ink} strokeWidth={0.08} />
        <rect x={-0.62} y={-6.25} width={1.24} height={0.75} rx={0.3} fill={body} stroke={ink} strokeWidth={0.08} />
      </g>
    </g>
  );
}
