// Backwards-compatible re-export of the world map.
// The map data + registry now live in ./maps; this keeps existing importers
// (continents.ts, its test) building unchanged.
import { mapFor, type MapLocation, type GeoMap } from "./maps";

export type { MapLocation };

export interface WorldMap extends GeoMap {
  label: string;
}

const world = mapFor("countries");

export const WORLD_VIEWBOX = world.viewBox;
export const WORLD_LOCATIONS = world.locations;
export default world;
