import { describe, it, expect } from "vitest";
import {
  getSet,
  lookupFor,
  totalFor,
  allIdsFor,
  KNOWN_CATEGORIES,
} from "../src/sets.js";
import { normalizeAnswer } from "../src/protocol.js";
import { CATEGORY_LABELS, REGION_IDS, REGION_ISO } from "../src/geo.js";
import { countries } from "../src/data/countries.js";

/**
 * Authoritative state id set: the @svg-maps/usa location ids MINUS `dc`.
 * (@svg-maps/usa lives in web/ and isn't resolvable from server/, so the map's
 * id list is mirrored here. The web maps registry filters `dc` the same way,
 * keeping the rendered map and this answer set in lockstep at 50 states.)
 */
const USA_MAP_STATE_IDS = [
  "ak", "al", "ar", "az", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "ia", "id", "il", "in", "ks", "ky", "la", "ma", "md",
  "me", "mi", "mn", "mo", "ms", "mt", "nc", "nd", "ne", "nh",
  "nj", "nm", "nv", "ny", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "va", "vt", "wa", "wi", "wv", "wy",
];

describe("us-states set", () => {
  it("is registered as a known category", () => {
    expect(KNOWN_CATEGORIES).toContain("us-states");
    const set = getSet("us-states");
    expect(set.label).toBe("US states");
    expect(set.hasMap).toBe(true);
    expect(set.mapId).toBe("usa");
  });

  it("has exactly 50 states", () => {
    expect(totalFor("us-states")).toBe(50);
  });

  it("resolves canonical names, postal codes and abbreviations", () => {
    const lookup = lookupFor("us-states");
    const resolve = (raw: string) => lookup.get(normalizeAnswer(raw));

    expect(resolve("California")).toBe("ca");
    expect(resolve("ca")).toBe("ca");
    expect(resolve("calif")).toBe("ca");
    expect(resolve("calif.")).toBe("ca"); // punctuation stripped by normalize
    expect(resolve("tx")).toBe("tx");
    expect(resolve("Texas")).toBe("tx");
    expect(resolve("mass")).toBe("ma");
    expect(resolve("penn")).toBe("pa");
    expect(resolve("washington state")).toBe("wa");
  });

  it("has no duplicate ids", () => {
    const ids = allIdsFor("us-states");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not include DC or territories", () => {
    const ids = new Set(allIdsFor("us-states"));
    expect(ids.has("dc")).toBe(false);
    expect(ids.has("pr")).toBe(false);
    expect(ids.has("gu")).toBe(false);
  });

  it("agrees exactly with the @svg-maps/usa location ids (both directions)", () => {
    const setIds = new Set(allIdsFor("us-states"));
    const mapIds = new Set(USA_MAP_STATE_IDS);

    // Every data id is a real map location...
    for (const id of setIds) expect(mapIds.has(id)).toBe(true);
    // ...and every (non-DC) map location is answerable.
    for (const id of mapIds) expect(setIds.has(id)).toBe(true);

    expect(setIds.size).toBe(mapIds.size);
  });
});

/**
 * Regional sets — curated ISO-code subsets of the countries data. Membership
 * (id, label, isoCodes) mirrors the validated lists registered in sets.ts.
 */
const REGIONS: { id: string; label: string; mapId: string; isoCodes: string[] }[] = [
  {
    id: "europe",
    label: "Europe",
    mapId: "europe",
    isoCodes: [
      "al", "ad", "at", "by", "be", "ba", "bg", "hr", "cy", "cz",
      "dk", "ee", "fi", "fr", "de", "gr", "hu", "is", "ie", "it",
      "xk", "lv", "li", "lt", "lu", "mt", "md", "mc", "me", "nl",
      "mk", "no", "pl", "pt", "ro", "ru", "sm", "rs", "sk", "si",
      "es", "se", "ch", "tr", "ua", "gb", "va",
    ],
  },
  {
    id: "africa",
    label: "Africa",
    mapId: "africa",
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
    mapId: "asia",
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
    mapId: "middle-east",
    isoCodes: [
      "tr", "sy", "lb", "il", "ps", "jo", "iq", "ir",
      "sa", "ye", "om", "ae", "qa", "bh", "kw", "eg",
    ],
  },
  {
    id: "americas",
    label: "Americas",
    mapId: "americas",
    isoCodes: [
      "ag", "ar", "bs", "bb", "bz", "bo", "br", "ca", "cl", "co",
      "cr", "cu", "dm", "do", "ec", "sv", "gd", "gt", "gy", "ht",
      "hn", "jm", "mx", "ni", "pa", "pe", "kn", "lc", "vc", "sr",
      "tt", "us", "uy", "ve", "py",
    ],
  },
];

