// Sub-region grouping for regional map sets (europe, africa, asia, …), mirroring
// how continents.ts groups the global set. Each region's items (the ids in its
// map's `locations`) are partitioned into geographic sub-regions so the "your
// countries" list can render grouped, colored, columnar sections instead of one
// flat list.
//
// Only ISO codes live here (no display names): names come from the shared
// country-name source, as in continents.ts. Every id present in a region's map
// MUST appear in exactly one group — the tables below are exhaustive against
// maps.ts REGION_ISO.
import type { CategoryId } from "./protocol";

/** A region's grouping: ordered groups, a color + member ids per group, and a
 *  column layout (each column a list of group labels, stacked top-to-bottom). */
export interface SubRegionConfig {
  /** Group label -> member ids. Insertion order is the canonical group order. */
  groups: Record<string, string[]>;
  /** Group label -> header color (muted, to sit on the dark theme). */
  colors: Record<string, string>;
  /** Column layout: each inner array is one column of group labels. */
  columns: string[][];
}

// A small palette reused across regions, matching the continent header hues.
const BLUE = "#3355cc";
const RED = "#b83a3a";
const PURPLE = "#8a3fa6";
const ORANGE = "#c98516";
const GREEN = "#2f8a3e";
const TEAL = "#2f7fc1";

export const SUB_REGIONS: Partial<Record<CategoryId, SubRegionConfig>> = {
  europe: {
    groups: {
      Northern: ["dk", "ee", "fi", "is", "ie", "lv", "lt", "no", "se", "gb"],
      Western: ["ad", "be", "fr", "lu", "mc", "nl", "pt", "es"],
      Central: ["at", "cz", "de", "hu", "li", "pl", "sk", "si", "ch"],
      Southern: ["al", "ba", "hr", "cy", "gr", "it", "xk", "mt", "me", "mk", "sm", "rs", "va", "tr"],
      Eastern: ["by", "bg", "md", "ro", "ru", "ua"],
    },
    colors: {
      Northern: BLUE,
      Western: GREEN,
      Central: ORANGE,
      Southern: RED,
      Eastern: PURPLE,
    },
    columns: [["Northern"], ["Western"], ["Central"], ["Southern"], ["Eastern"]],
  },

  africa: {
    groups: {
      // Western Sahara ("eh") sits in Northern per the task brief.
      Northern: ["dz", "eg", "ly", "ma", "sd", "tn", "eh"],
      Western: ["bj", "bf", "cv", "ci", "gm", "gh", "gn", "gw", "lr", "ml", "mr", "ne", "ng", "sn", "sl", "tg"],
      Central: ["ao", "cm", "cf", "td", "cg", "cd", "gq", "ga", "st"],
      Eastern: ["bi", "km", "dj", "er", "et", "ke", "mg", "mw", "mu", "mz", "rw", "sc", "so", "ss", "tz", "ug", "zm", "zw"],
      Southern: ["bw", "sz", "ls", "na", "za"],
    },
    colors: {
      Northern: ORANGE,
      Western: GREEN,
      Central: PURPLE,
      Eastern: RED,
      Southern: BLUE,
    },
    columns: [["Northern"], ["Western"], ["Central"], ["Eastern"], ["Southern"]],
  },

  asia: {
    groups: {
      Central: ["kz", "kg", "tj", "tm", "uz"],
      Eastern: ["cn", "jp", "kp", "kr", "mn", "tw"],
      Southern: ["af", "bd", "bt", "in", "mv", "np", "pk", "lk"],
      Southeastern: ["bn", "kh", "id", "la", "my", "mm", "ph", "sg", "th", "tl", "vn"],
      Western: ["am", "az", "bh", "cy", "ge", "ir", "iq", "il", "jo", "kw", "lb", "om", "ps", "qa", "sa", "sy", "tr", "ae", "ye"],
    },
    colors: {
      Central: ORANGE,
      Eastern: RED,
      Southern: PURPLE,
      Southeastern: GREEN,
      Western: BLUE,
    },
    columns: [["Central"], ["Eastern"], ["Southern"], ["Southeastern"], ["Western"]],
  },

  "middle-east": {
    groups: {
      Levant: ["sy", "lb", "il", "ps", "jo", "iq"],
      Gulf: ["sa", "ye", "om", "ae", "qa", "bh", "kw", "ir"],
      Other: ["tr", "eg"],
    },
    colors: {
      Levant: BLUE,
      Gulf: GREEN,
      Other: ORANGE,
    },
    columns: [["Levant"], ["Gulf"], ["Other"]],
  },

  americas: {
    groups: {
      Northern: ["ca", "us", "mx"],
      Central: ["bz", "cr", "sv", "gt", "hn", "ni", "pa"],
      Caribbean: ["ag", "bs", "bb", "cu", "dm", "do", "gd", "ht", "jm", "kn", "lc", "vc", "tt"],
      South: ["ar", "bo", "br", "cl", "co", "ec", "gy", "pe", "sr", "uy", "ve", "py"],
    },
    colors: {
      Northern: ORANGE,
      Central: RED,
      Caribbean: TEAL,
      South: GREEN,
    },
    columns: [["Northern"], ["Central"], ["Caribbean"], ["South"]],
  },
};

/** Lookup table id -> group label for a region, built from its config. */
export function subRegionOf(config: SubRegionConfig): Map<string, string> {
  const byId = new Map<string, string>();
  for (const [label, ids] of Object.entries(config.groups)) {
    for (const id of ids) byId.set(id, label);
  }
  return byId;
}
