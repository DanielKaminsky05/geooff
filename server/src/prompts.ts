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
import {
  spanishSpeaking,
  frenchSpeaking,
  arabicSpeaking,
  portugueseSpeaking,
  euMembers,
  eurozone,
  opecMembers,
  commonwealthMembers,
  aseanMembers,
  equatorCrossers,
  southernHemisphere,
  mediterraneanCoast,
  drivesLeft,
  monarchies,
} from "./data/countryGroups.js";
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
  prompts.push({
    id: "borders-1",
    label: "Name a country with exactly one land border",
    validIds: attrIds((a) => a.borders.length === 1),
  });

  // borders-a-given-country: data-driven. "Name a country that borders X" for
  // every country with enough neighbours to stand on its own (Russia, China,
  // Brazil, Germany, …). validIds = the countries whose border list includes X.
  const isoToName = new Map(countries.map((c) => [c.iso, c.name]));
  const neighboursOf = new Map<string, Set<string>>();
  for (const a of allAttrs) {
    for (const b of a.borders) {
      if (!neighboursOf.has(b)) neighboursOf.set(b, new Set());
      neighboursOf.get(b)!.add(a.iso);
    }
  }
  for (const [iso, neighbours] of neighboursOf) {
    const name = isoToName.get(iso);
    if (!name || neighbours.size < MIN_VALID) continue;
    prompts.push({
      id: `borders-country-${iso}`,
      label: `Name a country that borders ${name}`,
      validIds: new Set(neighbours),
    });
  }

  // area thresholds (km²): the giants and the micro-states.
  prompts.push({
    id: "area-large",
    label: "Name a country larger than 1,000,000 km²",
    validIds: attrIds((a) => a.areaKm2 > 1_000_000),
  });
  prompts.push({
    id: "area-small",
    label: "Name a country smaller than 10,000 km²",
    validIds: attrIds((a) => a.areaKm2 < 10_000),
  });

  // more population tiers: the giants and the tiny.
  prompts.push({
    id: "population-100",
    label: "Name a country with over 100 million people",
    validIds: attrIds((a) => a.populationM > 100),
  });
  prompts.push({
    id: "population-under-2",
    label: "Name a country with fewer than 2 million people",
    validIds: attrIds((a) => a.populationM < 2),
  });

  // flat countries (low highest point).
  prompts.push({
    id: "elevation-low",
    label: "Name a country whose highest point is under 1,500 ft",
    validIds: attrIds((a) => a.elevationFtMax < 1500),
  });

  // name patterns.
  prompts.push({
    id: "name-multiword",
    label: "Name a country whose name is more than one word",
    validIds: new Set(countries.filter((c) => c.name.trim().includes(" ")).map((c) => c.iso)),
  });
  prompts.push({
    id: "name-ends-land",
    label: "Name a country whose name ends in “-land”",
    validIds: new Set(
      countries.filter((c) => normalizeAnswer(c.name).endsWith("land")).map((c) => c.iso),
    ),
  });

  // Categorical groupings (language, organisations, geography, misc) from the
  // researched countryGroups data. Each only surfaces for a set where ≥ MIN_VALID
  // of its members fall inside it — so e.g. "Spanish-speaking" shows up in the
  // Americas and "Arabic-speaking" in the Middle East.
  const groupPrompts: { id: string; label: string; ids: readonly string[] }[] = [
    { id: "lang-spanish", label: "Name a Spanish-speaking country", ids: spanishSpeaking },
    { id: "lang-french", label: "Name a French-speaking country", ids: frenchSpeaking },
    { id: "lang-arabic", label: "Name an Arabic-speaking country", ids: arabicSpeaking },
    { id: "lang-portuguese", label: "Name a Portuguese-speaking country", ids: portugueseSpeaking },
    { id: "org-eu", label: "Name a European Union member", ids: euMembers },
    { id: "org-euro", label: "Name a country that uses the euro", ids: eurozone },
    { id: "org-opec", label: "Name an OPEC member", ids: opecMembers },
    { id: "org-commonwealth", label: "Name a Commonwealth member", ids: commonwealthMembers },
    { id: "org-asean", label: "Name an ASEAN member", ids: aseanMembers },
    { id: "geo-equator", label: "Name a country the Equator passes through", ids: equatorCrossers },
    { id: "geo-southern", label: "Name a country in the Southern Hemisphere", ids: southernHemisphere },
    { id: "geo-mediterranean", label: "Name a country with a Mediterranean coastline", ids: mediterraneanCoast },
    { id: "misc-drives-left", label: "Name a country that drives on the left", ids: drivesLeft },
    { id: "misc-monarchy", label: "Name a country that is a monarchy", ids: monarchies },
  ];
  for (const g of groupPrompts) {
    prompts.push({ id: g.id, label: g.label, validIds: new Set(g.ids) });
  }

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
 * Memo caches. Prompts and category membership are static for the process
 * lifetime, so these are computed once per (prompt, category) / category
 * instead of on every turn, snapshot and submission.
 */
const validIdsCache = new Map<CategoryId, WeakMap<Prompt, Set<string>>>();
const poolCache = new Map<CategoryId, Prompt[]>();

/**
 * The prompt's valid isos intersected with a category's item ids — the valid
 * answers when playing that prompt within that set. Memoized per
 * (prompt, category); the returned Set is shared, so callers must NOT mutate it.
 */
export function validIdsFor(prompt: Prompt, categoryId: CategoryId): Set<string> {
  let byPrompt = validIdsCache.get(categoryId);
  if (!byPrompt) {
    byPrompt = new WeakMap();
    validIdsCache.set(categoryId, byPrompt);
  }
  let out = byPrompt.get(prompt);
  if (!out) {
    out = computeValidIds(prompt, categoryId);
    byPrompt.set(prompt, out);
  }
  return out;
}

function computeValidIds(prompt: Prompt, categoryId: CategoryId): Set<string> {
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
 * "us-states"). Memoized per category; returns a fresh copy of the cached
 * array so callers can't corrupt the cache by mutating it.
 */
export function buildPromptPool(categoryId: CategoryId): Prompt[] {
  let pool = poolCache.get(categoryId);
  if (!pool) {
    pool = prompts.filter((p) => validIdsFor(p, categoryId).size >= MIN_VALID);
    poolCache.set(categoryId, pool);
  }
  return [...pool];
}
