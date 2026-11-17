// Typed wrapper around @svg-maps/world.
// The package ships a `svg-maps__common` type import that isn't installed,
// so we declare a minimal local type and re-export the data.
import worldData from "@svg-maps/world/index.js";

export interface MapLocation {
  id: string; // ISO 3166-1 alpha-2, LOWERCASE (matches server isoCodes)
  name: string;
  path: string;
}

export interface WorldMap {
  label: string;
  viewBox: string;
  locations: MapLocation[];
}

const world = worldData as unknown as WorldMap;

export const WORLD_VIEWBOX = world.viewBox;
export const WORLD_LOCATIONS = world.locations;
export default world;
