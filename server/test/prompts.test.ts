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

  it("island includes jp/is and island nations with one land border (gb/ie/do)", () => {
    const ids = within("island");
    expect(ids.has("jp")).toBe(true);
    expect(ids.has("is")).toBe(true);
    // Island countries that share their island (a single land border) still count.
    expect(ids.has("gb")).toBe(true);
    expect(ids.has("ie")).toBe(true);
    expect(ids.has("do")).toBe(true);
    // A continental country is still excluded.
    expect(ids.has("fr")).toBe(false);
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

  it("'contains W' matches names with a W anywhere, incl. ones not starting with W", () => {
    const ids = within("contains-w");
    expect(ids.has("zw")).toBe(true); // Zimbabwe
    expect(ids.has("bw")).toBe(true); // Botswana
    expect(ids.has("rw")).toBe(true); // Rwanda
    expect(ids.has("fr")).toBe(false); // France has no W
  });

  it("'contains Z' includes Brazil (Z not at the start)", () => {
    const ids = within("contains-z");
    expect(ids.has("br")).toBe(true);
    expect(ids.has("zm")).toBe(true); // Zambia
  });

  it("common letters make no 'contains' prompt (too trivial)", () => {
    // A/E/I match nearly every country, so the family omits them.
    expect(promptById("contains-a")).toBeUndefined();
    expect(promptById("contains-e")).toBeUndefined();
    // X/Q are too rare to clear MIN_VALID.
    expect(promptById("contains-x")).toBeUndefined();
  });

  it("'-stan' names include Pakistan/Kazakhstan, exclude France", () => {
    const ids = within("name-ends-stan");
    expect(ids.has("pk")).toBe(true);
    expect(ids.has("kz")).toBe(true);
    expect(ids.has("fr")).toBe(false);
  });

  it("double-letter names include Morocco/Philippines, exclude Spain", () => {
    const ids = within("name-double-letter");
    expect(ids.has("ma")).toBe(true); // moroCCo
    expect(ids.has("ph")).toBe(true); // philiPPines
    expect(ids.has("es")).toBe(false); // spain — no double letter
  });

  it("name length tiers: short excludes long and vice versa", () => {
    const short = within("name-short"); // <= 5 letters
    const long = within("name-long"); // >= 10 letters
    expect(short.has("cu")).toBe(true); // Cuba
    expect(short.has("us")).toBe(false); // United States is long
    expect(long.has("us")).toBe(true);
    expect(long.has("cu")).toBe(false);
  });

  it("population > 200M includes India/China, excludes Monaco", () => {
    const ids = within("population-200");
    expect(ids.has("in")).toBe(true);
    expect(ids.has("cn")).toBe(true);
    expect(ids.has("mc")).toBe(false);
  });

  it("density-high includes a dense country, density-low includes a sparse one", () => {
    const high = within("density-high");
    const low = within("density-low");
    expect(high.has("bd")).toBe(true); // Bangladesh — very dense
    expect(low.has("mn")).toBe(true); // Mongolia — very sparse
    expect(high.has("mn")).toBe(false);
  });

  it("exact border counts are disjoint tiers", () => {
    const two = within("borders-2");
    const three = within("borders-3");
    for (const id of two) expect(three.has(id)).toBe(false);
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

  it("NATO includes the US/France, excludes neutral Ireland and non-member Russia", () => {
    const ids = within("org-nato");
    expect(ids.has("us")).toBe(true);
    expect(ids.has("fr")).toBe(true);
    expect(ids.has("fi")).toBe(true); // joined 2023
    expect(ids.has("ie")).toBe(false);
    expect(ids.has("ru")).toBe(false);
  });

  it("nuclear-armed is exactly the nine possessor states", () => {
    const ids = within("mil-nuclear");
    expect(ids.size).toBe(9);
    for (const iso of ["us", "ru", "cn", "fr", "gb", "in", "pk", "kp", "il"]) {
      expect(ids.has(iso)).toBe(true);
    }
  });

  it("USD users include Ecuador/El Salvador, exclude the eurozone", () => {
    const ids = within("org-usd");
    expect(ids.has("ec")).toBe(true);
    expect(ids.has("sv")).toBe(true);
    expect(ids.has("de")).toBe(false);
  });

  it("ocean coasts: landlocked countries never appear", () => {
    const atlantic = within("ocean-atlantic");
    const pacific = within("ocean-pacific");
    expect(atlantic.has("br")).toBe(true);
    expect(pacific.has("jp")).toBe(true);
    // Switzerland/Bolivia are landlocked — on no ocean.
    for (const sea of [atlantic, pacific, within("ocean-indian")]) {
      expect(sea.has("ch")).toBe(false);
      expect(sea.has("bo")).toBe(false);
    }
  });

  it("former colonies: British includes India, French includes Senegal; not swapped", () => {
    const british = within("hist-british");
    const french = within("hist-french");
    expect(british.has("in")).toBe(true);
    expect(british.has("sn")).toBe(false);
    expect(french.has("sn")).toBe(true);
    expect(french.has("in")).toBe(false);
  });
});

describe("wildlife-range prompts", () => {
  const within = (id: string) => validIdsFor(get(id), "countries");

  it("lions: Kenya/India in, landlocked-away France out", () => {
    const ids = within("animal-lions");
    expect(ids.has("ke")).toBe(true);
    expect(ids.has("in")).toBe(true); // Asiatic lion
    expect(ids.has("za")).toBe(true);
    expect(ids.has("fr")).toBe(false);
  });

  it("tigers are an Asia-only cat (no African range states)", () => {
    const ids = within("animal-tigers");
    expect(ids.has("in")).toBe(true);
    expect(ids.has("ru")).toBe(true); // Amur tiger
    expect(ids.has("ke")).toBe(false); // no African tigers
    expect(ids.has("bn")).toBe(false); // Brunei has no tigers (guard a past data slip)
  });

  it("elephants include the famous range states (South Africa, Thailand)", () => {
    const ids = within("animal-elephants");
    expect(ids.has("za")).toBe(true); // Kruger
    expect(ids.has("th")).toBe(true); // Asian elephant
    expect(ids.has("in")).toBe(true);
    expect(ids.has("cg")).toBe(true); // forest elephants, Republic of the Congo
    expect(ids.has("fr")).toBe(false);
  });

  it("cheetahs: South Africa in, Saudi Arabia out (extinct), Iran in (Asiatic)", () => {
    const ids = within("animal-cheetahs");
    expect(ids.has("za")).toBe(true);
    expect(ids.has("ir")).toBe(true);
    expect(ids.has("sa")).toBe(false); // extinct in Saudi Arabia
  });

  it("jaguars span the Americas incl. Guatemala, exclude the US (no breeding pop)", () => {
    const ids = within("animal-jaguars");
    expect(ids.has("br")).toBe(true);
    expect(ids.has("mx")).toBe(true);
    expect(ids.has("gt")).toBe(true);
    expect(ids.has("us")).toBe(false);
  });

  it("pumas run from Canada to Chile", () => {
    const ids = within("animal-pumas");
    expect(ids.has("ca")).toBe(true);
    expect(ids.has("us")).toBe(true);
    expect(ids.has("cl")).toBe(true);
    expect(ids.has("ao")).toBe(false); // not in the Old World
  });

  it("bison include Belarus (Białowieża wisent) and the US", () => {
    const ids = within("animal-bison");
    expect(ids.has("by")).toBe(true);
    expect(ids.has("us")).toBe(true);
    expect(ids.has("pl")).toBe(true);
  });

  it("penguins: southern-hemisphere coasts only, never landlocked/Europe", () => {
    const ids = within("animal-penguins");
    expect(ids.has("za")).toBe(true);
    expect(ids.has("ar")).toBe(true);
    expect(ids.has("nz")).toBe(true);
    expect(ids.has("de")).toBe(false);
  });

  it("every animal prompt clears MIN_VALID within 'countries' (none is a dead prompt)", () => {
    const animalIds = prompts.map((p) => p.id).filter((id) => id.startsWith("animal-"));
    expect(animalIds.length).toBe(25);
    for (const id of animalIds) {
      expect(within(id).size, `${id} should clear MIN_VALID`).toBeGreaterThanOrEqual(MIN_VALID);
    }
  });

  it("spread across regions: lions→Africa, snow leopards→Asia, jaguars→Americas", () => {
    expect(validIdsFor(get("animal-lions"), "africa").size).toBeGreaterThanOrEqual(MIN_VALID);
    expect(validIdsFor(get("animal-snow-leopards"), "asia").size).toBeGreaterThanOrEqual(MIN_VALID);
    expect(validIdsFor(get("animal-jaguars"), "americas").size).toBeGreaterThanOrEqual(MIN_VALID);
  });
});

describe("capital-based prompts (within 'countries')", () => {
  const within = (id: string) => validIdsFor(get(id), "countries");

  it("capital starts with B: France (Paris=P) excluded, Germany (Berlin) included", () => {
    const ids = within("capital-starts-b");
    expect(ids.has("de")).toBe(true); // Berlin
    expect(ids.has("cn")).toBe(true); // Beijing
    expect(ids.has("fr")).toBe(false); // Paris
  });

  it("capital starts with W: country named off the CAPITAL, not its own name", () => {
    const ids = within("capital-starts-w");
    expect(ids.has("pl")).toBe(true); // Warsaw
    expect(ids.has("na")).toBe(true); // Windhoek
    expect(ids.has("us")).toBe(true); // Washington
  });

  it("capital shares the country name: Singapore yes, France no", () => {
    const ids = within("capital-equals-country");
    expect(ids.has("sg")).toBe(true); // Singapore
    expect(ids.has("kw")).toBe(true); // Kuwait City ~ Kuwait
    expect(ids.has("mx")).toBe(true); // Mexico City ~ Mexico
    expect(ids.has("fr")).toBe(false); // Paris
    expect(ids.has("br")).toBe(false); // Brasilia is NOT ~ Brazil
  });

  it("capital not largest city: US/Australia yes, France (Paris is largest) no", () => {
    const ids = within("capital-not-largest");
    expect(ids.has("us")).toBe(true); // Washington < New York
    expect(ids.has("au")).toBe(true); // Canberra < Sydney
    expect(ids.has("tr")).toBe(true); // Ankara < Istanbul
    expect(ids.has("fr")).toBe(false);
  });
});

describe("flag-feature prompts (within 'countries')", () => {
  const within = (id: string) => validIdsFor(get(id), "countries");

  it("crescent includes Turkey/Pakistan, excludes France", () => {
    const ids = within("flag-crescent");
    expect(ids.has("tr")).toBe(true);
    expect(ids.has("pk")).toBe(true);
    expect(ids.has("fr")).toBe(false);
  });

  it("star includes USA/China, excludes Vanuatu (boar tusk, no star)", () => {
    const ids = within("flag-star");
    expect(ids.has("us")).toBe(true);
    expect(ids.has("cn")).toBe(true);
    expect(ids.has("vu")).toBe(false);
  });

  it("vertical stripes include France, exclude Mexico (central emblem)", () => {
    const vert = within("flag-v-stripes");
    expect(vert.has("fr")).toBe(true);
    expect(vert.has("mx")).toBe(false); // emblem, removed in verification
    const horiz = within("flag-h-stripes");
    expect(horiz.has("nl")).toBe(true);
    expect(horiz.has("co")).toBe(false); // unequal bands, removed
  });

  it("animal includes Sri Lanka/Mexico, excludes France", () => {
    const ids = within("flag-animal");
    expect(ids.has("lk")).toBe(true); // lion
    expect(ids.has("mx")).toBe(true); // eagle + snake
    expect(ids.has("fr")).toBe(false);
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
