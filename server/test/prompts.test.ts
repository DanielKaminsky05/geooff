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

  it("borders-a-country lists that country's neighbours only", () => {
    const ru = within("borders-country-ru");
    expect(ru.has("fi")).toBe(true); // Finland borders Russia
    expect(ru.has("cn")).toBe(true); // China borders Russia
    expect(ru.has("br")).toBe(false); // Brazil does not
    expect(ru.has("ru")).toBe(false); // a country doesn't border itself
  });

  it("area/population tiers include the giants, exclude the tiny", () => {
    const big = within("area-large");
    expect(big.has("ru")).toBe(true);
    expect(big.has("ca")).toBe(true);
    expect(big.has("mc")).toBe(false);
    const pop = within("population-100");
    expect(pop.has("cn")).toBe(true);
    expect(pop.has("in")).toBe(true);
    expect(pop.has("mc")).toBe(false);
  });

  it("multi-word names include United States / South Africa, exclude France", () => {
    const ids = within("name-multiword");
    expect(ids.has("us")).toBe(true);
    expect(ids.has("za")).toBe(true);
    expect(ids.has("fr")).toBe(false);
  });
});

describe("categorical group prompts (within 'countries')", () => {
  const within = (id: string) => validIdsFor(get(id), "countries");

  it("Spanish-speaking includes Mexico/Spain, excludes France/Brazil", () => {
    const ids = within("lang-spanish");
    expect(ids.has("mx")).toBe(true);
    expect(ids.has("es")).toBe(true);
    expect(ids.has("fr")).toBe(false);
    expect(ids.has("br")).toBe(false);
  });

  it("Arabic-speaking includes Saudi/Egypt, excludes Iran (Persian) and Israel", () => {
    const ids = within("lang-arabic");
    expect(ids.has("sa")).toBe(true);
    expect(ids.has("eg")).toBe(true);
    expect(ids.has("ir")).toBe(false);
    expect(ids.has("il")).toBe(false);
  });

  it("EU excludes the UK (left) and Switzerland (never joined)", () => {
    const ids = within("org-eu");
    expect(ids.has("de")).toBe(true);
    expect(ids.has("gb")).toBe(false);
    expect(ids.has("ch")).toBe(false);
  });

  it("euro users exclude Sweden (EU but not eurozone)", () => {
    const ids = within("org-euro");
    expect(ids.has("de")).toBe(true);
    expect(ids.has("se")).toBe(false);
  });

  it("monarchy includes UK/Japan/Saudi, excludes the US and republic Barbados", () => {
    const ids = within("misc-monarchy");
    expect(ids.has("gb")).toBe(true);
    expect(ids.has("jp")).toBe(true);
    expect(ids.has("sa")).toBe(true);
    expect(ids.has("us")).toBe(false);
    expect(ids.has("bb")).toBe(false); // Barbados became a republic in 2021
  });

  it("Commonwealth includes Malta and Saint Kitts (both members)", () => {
    const ids = within("org-commonwealth");
    expect(ids.has("mt")).toBe(true);
    expect(ids.has("kn")).toBe(true);
  });

  it("Arabic-speaking gives the Middle East a real prompt (>= MIN_VALID there)", () => {
    expect(validIdsFor(get("lang-arabic"), "middle-east").size).toBeGreaterThanOrEqual(MIN_VALID);
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
