/**
 * Daily Trek — route polyline geometry.
 *
 * Pure math over a *projected* polyline (SVG points already run through
 * `geo.project`). Used by `JourneyMap` to place the traveler and landmark pins
 * at a fraction of the route by cumulative segment length — so a landmark at
 * `atFraction = 0.5` sits at the geometric midpoint of the drawn line, not the
 * midpoint of the point *index*. No React, no DOM: trivially unit-testable.
 */

export interface Point {
  x: number;
  y: number;
}

/** A projected polyline plus the precomputed cumulative lengths of its segments. */
export interface RouteGeometry {
  /** The projected points, as passed in. */
  points: Point[];
  /** `cum[i]` = distance along the route from the start to `points[i]`. */
  cumulative: number[];
  /** Total polyline length (0 for a degenerate/empty route). */
  length: number;
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Precompute cumulative segment lengths for a projected polyline. */
export function buildRouteGeometry(points: Point[]): RouteGeometry {
  const cumulative: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += dist(points[i - 1], points[i]);
    cumulative.push(acc);
  }
  return { points, cumulative, length: acc };
}

/**
 * The point at `fraction` (0..1) of the way along the route by arc length.
 * Clamps `fraction` to [0, 1]. Returns the sole point for a 1-point route and
 * `{ x: 0, y: 0 }` for an empty one (caller shouldn't draw that case).
 */
export function pointAtFraction(geo: RouteGeometry, fraction: number): Point {
  const { points, cumulative, length } = geo;
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || length === 0) return points[0];

  const f = Math.max(0, Math.min(1, fraction));
  const target = f * length;

  // Find the segment [i-1, i] that contains the target arc length.
  let i = 1;
  while (i < points.length && cumulative[i] < target) i++;
  if (i >= points.length) return points[points.length - 1];

  const a = points[i - 1];
  const b = points[i];
  const segStart = cumulative[i - 1];
  const segLen = cumulative[i] - segStart;
  const t = segLen === 0 ? 0 : (target - segStart) / segLen;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
