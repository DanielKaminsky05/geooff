/**
 * GeoFight shared geography data — the single source of truth for category
 * labels and regional set membership.
 *
 * CANONICAL copy lives at shared/geo.ts. It is mirrored byte-identically to:
 *   - server/src/geo.ts
 *   - web/src/lib/geo.ts
 * CI diffs the mirrors against this file; edit here, then copy to both.
 *
 * The `.js` import specifier below is deliberate: the server resolves with
 * NodeNext (which requires it) and the web app with "bundler" resolution
 * (which maps `.js` to the `.ts` source). It is a type-only import, so it is
 * erased at runtime in both packages.
 */

import type { CategoryId } from "./protocol.js";

/** Human-readable label for every category (lobby picker, match header, …). */
export const CATEGORY_LABELS: Record<CategoryId, string> = {
  countries: "Countries",
  "us-states": "US states",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  "middle-east": "Middle East",
  americas: "Americas",
};

/** The category ids that are regional subsets of the world countries set. */
export type RegionId = "europe" | "africa" | "asia" | "middle-east" | "americas";

export const REGION_IDS: readonly RegionId[] = [
  "europe",
  "africa",
  "asia",
  "middle-east",
  "americas",
];

/**
 * Playable members of each region, as lowercase ISO 3166-1 alpha-2 codes
 * (plus "xk" Kosovo). Every code MUST be an answerable country on the server
 * (server/src/data/countries.ts): the playable set equals what can be named.
 *
 * Western Sahara ("eh") is deliberately absent from Africa — it is not an
 * answerable country. The client may still draw its shape on the Africa map as
 * non-playable land (it fills along with Morocco), but it never counts toward
 * totals or sub-region groups.
 */
export const REGION_ISO: Record<RegionId, readonly string[]> = {
  europe: [
    "al", "ad", "at", "by", "be", "ba", "bg", "hr", "cy", "cz",
    "dk", "ee", "fi", "fr", "de", "gr", "hu", "is", "ie", "it",
    "xk", "lv", "li", "lt", "lu", "mt", "md", "mc", "me", "nl",
    "mk", "no", "pl", "pt", "ro", "ru", "sm", "rs", "sk", "si",
    "es", "se", "ch", "tr", "ua", "gb", "va",
  ],
  africa: [
    "dz", "ao", "bj", "bw", "bf", "bi", "cv", "cm", "cf", "td",
    "km", "cg", "cd", "ci", "dj", "eg", "gq", "er", "sz", "et",
    "ga", "gm", "gh", "gn", "gw", "ke", "ls", "lr", "ly", "mg",
    "mw", "ml", "mr", "mu", "ma", "mz", "na", "ne", "ng", "rw",
    "st", "sn", "sc", "sl", "so", "za", "ss", "sd", "tz", "tg",
    "tn", "ug", "zm", "zw",
  ],
  asia: [
    "af", "am", "az", "bh", "bd", "bt", "bn", "kh", "cn", "cy",
    "ge", "in", "id", "ir", "iq", "il", "jp", "jo", "kz", "kw",
    "kg", "la", "lb", "my", "mv", "mn", "mm", "np", "kp", "om",
    "pk", "ps", "ph", "qa", "sa", "sg", "kr", "lk", "sy", "tj",
    "th", "tl", "tw", "tr", "tm", "ae", "uz", "vn", "ye",
  ],
  "middle-east": [
    "tr", "sy", "lb", "il", "ps", "jo", "iq", "ir",
    "sa", "ye", "om", "ae", "qa", "bh", "kw", "eg",
  ],
  americas: [
    "ag", "ar", "bs", "bb", "bz", "bo", "br", "ca", "cl", "co",
    "cr", "cu", "dm", "do", "ec", "sv", "gd", "gt", "gy", "ht",
    "hn", "jm", "mx", "ni", "pa", "pe", "kn", "lc", "vc", "sr",
    "tt", "us", "uy", "ve", "py",
  ],
};

/** True when a category is one of the regional country subsets. */
export function isRegionId(id: CategoryId): id is RegionId {
  return (REGION_IDS as readonly string[]).includes(id);
}
