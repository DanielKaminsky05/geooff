/**
 * Daily Trek — smooth route paths.
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
 * The two cubic-bezier control points for the Catmull-Rom segment p1→p2 (tension
 * 1/6), using the neighbours p0 and p3 for its tangents. Both `smoothPath` and
 * `sampleSmooth` read from this single formula so their curves are identical.
 */
function controlPoints(p0: Pt, p1: Pt, p2: Pt, p3: Pt): { c1: Pt; c2: Pt } {
  return {
    c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  };
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
    const { c1, c2 } = controlPoints(p0, p1, p2, p3);
    d.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

/**
 * The SAME smooth curve as `smoothPath`, but returned as a DENSE polyline of
 * points sampled along the beziers (`perSeg` points per span). Use this when you
 * need the drawn line and the positions ON it (traveler, landmarks) to coincide
 * exactly: build route geometry from these points and both read from one source.
 */
export function sampleSmooth(pts: Pt[], perSeg = 24): Pt[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const { c1, c2 } = controlPoints(p0, p1, p2, p3);
    for (let s = 1; s <= perSeg; s++) {
      const t = s / perSeg;
      const mt = 1 - t;
      out.push({
        x: mt * mt * mt * p1.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p2.x,
        y: mt * mt * mt * p1.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  return out;
}
