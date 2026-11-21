/**
 * Geo-set registry: ties each CategoryId to its answer items + map metadata,
 * and provides cached per-set matching helpers (lookup/canonical/total/ids).
 *
 * Only `countries` is live today; new sets slot into `sets` at the seam below.
 */

import type { CategoryId } from "./protocol.js";
import { countries } from "./data/countries.js";
import { usStates } from "./data/us-states.js";
import { CATEGORY_LABELS, REGION_IDS, REGION_ISO, type RegionId } from "./geo.js";
import { buildLookup, buildCanonicalNames, type AnswerItem } from "./matching.js";

export type { AnswerItem };

export interface GeoSet {
  id: CategoryId;
  label: string;
  items: AnswerItem[];
  hasMap: boolean;
  mapId?: string; // which SVG map the frontend uses
}

/** World countries — the original set. Country.iso becomes AnswerItem.id. */
const countriesSet: GeoSet = {
  id: "countries",
  label: CATEGORY_LABELS.countries,
  items: countries.map((c) => ({ id: c.iso, name: c.name, aliases: c.aliases })),
  hasMap: true,
  mapId: "world",
};

/**
 * Regional sets — curated ISO-code lists over the existing country data. The
 * membership lists live in the shared geo module (REGION_ISO), mirrored to the
 * web client so both sides agree on what each region contains.
 * Each region's `items` are the countries data filtered to its isoCodes,
 * preserving countries.ts order and reusing the same AnswerItem mapping as the
 * countries set (so aliases come for free). Each reuses the world SVG, cropped
 * to the region via its own mapId.
 */
function regionSet(id: RegionId): GeoSet {
  const members = new Set(REGION_ISO[id]);
  return {
    id,
    label: CATEGORY_LABELS[id],
    items: countries
      .filter((c) => members.has(c.iso))
      .map((c) => ({ id: c.iso, name: c.name, aliases: c.aliases })),
    hasMap: true,
    mapId: id,
  };
}

/** US states — the 50 states (no DC, no territories). id = USPS postal code. */
const usStatesSet: GeoSet = {
  id: "us-states",
  label: CATEGORY_LABELS["us-states"],
  items: usStates,
  hasMap: true,
  mapId: "usa",
};

/** Registry of playable sets, keyed by CategoryId. */
export const sets: Partial<Record<CategoryId, GeoSet>> = {
  countries: countriesSet,
  "us-states": usStatesSet,
  // add more sets here
  ...Object.fromEntries(REGION_IDS.map((id) => [id, regionSet(id)])),
};

/** CategoryIds that actually have a registered set (for validation). */
export const KNOWN_CATEGORIES: readonly CategoryId[] = Object.keys(sets) as CategoryId[];

/** Resolve a set, throwing on an unknown id (callers validate first). */
export function getSet(id: CategoryId): GeoSet {
  const set = sets[id];
  if (!set) throw new Error(`Unknown set: ${id}`);
  return set;
}

interface SetCache {
  lookup: Map<string, string>;
  canonical: Map<string, string>;
  total: number;
  allIds: string[];
}

const cache = new Map<CategoryId, SetCache>();

function cacheFor(id: CategoryId): SetCache {
  let entry = cache.get(id);
  if (!entry) {
    const set = getSet(id);
    entry = {
      lookup: buildLookup(set.items),
      canonical: buildCanonicalNames(set.items),
      total: set.items.length,
      allIds: set.items.map((i) => i.id),
    };
    cache.set(id, entry);
  }
  return entry;
}

/** Cached normalized-answer lookup for a set. */
export function lookupFor(id: CategoryId): Map<string, string> {
  return cacheFor(id).lookup;
}

/** Cached id → canonical name map for a set. */
export function canonicalFor(id: CategoryId): Map<string, string> {
  return cacheFor(id).canonical;
}

/** Number of answerable items in a set. */
export function totalFor(id: CategoryId): number {
  return cacheFor(id).total;
}

/** All item ids in a set (for computing "missed" sets at game end). */
export function allIdsFor(id: CategoryId): string[] {
  return cacheFor(id).allIds;
}
