import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  clampTimeLimit,
  TIME_LIMIT_MIN_SECONDS,
  TIME_LIMIT_MAX_SECONDS,
  TIME_LIMIT_DEFAULT_SECONDS,
} from "../src/protocol.js";
import {
  buildLookup,
  buildCanonicalNames,
  matchAnswer,
  scoreGuess,
  determineWinner,
  damerauLevenshtein,
  fuzzyThreshold,
  total,
} from "../src/matching.js";

const lookup = buildLookup();
const names = buildCanonicalNames();

describe("normalizeAnswer", () => {
  it("lowercases and trims", () => {
    expect(normalizeAnswer("  FRANCE  ")).toBe("france");
  });
  it("strips diacritics", () => {
    expect(normalizeAnswer("Côte d'Ivoire")).toBe("cote divoire");
  });
  it("strips punctuation", () => {
    expect(normalizeAnswer("U.S.A.!")).toBe("usa");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeAnswer("united   states")).toBe("united states");
  });
  it("handles mixed case + accents together", () => {
    expect(normalizeAnswer("SÃO Tomé")).toBe("sao tome");
  });
});

describe("clampTimeLimit", () => {
  it("clamps below min up to min", () => {
    expect(clampTimeLimit(10)).toBe(TIME_LIMIT_MIN_SECONDS);
  });
  it("clamps above max down to max", () => {
    expect(clampTimeLimit(99999)).toBe(TIME_LIMIT_MAX_SECONDS);
  });
  it("passes values within range (rounded)", () => {
    expect(clampTimeLimit(240.4)).toBe(240);
  });
  it("falls back to default on NaN", () => {
    expect(clampTimeLimit(NaN)).toBe(TIME_LIMIT_DEFAULT_SECONDS);
  });
});

describe("matchAnswer", () => {
  it("matches canonical name", () => {
    expect(matchAnswer("France", lookup, names)).toMatchObject({ found: true, iso: "fr" });
  });
  it("matches an alias", () => {
    expect(matchAnswer("usa", lookup, names)).toMatchObject({ found: true, iso: "us" });
    expect(matchAnswer("Britain", lookup, names)).toMatchObject({ found: true, iso: "gb" });
  });
  it("matches with accents/punctuation", () => {
    expect(matchAnswer("Côte d'Ivoire", lookup, names)).toMatchObject({ found: true, iso: "ci" });
  });
  it("returns not found for garbage", () => {
    expect(matchAnswer("notacountry", lookup, names).found).toBe(false);
  });
  it("returns canonical display name", () => {
    expect(matchAnswer("america", lookup, names).canonical).toBe("United States");
  });
});

describe("damerauLevenshtein", () => {
  it("counts a transposition as one edit", () => {
    expect(damerauLevenshtein("indoneisa", "indonesia", 2)).toBe(1);
  });
  it("counts an insertion/deletion/substitution as one edit each", () => {
    expect(damerauLevenshtein("kyrgystan", "kyrgyzstan", 2)).toBe(1); // insertion
    expect(damerauLevenshtein("portugalx", "portugal", 2)).toBe(1); // deletion
    expect(damerauLevenshtein("belgiun", "belgium", 2)).toBe(1); // substitution
  });
  it("returns max+1 once the cap is blown (early bail)", () => {
    expect(damerauLevenshtein("france", "germany", 2)).toBe(3);
  });
});

describe("fuzzyThreshold", () => {
  it("gives short inputs no slack and longer inputs more", () => {
    expect(fuzzyThreshold(4)).toBe(0);
    expect(fuzzyThreshold(7)).toBe(1);
    expect(fuzzyThreshold(8)).toBe(2);
  });
});

