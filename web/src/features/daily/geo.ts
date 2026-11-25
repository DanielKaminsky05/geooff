/**
 * Daily Dive — map projection helpers (PHASE 0 foundation).
 *
 * Mirrors the equirectangular calibration in `components/OutlineMap.tsx` so that
 * daily journey overlays (routes, traveler, landmarks) line up exactly with the
 * atlas backdrop when drawn in the same world viewBox. If OutlineMap's
 * calibration ever changes, keep these in sync (or extract to one shared source).
 */

import { maps } from "../../lib/maps";
import type { GeoPoint } from "../../lib/protocol";

const X0 = 475.32;
const PX_PER_DEG_LON = 2.8732;
const EQUATOR_Y = 464;
const PX_PER_DEG_LAT = 3.138;

export const lonToX = (lon: number): number => X0 + PX_PER_DEG_LON * lon;
export const latToY = (lat: number): number => EQUATOR_Y - PX_PER_DEG_LAT * lat;

/** The world-map viewBox string, shared with OutlineMap/WorldMap. */
export const WORLD_VIEWBOX: string = maps.countries?.viewBox ?? "0 0 1010 666";

/** Project a geographic point to SVG coordinates in the world viewBox. */
export function project(p: GeoPoint): { x: number; y: number } {
  return { x: lonToX(p.lon), y: latToY(p.lat) };
}

/**
 * A viewBox string fitted around projected points — so a regional route (a few
 * hundred km) fills the view instead of being an invisible speck on the world.
 * Pads the bounding box, enforces a minimum span (keeps context around a tight
 * route) and a target aspect ratio.
 */
export function fitViewBox(
  pts: { x: number; y: number }[],
  opts?: { pad?: number; min?: number; aspect?: number },
): string {
  const pad = opts?.pad ?? 1.9;
  const min = opts?.min ?? 230;
  const aspect = opts?.aspect ?? 3 / 2;
  if (pts.length === 0) return WORLD_VIEWBOX;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let w = Math.max((Math.max(...xs) - Math.min(...xs)) * pad, min);
  let h = Math.max((Math.max(...ys) - Math.min(...ys)) * pad, min / aspect);
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
}
