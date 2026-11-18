// Map registry: ties each CategoryId to the SVG viewBox + per-region paths the
// WorldMap component renders. Only `countries` (@svg-maps/world) is wired today;
// new maps slot in at the seam below.
import worldData from "@svg-maps/world/index.js";
import usaData from "@svg-maps/usa/index.js";
import type { CategoryId } from "./protocol";

export interface MapLocation {
  id: string; // map key, LOWERCASE (matches server item ids / isoCodes)
  name: string;
  path: string;
}

export interface GeoMap {
  viewBox: string;
  locations: MapLocation[];
}

interface RawMap {
  label: string;
  viewBox: string;
  locations: MapLocation[];
}

const world = worldData as unknown as RawMap;

const countriesMap: GeoMap = {
  viewBox: world.viewBox,
  locations: world.locations,
};

const usa = usaData as unknown as RawMap;

// @svg-maps/usa ships a `dc` location; the us-states set is the 50 states only,
// so drop DC to keep the map and the server answer set in lockstep.
const usStatesMap: GeoMap = {
  viewBox: usa.viewBox,
  locations: usa.locations.filter((loc) => loc.id !== "dc"),
};

/** Maps keyed by CategoryId. Map-less sets simply have no entry. */
export const maps: Partial<Record<CategoryId, GeoMap>> = {
  countries: countriesMap,
  "us-states": usStatesMap,
  // add more maps here
};

/** Resolve a map for a category, falling back to countries. */
export function mapFor(id: CategoryId): GeoMap {
  return maps[id] ?? countriesMap;
}