describe("matchAnswer — typo tolerance", () => {
  it("forgives single-edit typos in longer names", () => {
    expect(matchAnswer("indoneisa", lookup, names)).toMatchObject({ found: true, iso: "id" });
    expect(matchAnswer("phillipines", lookup, names)).toMatchObject({ found: true, iso: "ph" });
    expect(matchAnswer("kyrgystan", lookup, names)).toMatchObject({ found: true, iso: "kg" });
    expect(matchAnswer("azerbijan", lookup, names)).toMatchObject({ found: true, iso: "az" });
    expect(matchAnswer("liechtenstien", lookup, names)).toMatchObject({ found: true, iso: "li" });
  });

  it("never fuzzes short names into a different country", () => {
    // Iran/Iraq are one edit apart — a 4-letter input gets no slack at all.
    expect(matchAnswer("irap", lookup, names).found).toBe(false);
    expect(matchAnswer("mard", lookup, names).found).toBe(false);
  });

  it("rejects a typo that sits equally close to two countries", () => {
    // "slovania" is one edit from both Slovakia and Slovenia → ambiguous.
    expect(matchAnswer("slovania", lookup, names).found).toBe(false);
    // "nigeri" is one edit from both Niger and Nigeria.
    expect(matchAnswer("nigeri", lookup, names).found).toBe(false);
  });

  it("still rejects genuine garbage", () => {
    expect(matchAnswer("notacountry", lookup, names).found).toBe(false);
    expect(matchAnswer("xqzpt land", lookup, names).found).toBe(false);
  });

  it("prefers an exact name/alias over any fuzzy neighbour", () => {
    // "niger" is a real country, so it resolves to Niger, never Nigeria.
    expect(matchAnswer("niger", lookup, names)).toMatchObject({ found: true, iso: "ne" });
  });

  it("resolves curated alternate names exactly", () => {
    expect(matchAnswer("ceylon", lookup, names)).toMatchObject({ iso: "lk" });
    expect(matchAnswer("siam", lookup, names)).toMatchObject({ iso: "th" });
    expect(matchAnswer("formosa", lookup, names)).toMatchObject({ iso: "tw" });
    expect(matchAnswer("eire", lookup, names)).toMatchObject({ iso: "ie" });
    expect(matchAnswer("oz", lookup, names)).toMatchObject({ iso: "au" });
    // "dominican" is a curated alias, so it means the Republic — never Dominica.
    expect(matchAnswer("dominican", lookup, names)).toMatchObject({ iso: "do" });
    expect(matchAnswer("dominica", lookup, names)).toMatchObject({ iso: "dm" });
  });
});

describe("scoreGuess", () => {
  it("accepts a correct new answer", () => {
    const filled = new Set<string>();
    const r = scoreGuess("Brazil", filled, lookup, names);
    expect(r.kind).toBe("accepted");
    expect(filled.has("br")).toBe(true);
  });
  it("accepts via alias", () => {
    const filled = new Set<string>();
    expect(scoreGuess("holland", filled, lookup, names).kind).toBe("accepted");
    expect(filled.has("nl")).toBe(true);
  });
  it("rejects a duplicate", () => {
    const filled = new Set<string>(["fr"]);
    expect(scoreGuess("France", filled, lookup, names).kind).toBe("duplicate");
  });
  it("rejects a wrong answer", () => {
    expect(scoreGuess("zzz", new Set(), lookup, names).kind).toBe("wrong");
  });
  it("rejects empty input", () => {
    expect(scoreGuess("   ", new Set(), lookup, names).kind).toBe("empty");
  });
});

describe("determineWinner", () => {
  it("picks the higher score (p1 > p2)", () => {
    expect(
      determineWinner([
        { playerId: "a", score: 10 },
        { playerId: "b", score: 4 },
      ]),
    ).toBe("a");
  });
  it("picks the higher score (p2 > p1)", () => {
    expect(
      determineWinner([
        { playerId: "a", score: 3 },
        { playerId: "b", score: 9 },
      ]),
    ).toBe("b");
  });
  it("returns null on a tie", () => {
    expect(
      determineWinner([
        { playerId: "a", score: 5 },
        { playerId: "b", score: 5 },
      ]),
    ).toBeNull();
  });
});

describe("country data", () => {
  it("has roughly 196 countries", () => {
    expect(total).toBeGreaterThanOrEqual(193);
    expect(total).toBeLessThanOrEqual(200);
  });
});
