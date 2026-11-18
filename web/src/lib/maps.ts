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

// Regional sets reuse the world SVG paths, filtered to the region's ids, with a
// viewBox cropped to those paths so the region fills the pane. Membership
// mirrors continents.ts (Middle East is curated, cross-continental).
const REGION_ISO: Record<string, string[]> = {
  europe: [
    "al", "ad", "at", "by", "be", "ba", "bg", "hr", "cy", "cz", "dk", "ee", "fi",
    "fr", "de", "gr", "hu", "is", "ie", "it", "xk", "lv", "li", "lt", "lu", "mt",
    "md", "mc", "me", "nl", "mk", "no", "pl", "pt", "ro", "ru", "sm", "rs", "sk",
    "si", "es", "se", "ch", "ua", "gb", "va",
  ],
  africa: [
    "dz", "ao", "bj", "bw", "bf", "bi", "cv", "cm", "cf", "td", "km", "cg", "cd",
    "ci", "dj", "eg", "gq", "er", "sz", "et", "ga", "gm", "gh", "gn", "gw", "ke",
    "ls", "lr", "ly", "mg", "mw", "ml", "mr", "mu", "ma", "mz", "na", "ne", "ng",
    "rw", "st", "sn", "sc", "sl", "so", "za", "ss", "sd", "tz", "tg", "tn", "ug",
    "zm", "zw",
  ],
  asia: [
    "af", "am", "az", "bh", "bd", "bt", "bn", "kh", "cn", "cy", "ge", "in", "id",
    "ir", "iq", "il", "jp", "jo", "kz", "kw", "kg", "la", "lb", "my", "mv", "mn",
    "mm", "np", "kp", "om", "pk", "ps", "ph", "qa", "sa", "sg", "kr", "lk", "sy", "tj",
    "th", "tl", "tw", "tr", "tm", "ae", "uz", "vn", "ye",
  ],
  "middle-east": [
    "tr", "sy", "lb", "il", "ps", "jo", "iq", "ir", "sa", "ye", "om", "ae", "qa",
    "bh", "kw", "eg",
  ],
  americas: [
    "ag", "ar", "bs", "bb", "bz", "bo", "br", "ca", "cl", "co", "cr", "cu", "dm",
    "do", "ec", "sv", "gd", "gt", "gy", "ht", "hn", "jm", "mx", "ni", "pa", "pe",
    "kn", "lc", "vc", "sr", "tt", "us", "uy", "ve", "py",
  ],
};

/**
 * Compute a "minX minY width height" viewBox fitted to the given locations'
 * paths: pull every numeric token from each `path`, treat them as alternating
 * x/y pairs, take the bounding box and pad it ~4%. Guards against a degenerate
 * (zero-area) box by falling back to a 1-unit span so the result is always
 * finite and positive.
 */
export function fitViewBox(locations: MapLocation[]): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loc of locations) {
    const nums = loc.path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi);
    if (!nums) continue;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // Degenerate / empty: fall back to a safe unit box.
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return "0 0 1 1";
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.04;
  const padY = h * 0.04;
  return `${minX - padX} ${minY - padY} ${w + 2 * padX} ${h + 2 * padY}`;
}

function regionMap(iso: string[]): GeoMap {
  const want = new Set(iso);
  const locations = world.locations.filter((loc) => want.has(loc.id));
  return { viewBox: fitViewBox(locations), locations };
}

/** Maps keyed by CategoryId. Map-less sets simply have no entry. */
export const maps: Partial<Record<CategoryId, GeoMap>> = {
  countries: countriesMap,
  "us-states": usStatesMap,
  europe: regionMap(REGION_ISO.europe),
  africa: regionMap(REGION_ISO.africa),
  asia: regionMap(REGION_ISO.asia),
  "middle-east": regionMap(REGION_ISO["middle-east"]),
  americas: regionMap(REGION_ISO.americas),
};

/** Resolve a map for a category, falling back to countries. */
export function mapFor(id: CategoryId): GeoMap {
  return maps[id] ?? countriesMap;
}
