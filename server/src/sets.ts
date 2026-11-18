/**
 * Geo-set registry: ties each CategoryId to its answer items + map metadata,
 * and provides cached per-set matching helpers (lookup/canonical/total/ids).
 *
 * Only `countries` is live today; new sets slot into `sets` at the seam below.
 */

import type { CategoryId } from "./protocol.js";
import { countries } from "./data/countries.js";
import { usStates } from "./data/us-states.js";
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
  label: "World countries",
  items: countries.map((c) => ({ id: c.iso, name: c.name, aliases: c.aliases })),
  hasMap: true,
  mapId: "world",
};

/**
 * Regional sets — curated ISO-code lists over the existing country data.
 * Each region's `items` are the countries data filtered to its isoCodes,
 * preserving countries.ts order and reusing the same AnswerItem mapping as the
 * countries set (so aliases come for free). Each reuses the world SVG, cropped
 * to the region via its own mapId.
 */
const REGIONS: { id: CategoryId; label: string; isoCodes: string[] }[] = [
  {
    id: "europe",
    label: "Europe",
    isoCodes: [
      "al", "ad", "at", "by", "be", "ba", "bg", "hr", "cy", "cz",
      "dk", "ee", "fi", "fr", "de", "gr", "hu", "is", "ie", "it",
      "xk", "lv", "li", "lt", "lu", "mt", "md", "mc", "me", "nl",
      "mk", "no", "pl", "pt", "ro", "ru", "sm", "rs", "sk", "si",
      "es", "se", "ch", "ua", "gb", "va",
    ],
  },
  {
    id: "africa",
    label: "Africa",
    isoCodes: [
      "dz", "ao", "bj", "bw", "bf", "bi", "cv", "cm", "cf", "td",
      "km", "cg", "cd", "ci", "dj", "eg", "gq", "er", "sz", "et",
      "ga", "gm", "gh", "gn", "gw", "ke", "ls", "lr", "ly", "mg",
      "mw", "ml", "mr", "mu", "ma", "mz", "na", "ne", "ng", "rw",
      "st", "sn", "sc", "sl", "so", "za", "ss", "sd", "tz", "tg",
      "tn", "ug", "zm", "zw",
    ],
  },
  {
    id: "asia",
    label: "Asia",
    isoCodes: [
      "af", "am", "az", "bh", "bd", "bt", "bn", "kh", "cn", "cy",
      "ge", "in", "id", "ir", "iq", "il", "jp", "jo", "kz", "kw",
      "kg", "la", "lb", "my", "mv", "mn", "mm", "np", "kp", "om",
      "pk", "ps", "ph", "qa", "sa", "sg", "kr", "lk", "sy", "tj",
      "th", "tl", "tw", "tr", "tm", "ae", "uz", "vn", "ye",
    ],
  },
  {
    id: "middle-east",
    label: "Middle East",
    isoCodes: [
      "tr", "sy", "lb", "il", "ps", "jo", "iq", "ir",
      "sa", "ye", "om", "ae", "qa", "bh", "kw", "eg",
    ],
  },
  {
    id: "americas",
    label: "Americas",
    isoCodes: [
      "ag", "ar", "bs", "bb", "bz", "bo", "br", "ca", "cl", "co",
      "cr", "cu", "dm", "do", "ec", "sv", "gd", "gt", "gy", "ht",
      "hn", "jm", "mx", "ni", "pa", "pe", "kn", "lc", "vc", "sr",
      "tt", "us", "uy", "ve", "py",
    ],
  },
];

/** Build a region GeoSet: countries data filtered to the region's isoCodes. */
function regionSet(region: (typeof REGIONS)[number]): GeoSet {
  const members = new Set(region.isoCodes);
  return {
    id: region.id,
    label: region.label,
    items: countries
      .filter((c) => members.has(c.iso))
      .map((c) => ({ id: c.iso, name: c.name, aliases: c.aliases })),
    hasMap: true,
    mapId: region.id,
  };
}

/** US states — the 50 states (no DC, no territories). id = USPS postal code. */
const usStatesSet: GeoSet = {
  id: "us-states",
  label: "US states",
  items: usStates,
  hasMap: true,
  mapId: "usa",
};

/** Registry of playable sets, keyed by CategoryId. */
export const sets: Partial<Record<CategoryId, GeoSet>> = {
  countries: countriesSet,
  "us-states": usStatesSet,
  // add more sets here
  ...Object.fromEntries(REGIONS.map((r) => [r.id, regionSet(r)])),
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
