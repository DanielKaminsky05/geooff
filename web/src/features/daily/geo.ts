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
