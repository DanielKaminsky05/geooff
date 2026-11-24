/**
 * Pure, testable answer-matching / scoring logic for the "countries" category.
 *
 * The lookup maps normalizeAnswer(name) and each normalizeAnswer(alias) → iso.
 * Matching is O(1) (Map.get), per the anti-cheat / low-CPU design.
 */

import { normalizeAnswer } from "./protocol.js";
import { countries } from "./data/countries.js";

/**
 * One answerable entry in a set (country, state…) with a canonical name +
 * aliases. `id` doubles as the map key. Structurally compatible with Country
 * (whose `iso` becomes `id` in the set registry).
 */
export interface AnswerItem {
  id: string;
  name: string;
  aliases: string[];
}

export interface MatchResult {
  /** true when the input resolved to a country in the list. */
  found: boolean;
  /** ISO 3166-1 alpha-2, lowercase (present when found). */
  iso?: string;
  /** Canonical display name (present when found). */
  canonical?: string;
}

/** Countries as AnswerItems (iso → id), the default set for the helpers below. */
const countryItems: AnswerItem[] = countries.map((c) => ({
  id: c.iso,
  name: c.name,
  aliases: c.aliases,
}));

/** Build the normalized-lookup Map from a list of answer items. */
export function buildLookup(list: AnswerItem[] = countryItems): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of list) {
    map.set(normalizeAnswer(c.name), c.id);
    for (const alias of c.aliases) {
      map.set(normalizeAnswer(alias), c.id);
    }
  }
  return map;
}

/** Map of id → canonical name, for echoing the accepted display name back. */
export function buildCanonicalNames(list: AnswerItem[] = countryItems): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of list) map.set(c.id, c.name);
  return map;
}

/**
 * Edit-distance budget for a fuzzy (typo-tolerant) match, by the length of the
 * NORMALIZED input. Short inputs get NO slack — many real countries sit one edit
 * apart (Iran/Iraq, Chad/Chile), so fuzzing them would resolve typos to the
 * wrong nation. Longer names tolerate more:
 *   ≤ 4 letters → 0 (exact only)   5–7 → 1 edit   ≥ 8 → 2 edits
 * Banding on the INPUT length also keeps a short input from ever reaching a long
 * candidate, since edit distance already bounds the length gap by the budget.
 */
export function fuzzyThreshold(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

/**
 * Damerau-Levenshtein distance (insertions, deletions, substitutions, AND
 * adjacent transpositions) between `a` and `b`, capped at `max`: once every cell
 * in a row exceeds `max` the rest can only grow, so we bail early and return
 * `max + 1`. Transpositions are counted as one edit so a swap like
 * "indoneisa" → "indonesia" is distance 1, not 2.
 */
export function damerauLevenshtein(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  // prev2/prev1/cur are the three rows the transposition rule needs.
  let prev2: number[] = [];
  let prev1: number[] = new Array(lb + 1);
  let cur: number[] = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev1[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev1[j] + 1, // deletion
        cur[j - 1] + 1, // insertion
        prev1[j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1); // transposition
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev1;
    prev1 = cur;
    cur = new Array(lb + 1);
  }
  return prev1[lb];
}

/**
 * Fuzzy fallback: the single country within the input's edit-distance budget.
 * Returns not-found unless exactly ONE country qualifies — when two sit equally
 * close (e.g. a typo halfway between Slovakia and Slovenia) we reject rather than
 * guess. Distance is measured per COUNTRY (its nearest name/alias), so two
 * aliases of the same nation don't read as ambiguous.
 */
function fuzzyMatch(
  key: string,
  lookup: Map<string, string>,
  canonicalNames: Map<string, string>,
): MatchResult {
  const budget = fuzzyThreshold(key.length);
  if (budget === 0) return { found: false };
  let best = budget + 1;
  const bestIsos = new Set<string>();
  for (const [candidate, iso] of lookup) {
    if (Math.abs(candidate.length - key.length) > budget) continue;
    const d = damerauLevenshtein(key, candidate, budget);
    if (d > best) continue;
    if (d < best) {
      best = d;
      bestIsos.clear();
      bestIsos.add(iso);
    } else {
      bestIsos.add(iso);
    }
  }
  if (bestIsos.size !== 1) return { found: false };
  const iso = [...bestIsos][0];
  return { found: true, iso, canonical: canonicalNames.get(iso) ?? iso };
}

/**
 * Resolve a raw guess to a country. Pure: no scoring side effects here. Tries an
 * exact normalized hit first (so curated names/aliases always win), then falls
 * back to a conservative typo-tolerant match (see fuzzyMatch).
 */
export function matchAnswer(
  raw: string,
  lookup: Map<string, string>,
  canonicalNames: Map<string, string>,
): MatchResult {
  const key = normalizeAnswer(raw);
  if (!key) return { found: false };
  const iso = lookup.get(key);
  if (iso) return { found: true, iso, canonical: canonicalNames.get(iso) ?? iso };
  return fuzzyMatch(key, lookup, canonicalNames);
}

export type ScoreOutcome =
  | { kind: "accepted"; iso: string; canonical: string }
  | { kind: "duplicate" }
  | { kind: "wrong" }
  | { kind: "empty" };

/**
 * Apply a guess against a player's already-filled set. Pure given the set
 * (which it mutates only on acceptance). Returns what happened so the caller
 * can emit the right events and bump the score.
 */
export function scoreGuess(
  raw: string,
  filled: Set<string>,
  lookup: Map<string, string>,
  canonicalNames: Map<string, string>,
): ScoreOutcome {
  if (!normalizeAnswer(raw)) return { kind: "empty" };
  const match = matchAnswer(raw, lookup, canonicalNames);
  if (!match.found || !match.iso) return { kind: "wrong" };
  if (filled.has(match.iso)) return { kind: "duplicate" };
  filled.add(match.iso);
  return { kind: "accepted", iso: match.iso, canonical: match.canonical ?? match.iso };
}

/** total answers in the active category. */
export const total = countries.length;

/** All iso codes (for computing "missed" sets at game end). */
export const allIsoCodes: string[] = countries.map((c) => c.iso);

/**
 * Winner by score. Returns the winning playerId, or null on a tie.
 */
export function determineWinner(
  scores: { playerId: string; score: number }[],
): string | null {
  if (scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  if (sorted.length === 1) return sorted[0].playerId;
  if (sorted[0].score === sorted[1].score) return null;
  return sorted[0].playerId;
}
