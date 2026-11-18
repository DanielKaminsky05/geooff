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
    "si", "es", "se", "ch", "tr", "ua", "gb", "va",
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
 * Dependent territories carry their own SVG shape (id) but aren't answerable
 * countries, so they'd never fill and sit grey forever (Greenland, Svalbard,
 * French Guiana, …). Map each to its sovereign so naming the parent fills the
 * territory too. (Western Sahara → Morocco reflects de-facto map control.)
 */
export const TERRITORY_PARENT: Record<string, string> = {
  // France
  gf: "fr", gp: "fr", mq: "fr", re: "fr", yt: "fr", nc: "fr", pf: "fr",
  wf: "fr", pm: "fr", bl: "fr", mf: "fr", tf: "fr", go: "fr", ju: "fr",
  // United Kingdom
  fk: "gb", gi: "gb", im: "gb", je: "gb", gg: "gb", ky: "gb", bm: "gb",
  vg: "gb", ai: "gb", ms: "gb", tc: "gb", sh: "gb", io: "gb", pn: "gb", gs: "gb",
  // United States
  pr: "us", gu: "us", as: "us", mp: "us", vi: "us",
  "um-dq": "us", "um-fq": "us", "um-hq": "us", "um-jq": "us", "um-mq": "us", "um-wq": "us",
  // Netherlands
  aw: "nl", cw: "nl", sx: "nl", bq: "nl",
  // Denmark / Norway / Finland
  gl: "dk", fo: "dk", sj: "no", bv: "no", ax: "fi",
  // China
  hk: "cn", mo: "cn",
  // New Zealand / Australia
  ck: "nz", nu: "nz", tk: "nz", cx: "au", cc: "au", nf: "au", hm: "au",
  // Morocco (de-facto)
  eh: "ma",
};

/**
 * Walk an SVG path, emitting each ABSOLUTE point. The @svg-maps/world paths are
 * relative (lowercase `m` + implicit relative linetos, `z`), so we must
 * accumulate deltas — treating the raw numbers as absolute coords collapses the
 * box toward the origin. Handles M/L/H/V (absolute + relative) and Z; this
 * dataset uses no curves/arcs.
 */
function walkPath(d: string, emit: (x: number, y: number) => void): void {
  const tok = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:[eE]-?\d+)?/g);
  if (!tok) return;
  let cx = 0, cy = 0; // current point
  let sx = 0, sy = 0; // current subpath start (for Z)
  let cmd = "";
  let i = 0;
  const n = () => Number(tok[i++]);
  while (i < tok.length) {
    const t = tok[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
      continue;
    }
    const c = cmd.toLowerCase();
    const rel = cmd === cmd.toLowerCase();
    if (c === "m" || c === "l") {
      let x = n();
      let y = n();
      if (rel) {
        x += cx;
        y += cy;
      }
      cx = x;
      cy = y;
      if (c === "m") {
        sx = cx;
        sy = cy;
        cmd = rel ? "l" : "L"; // extra coord pairs after a moveto are linetos
      }
      emit(cx, cy);
    } else if (c === "h") {
      let x = n();
      if (rel) x += cx;
      cx = x;
      emit(cx, cy);
    } else if (c === "v") {
      let y = n();
      if (rel) y += cy;
      cy = y;
      emit(cx, cy);
    } else if (c === "z") {
      cx = sx;
      cy = sy;
    } else {
      i++; // unknown command — skip a token to avoid stalling
    }
  }
}

/**
 * Compute a "minX minY width height" viewBox fitted to the given locations'
 * paths (bounding box of their absolute points), padded ~4%. Guards against a
 * degenerate (zero-area) box by falling back to a 1-unit span.
 */
export function fitViewBox(locations: MapLocation[]): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loc of locations) {
    walkPath(loc.path, (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
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
