import { describe, it, expect } from "vitest";
import { CONTINENTS, countryName, groupByContinent } from "./continents";
import { WORLD_LOCATIONS } from "./worldMap";

describe("continents", () => {
  const all = Object.values(CONTINENTS).flat();

  it("covers every playable country exactly once", () => {
    expect(all).toHaveLength(197);
    expect(new Set(all).size).toBe(all.length);
  });

  it("only uses codes that exist on the map", () => {
    const mapIds = new Set(WORLD_LOCATIONS.map((l) => l.id));
    expect(all.filter((iso) => !mapIds.has(iso))).toEqual([]);
  });

  it("uses modern display names over the map package's", () => {
    expect(countryName("sz")).toBe("Eswatini");
    expect(countryName("mk")).toBe("North Macedonia");
    expect(countryName("fr")).toBe("France");
  });

  it("groups named countries by continent, sorted, with per-continent totals", () => {
    const groups = groupByContinent(["jp", "fr", "de", "br", "cn"]);
    const by = Object.fromEntries(groups.map((g) => [g.continent, g]));
    expect(groups.map((g) => g.continent)).toEqual([
      "Africa", "Asia", "Europe", "North America", "South America", "Oceania",
    ]);
    expect(by.Europe.names).toEqual(["France", "Germany"]);
    expect(by.Asia.names).toEqual(["China", "Japan"]);
    expect(by["South America"].names).toEqual(["Brazil"]);
    expect(by.Africa.names).toEqual([]);
    expect(by.Europe.total).toBe(CONTINENTS.Europe.length);
  });
});
