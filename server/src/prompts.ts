/**
 * Gauntlet prompt engine (SERVER-ONLY).
 *
 * A Prompt constrains valid answers for a round of Gauntlet. Each prompt
 * precomputes `validIds` — the lowercase isos over ALL countries that satisfy
 * it — from the attribute dataset (`data/countryAttributes.ts`), the region
 * membership in `sets.ts`, and country names.
 *
 * ANTI-CHEAT: `validIds` is server-side only and must NEVER be sent to clients.
 * Clients receive only `{ id, label }` (see RoomState.prompt / prompt_changed).
 * The mode gives NO hints — there is no remaining/count field anywhere.
 *
 * Gauntlet is only meaningful for country sets ("countries" + the 5 regions);
 * for "us-states" the pool is empty (the prompts resolve to no valid ids).
 */

import type { CategoryId } from "./protocol.js";
import { normalizeAnswer } from "./protocol.js";
import { countryAttributes } from "./data/countryAttributes.js";
import { countries } from "./data/countries.js";
import { allIdsFor } from "./sets.js";

/** A compiled prompt: label is shown to players; validIds stays server-side. */
export interface Prompt {
  id: string;
  label: string;
  /** Lowercase isos (over ALL countries) that satisfy the prompt. Server only. */
  validIds: Set<string>;
}

/**
 * Minimum valid answers (within a category) for a prompt to be offered — so a
 * round does not dead-end immediately.
 */
export const MIN_VALID = 8;

/** All attribute records as an array (the full country attribute pool). */
const allAttrs = Object.values(countryAttributes);

/** Build a Set of isos from attribute records matching a predicate. */
function attrIds(predicate: (a: (typeof allAttrs)[number]) => boolean): Set<string> {
  return new Set(allAttrs.filter(predicate).map((a) => a.iso));
}

/** The five region category ids whose membership drives the region prompts. */
const REGION_PROMPTS: { id: CategoryId; label: string }[] = [
  { id: "europe", label: "Europe" },
  { id: "africa", label: "Africa" },
  { id: "asia", label: "Asia" },
  { id: "middle-east", label: "the Middle East" },
  { id: "americas", label: "the Americas" },
];

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

/**
 * Categories the prompt engine scopes over: "countries" + the 5 region sets.
 * Prompt validIds are country isos; other sets (e.g. "us-states") use postal
 * codes that collide with isos, so prompts simply do not apply there — the pool
 * is empty. Keep this list in sync with the region prompt list.
 */
const COUNTRY_CATEGORIES: ReadonlySet<CategoryId> = new Set<CategoryId>([
  "countries",
  "europe",
  "africa",
  "asia",
  "middle-east",
  "americas",
]);

/** Build the full prompt pool (all families), each with precomputed validIds. */
function buildPrompts(): Prompt[] {
  const prompts: Prompt[] = [];

  // starts-with-letter: normalizeAnswer(name) starts with the letter.
  // Skip letters no country name starts with (e.g. W, X) so every prompt has
  // at least one valid id.
  for (const letter of LETTERS) {
    const ids = new Set(
      countries
        .filter((c) => normalizeAnswer(c.name).startsWith(letter))
        .map((c) => c.iso),
    );
    if (ids.size === 0) continue;
    prompts.push({
      id: `starts-with-${letter}`,
      label: `Name a country starting with ${letter.toUpperCase()}`,
      validIds: ids,
    });
  }

  // landlocked
  prompts.push({
    id: "landlocked",
    label: "Name a landlocked country",
    validIds: attrIds((a) => a.landlocked === true),
  });

  // island nation
  prompts.push({
    id: "island",
    label: "Name an island nation",
    validIds: attrIds((a) => a.island === true),
  });

  // region
  for (const region of REGION_PROMPTS) {
    prompts.push({
      id: `region-${region.id}`,
      label: `Name a country in ${region.label}`,
      validIds: new Set(allIdsFor(region.id)),
    });
  }

  // elevation thresholds (feet)
  for (const ft of [10000, 13000]) {
    prompts.push({
      id: `elevation-${ft}`,
      label: `Name a country with a peak above ${ft.toLocaleString("en-US")} ft`,
      validIds: attrIds((a) => a.elevationFtMax > ft),
    });
  }

  // population thresholds (millions)
  for (const m of [20, 50]) {
    prompts.push({
      id: `population-${m}`,
      label: `Name a country with over ${m} million people`,
      validIds: attrIds((a) => a.populationM > m),
    });
  }

  // borders count
  prompts.push({
    id: "borders-4",
    label: "Name a country bordering more than 4 others",
    validIds: attrIds((a) => a.borders.length > 4),
  });

  return prompts;
}

/** The full prompt pool (all families). validIds is server-side only. */
export const prompts: Prompt[] = buildPrompts();

const byId = new Map(prompts.map((p) => [p.id, p]));

/** Resolve a prompt by id (undefined if unknown). */
export function promptById(id: string): Prompt | undefined {
  return byId.get(id);
}

/**
 * The prompt's valid isos intersected with a category's item ids — the valid
 * answers when playing that prompt within that set.
 */
export function validIdsFor(prompt: Prompt, categoryId: CategoryId): Set<string> {
  // Prompts are country-scoped: their validIds are country isos. Non-country
  // sets (e.g. "us-states") use colliding postal codes, so no prompt applies.
  if (!COUNTRY_CATEGORIES.has(categoryId)) return new Set<string>();
  const inSet = new Set(allIdsFor(categoryId));
  const out = new Set<string>();
  for (const id of prompt.validIds) {
    if (inSet.has(id)) out.add(id);
  }
  return out;
}

/**
 * The prompts playable for a category: those with at least MIN_VALID valid
 * answers within that set. Empty for sets with no attribute coverage (e.g.
 * "us-states").
 */
export function buildPromptPool(categoryId: CategoryId): Prompt[] {
  return prompts.filter((p) => validIdsFor(p, categoryId).size >= MIN_VALID);
}
