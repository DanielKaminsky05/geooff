/**
 * Daily Dive — rarity-weighted scoring (Track A).
 *
 * Each correct country is worth a base of 10 points scaled by a rarity weight
 * derived from population: obscure, small-population countries are worth more
 * than common giants. The weight is a log-population curve, NORMALIZED so the
 * MEAN weight across all countries is ~1 — hence the mean answer is ~10 points.
 *
 * Completion bonus: naming every valid answer for a prompt adds
 * DAILY_COMPLETION_BONUS (50%) of that prompt's full weighted pool (requirements
 * §Scoring). Routes.ts reconciles this at /daily/finish, not per-answer.
 */

import { DAILY_COMPLETION_BONUS, DAILY_PROMPT_MAX, DAILY_NAME_BONUS } from "../protocol.js";
import { countryAttributes } from "../data/countryAttributes.js";
import { validIdsFor, type Prompt } from "../prompts.js";

/** Base points for one correct country before the rarity weight. */
export const BASE_POINTS = 10;

/**
 * Raw (un-normalized) rarity weight from population. Smaller populations score
 * higher. We use -log10(populationM) so a 0.01M micro-state (+2) sits well above
 * a 1000M giant (-3); the `+ OFFSET` keeps the raw weight positive before
 * normalization. Missing population data → treated as the OVERALL MEAN (weight
 * resolves to ~1 after normalization), so unknowns score an average answer.
 */
const OFFSET = 4;

/** Guard: clamp populationM to a sane floor so log is finite for tiny states. */
function rawWeight(populationM: number): number {
  const pop = Math.max(0.001, populationM);
  return OFFSET - Math.log10(pop);
}

/**
 * Mean raw weight across every country we have population data for. Dividing by
 * this normalizes the mean weight to 1 (so the mean answer ≈ BASE_POINTS).
 * Computed once at module load from the static attribute dataset.
 */
const MEAN_RAW_WEIGHT: number = (() => {
  const attrs = Object.values(countryAttributes);
  if (attrs.length === 0) return 1;
  let sum = 0;
  for (const a of attrs) sum += rawWeight(a.populationM);
  return sum / attrs.length;
})();

/**
 * The normalized rarity weight for a country (mean across all countries ≈ 1).
 * Unknown iso (no population data) → 1 (an average answer).
 */
export function rarityWeight(iso: string): number {
  const attrs = countryAttributes[iso];
  if (!attrs) return 1;
  return rawWeight(attrs.populationM) / MEAN_RAW_WEIGHT;
}

/**
 * Rarity-weighted points for one valid answer. Base 10 × normalized rarity
 * weight, so the mean answer ≈ 10, tiny states score more, giants less. Rounded
 * to an integer for clean display / summing.
 */
export function answerPoints(iso: string): number {
  return Math.round(BASE_POINTS * rarityWeight(iso));
}

/** How many valid answers this prompt has within "countries". */
export function promptTotal(prompt: Prompt): number {
  return validIdsFor(prompt, "countries").size;
}

/**
 * The full weighted pool for a prompt: the sum of answerPoints over EVERY valid
 * answer (within "countries"). This is the maximum answer points a player can
 * earn on the prompt (before the completion bonus).
 */
export function promptBasePoints(prompt: Prompt): number {
  let sum = 0;
  for (const iso of validIdsFor(prompt, "countries")) sum += answerPoints(iso);
  return sum;
}

/**
 * The completion bonus for a prompt: DAILY_COMPLETION_BONUS × the prompt's full
 * weighted pool — awarded only when a player named ALL valid answers. Rounded.
 */
export function completionBonus(prompt: Prompt): number {
  return Math.round(DAILY_COMPLETION_BONUS * promptBasePoints(prompt));
}

/**
 * The most a prompt can yield: the full answer pool PLUS the completion bonus.
 * (Legacy pool helper; run scoring uses the normalized model below.)
 */
export function promptFullPoints(prompt: Prompt): number {
  return promptBasePoints(prompt) + completionBonus(prompt);
}

/**
 * The maximum RUN score achievable on a day: for each prompt, the capture ceiling
 * (DAILY_PROMPT_MAX) plus the full per-name bonus (DAILY_NAME_BONUS × its answer
 * count). Journey distances are a fraction of this and it is the percentile
 * denominator, so difficulty stays fair as pool sizes vary day to day.
 */
export function dailyScoreMax(prompts: Prompt[]): number {
  let sum = 0;
  for (const p of prompts) sum += DAILY_PROMPT_MAX + DAILY_NAME_BONUS * promptTotal(p);
  return sum;
}
