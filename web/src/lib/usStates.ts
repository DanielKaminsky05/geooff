// US-state grouping (by Census region) + display names for the "your states"
// list — the states analogue of continents.ts. State ids are lowercase USPS
// postal codes (ca, tx, ny…), matching @svg-maps/usa and the server set.
import { mapFor } from "./maps";

export type UsRegion = "Northeast" | "Midwest" | "South" | "West";

export const US_REGIONS: Record<UsRegion, string[]> = {
  Northeast: ["ct", "me", "ma", "nh", "ri", "vt", "nj", "ny", "pa"],
  Midwest: ["il", "in", "mi", "oh", "wi", "ia", "ks", "mn", "mo", "ne", "nd", "sd"],
  South: [
    "de", "fl", "ga", "md", "nc", "sc", "va", "wv", "al", "ky", "ms", "tn",
    "ar", "la", "ok", "tx",
  ],
  West: ["az", "co", "id", "mt", "nv", "nm", "ut", "wy", "ak", "ca", "hi", "or", "wa"],
};

// Names come from the map package the client already ships (the 50-state map).
const STATE_NAMES = new Map(mapFor("us-states").locations.map((l) => [l.id, l.name]));

export function stateName(id: string): string {
  return STATE_NAMES.get(id) ?? id.toUpperCase();
}

export interface RegionGroup {
  region: UsRegion;
  /** Sorted display names of the states named in this region. */
  names: string[];
  /** How many states this region has in total. */
  total: number;
}

/** Group named state ids by region, every region included, names sorted. */
export function groupByRegion(filled: Iterable<string>): RegionGroup[] {
  const have = new Set(filled);
  return (Object.keys(US_REGIONS) as UsRegion[]).map((region) => ({
    region,
    total: US_REGIONS[region].length,
    names: US_REGIONS[region]
      .filter((id) => have.has(id))
      .map(stateName)
      .sort((a, b) => a.localeCompare(b)),
  }));
}
