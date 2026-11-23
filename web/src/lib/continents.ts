// Continent grouping + display names for the "your countries" list.
//
// Only ISO codes live here (no answer names): display names come from the map
// package the client already ships, with a few overrides for current/common
// names. Transcontinental calls follow the usual quiz convention: Russia,
// Cyprus → Europe; Turkey, Kazakhstan, the Caucasus → Asia; Egypt → Africa;
// Central America + Caribbean → North America.
import { mapFor } from "./maps";
import { REGION_ISO } from "./geo";

export type Continent =
  | "Africa"
  | "Asia"
  | "Europe"
  | "North America"
  | "South America"
  | "Oceania";

export const CONTINENTS: Record<Continent, string[]> = {
  // The Africa continent and the africa region set are the same 54 countries.
  Africa: [...REGION_ISO.africa],
  Asia: [
    "af", "am", "az", "bh", "bd", "bt", "bn", "kh", "cn", "ge", "in", "id", "ir",
    "iq", "il", "jp", "jo", "kz", "kw", "kg", "la", "lb", "my", "mv", "mn", "mm",
    "np", "kp", "om", "pk", "ps", "ph", "qa", "sa", "sg", "kr", "lk", "sy", "tw",
    "tj", "th", "tl", "tr", "tm", "ae", "uz", "vn", "ye",
  ],
  Europe: [
    "al", "ad", "at", "by", "be", "ba", "bg", "hr", "cy", "cz", "dk", "ee", "fi",
    "fr", "de", "gr", "hu", "is", "ie", "it", "xk", "lv", "li", "lt", "lu", "mt",
    "md", "mc", "me", "nl", "mk", "no", "pl", "pt", "ro", "ru", "sm", "rs", "sk",
    "si", "es", "se", "ch", "ua", "gb", "va",
  ],
  "North America": [
    "ag", "bs", "bb", "bz", "ca", "cr", "cu", "dm", "do", "sv", "gd", "gt", "ht",
    "hn", "jm", "mx", "ni", "pa", "kn", "lc", "vc", "tt", "us",
  ],
  "South America": [
    "ar", "bo", "br", "cl", "co", "ec", "gy", "py", "pe", "sr", "uy", "ve",
  ],
  Oceania: [
    "au", "fj", "ki", "mh", "fm", "nr", "nz", "pw", "pg", "ws", "sb", "to", "tv",
    "vu",
  ],
};

/** Map-package names that are outdated or awkward for display. */
const NAME_OVERRIDES: Record<string, string> = {
  bn: "Brunei",
  cv: "Cabo Verde",
  cg: "Republic of the Congo",
  cd: "DR Congo",
  cz: "Czechia",
  sz: "Eswatini",
  la: "Laos",
  fm: "Micronesia",
  mk: "North Macedonia",
  ps: "Palestine",
};

const MAP_NAMES = new Map(mapFor("countries").locations.map((l) => [l.id, l.name]));

/**
 * Display name for a country iso. The ONE naming function for countries (world
 * and region sets alike) so every list shows e.g. "Czechia", never the map
 * package's "Czech Republic".
 */
export function countryName(iso: string): string {
  return NAME_OVERRIDES[iso] ?? MAP_NAMES.get(iso) ?? iso.toUpperCase();
}

export interface ContinentGroup {
  continent: Continent;
  /** Sorted display names of the countries named on this continent. */
  names: string[];
  /** How many countries this continent has in total. */
  total: number;
}

/** Group named ISO codes by continent, every continent included, names sorted. */
export function groupByContinent(filled: Iterable<string>): ContinentGroup[] {
  const have = new Set(filled);
  return (Object.keys(CONTINENTS) as Continent[]).map((continent) => ({
    continent,
    total: CONTINENTS[continent].length,
    names: CONTINENTS[continent]
      .filter((iso) => have.has(iso))
      .map(countryName)
      .sort((a, b) => a.localeCompare(b)),
  }));
}
