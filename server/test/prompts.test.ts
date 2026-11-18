import { describe, it, expect } from "vitest";
import {
  prompts,
  promptById,
  validIdsFor,
  buildPromptPool,
  MIN_VALID,
  type Prompt,
} from "../src/prompts.js";
import { allIdsFor } from "../src/sets.js";

describe("prompt pool", () => {
  it("every prompt has at least one valid id", () => {
    for (const p of prompts) {
      expect(p.validIds.size, `${p.id} should have >= 1 valid id`).toBeGreaterThan(0);
    }
  });

  it("every prompt has a unique id and a label", () => {
    const ids = prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of prompts) expect(p.label.length).toBeGreaterThan(0);
  });

  it("promptById resolves known ids and rejects unknown", () => {
    for (const p of prompts) expect(promptById(p.id)).toBe(p);
    expect(promptById("does-not-exist")).toBeUndefined();
  });
});

const get = (id: string): Prompt => {
  const p = promptById(id);
  if (!p) throw new Error(`missing prompt ${id}`);
  return p;
};

describe("validIdsFor intersection", () => {
  it("a region prompt within 'countries' equals that region's set", () => {
    const europeIds = new Set(allIdsFor("europe"));
    const valid = validIdsFor(get("region-europe"), "countries");
    expect(valid).toEqual(europeIds);
  });

  it("a region prompt within its own region set is that whole set", () => {
    const africaIds = new Set(allIdsFor("africa"));
    const valid = validIdsFor(get("region-africa"), "africa");
    expect(valid).toEqual(africaIds);
  });

  it("only returns ids that are in the target category", () => {
    const asiaIds = new Set(allIdsFor("asia"));
    // landlocked valid set within asia must be a subset of asia.
    const valid = validIdsFor(get("landlocked"), "asia");
    for (const id of valid) expect(asiaIds.has(id)).toBe(true);
  });
});

describe("prompt spot-checks (within 'countries')", () => {
  const within = (id: string) => validIdsFor(get(id), "countries");

  it("landlocked includes np/bo and excludes fr", () => {
    const ids = within("landlocked");
    expect(ids.has("np")).toBe(true);
    expect(ids.has("bo")).toBe(true);
    expect(ids.has("fr")).toBe(false);
  });

  it("island includes jp/is", () => {
    const ids = within("island");
    expect(ids.has("jp")).toBe(true);
    expect(ids.has("is")).toBe(true);
  });

  it("'starts with b' includes brazil/belgium", () => {
    const ids = within("starts-with-b");
    expect(ids.has("br")).toBe(true);
    expect(ids.has("be")).toBe(true);
  });

  it("elevation > 13000 ft includes np/cn and excludes nl", () => {
    const ids = within("elevation-13000");
    expect(ids.has("np")).toBe(true);
    expect(ids.has("cn")).toBe(true);
    expect(ids.has("nl")).toBe(false);
  });

  it("population > 50 million includes us/cn/in", () => {
    const ids = within("population-50");
    expect(ids.has("us")).toBe(true);
    expect(ids.has("cn")).toBe(true);
    expect(ids.has("in")).toBe(true);
  });

  it("borders > 4 includes a high-degree country (cn/ru/br)", () => {
    const ids = within("borders-4");
    expect(ids.has("cn")).toBe(true);
    expect(ids.has("ru")).toBe(true);
    expect(ids.has("br")).toBe(true);
  });
});

describe("buildPromptPool", () => {
  it("every prompt in a pool meets MIN_VALID within that category", () => {
    for (const p of buildPromptPool("countries")) {
      expect(validIdsFor(p, "countries").size).toBeGreaterThanOrEqual(MIN_VALID);
    }
  });

  it("is non-empty for 'countries'", () => {
    expect(buildPromptPool("countries").length).toBeGreaterThan(0);
  });

  it("is empty for 'us-states' (no attribute coverage)", () => {
    expect(buildPromptPool("us-states")).toEqual([]);
  });
});
