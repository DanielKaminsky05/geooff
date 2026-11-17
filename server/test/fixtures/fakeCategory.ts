import type { Country } from "../../src/data/countries.js";

/**
 * A tiny deterministic category so matching/scoring tests don't depend on the
 * real 196-country dataset. Exercises plain names, aliases, diacritics, and
 * multi-word names. total === 4 keeps winner/missed math trivial.
 */
export const fakeCountries: Country[] = [
  { iso: "fr", name: "France", aliases: [] },
  {
    iso: "us",
    name: "United States",
    aliases: ["usa", "america", "united states of america"],
  },
  { iso: "ci", name: "Côte d'Ivoire", aliases: ["ivory coast"] },
  { iso: "kr", name: "South Korea", aliases: ["korea", "republic of korea"] },
];
