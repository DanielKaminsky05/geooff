import { describe, it, expect } from "vitest";
import {
  getSet,
  lookupFor,
  totalFor,
  allIdsFor,
  KNOWN_CATEGORIES,
} from "../src/sets.js";
import { normalizeAnswer } from "../src/protocol.js";

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