describe("regional sets", () => {
  const countryIds = new Set(allIdsFor("countries"));

  for (const region of REGIONS) {
    describe(`${region.label} (${region.id})`, () => {
      it("is registered as a known category with a cropped world map", () => {
        expect(KNOWN_CATEGORIES).toContain(region.id);
        const set = getSet(region.id as any);
        expect(set.label).toBe(region.label);
        expect(set.hasMap).toBe(true);
        expect(set.mapId).toBe(region.mapId);
      });

      it("totalFor === the region's isoCodes length", () => {
        expect(totalFor(region.id as any)).toBe(region.isoCodes.length);
      });

      it("has no duplicate ids", () => {
        const ids = allIdsFor(region.id as any);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("every region item id exists in the countries set", () => {
        for (const id of allIdsFor(region.id as any)) {
          expect(countryIds.has(id)).toBe(true);
        }
      });

      it("covers exactly its isoCodes (both directions)", () => {
        const setIds = new Set(allIdsFor(region.id as any));
        const wantIds = new Set(region.isoCodes);
        for (const id of setIds) expect(wantIds.has(id)).toBe(true);
        for (const id of wantIds) expect(setIds.has(id)).toBe(true);
        expect(setIds.size).toBe(wantIds.size);
      });

      it("preserves countries.ts order", () => {
        const ids = allIdsFor(region.id as any);
        const want = new Set(region.isoCodes);
        const expected = allIdsFor("countries").filter((id) => want.has(id));
        expect(ids).toEqual(expected);
      });

      it("resolves names and aliases via the shared lookup", () => {
        const lookup = lookupFor(region.id as any);
        const first = region.isoCodes[0];
        // Every member id resolves to itself through its canonical name.
        const canonical = getSet(region.id as any).items.find((i) => i.id === first)!;
        expect(lookup.get(normalizeAnswer(canonical.name))).toBe(first);
      });
    });
  }

  it("middle-east includes eg/ir/tr and excludes ge/am/az", () => {
    const ids = new Set(allIdsFor("middle-east"));
    for (const id of ["eg", "ir", "tr"]) expect(ids.has(id)).toBe(true);
    for (const id of ["ge", "am", "az"]) expect(ids.has(id)).toBe(false);
  });

  it("europe includes tr (transcontinental — has European territory)", () => {
    expect(new Set(allIdsFor("europe")).has("tr")).toBe(true);
  });
});

describe("shared geo region lists (geo.ts)", () => {
  const answerable = new Set(countries.map((c) => c.iso));

  for (const id of REGION_IDS) {
    it(`${id}: every listed id is an answerable country (no silent drops)`, () => {
      // regionSet() filters countries by these ids, so an unknown id (e.g.
      // Western Sahara "eh") would vanish server-side while the client still
      // counted it — the raw list must be a subset of the countries data.
      expect(REGION_ISO[id].filter((iso) => !answerable.has(iso))).toEqual([]);
      expect(new Set(REGION_ISO[id]).size).toBe(REGION_ISO[id].length);
      expect(totalFor(id)).toBe(REGION_ISO[id].length);
    });
  }

  it("every registered set takes its label from CATEGORY_LABELS", () => {
    for (const id of KNOWN_CATEGORIES) {
      expect(getSet(id).label).toBe(CATEGORY_LABELS[id]);
    }
  });
});
