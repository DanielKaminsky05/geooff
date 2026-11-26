/**
 * Daily Dive — smooth route paths.
 *
 * Turns a polyline of projected points into a smooth SVG path `d` string that
 * curves THROUGH every point (a Catmull-Rom spline converted to cubic beziers),
 * so routes read as flowing arcs instead of sharp dog-legs at each waypoint.
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * A smooth cubic-bezier path through all `pts` (Catmull-Rom, tension 1/6). Falls
 * back to straight line segments for 0-2 points. The curve interpolates every
 * point exactly, so markers placed on the waypoints still sit on the line.
 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    return "M " + pts.map((p) => `${p.x} ${p.y}`).join(" L ");
  }
  const d: string[] = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}
