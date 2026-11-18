import type { Country } from "../../src/data/countries.js";
import type { AnswerItem } from "../../src/matching.js";

/**
 * A tiny deterministic category so matching/scoring tests don't depend on the
 * real 196-country dataset. Exercises plain names, aliases, diacritics, and
 * multi-word names. total === 4 keeps winner/missed math trivial.
 *
 * Each entry carries both `iso` (legacy Country shape, read by some tests) and
 * the generalized `id` (== iso) so it can be passed straight to buildLookup,
 * which now keys on AnswerItem.id.
 */
export const fakeCountries: (Country & AnswerItem)[] = [
  { iso: "fr", id: "fr", name: "France", aliases: [] },
  {
    iso: "us",
    id: "us",
    name: "United States",
    aliases: ["usa", "america", "united states of america"],
  },
  { iso: "ci", id: "ci", name: "Côte d'Ivoire", aliases: ["ivory coast"] },
  { iso: "kr", id: "kr", name: "South Korea", aliases: ["korea", "republic of korea"] },
];
