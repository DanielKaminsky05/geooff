/**
 * Pure, testable answer-matching / scoring logic for the "countries" category.
 *
 * The lookup maps normalizeAnswer(name) and each normalizeAnswer(alias) → iso.
 * Matching is O(1) (Map.get), per the anti-cheat / low-CPU design.
 */

import { normalizeAnswer } from "./protocol.js";
import { countries, type Country } from "./data/countries.js";

export interface MatchResult {
  /** true when the input resolved to a country in the list. */
  found: boolean;
  /** ISO 3166-1 alpha-2, lowercase (present when found). */
  iso?: string;
  /** Canonical display name (present when found). */
  canonical?: string;
}

/** Build the normalized-lookup Map from a country list. */
export function buildLookup(list: Country[] = countries): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of list) {
    map.set(normalizeAnswer(c.name), c.iso);
    for (const alias of c.aliases) {
      map.set(normalizeAnswer(alias), c.iso);
    }
  }
  return map;
}

/** Map of iso → canonical name, for echoing the accepted display name back. */
export function buildCanonicalNames(list: Country[] = countries): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of list) map.set(c.iso, c.name);
  return map;
}

/**
 * Resolve a raw guess to a country. Pure: no scoring side effects here.
 */
export function matchAnswer(
  raw: string,
  lookup: Map<string, string>,
  canonicalNames: Map<string, string>,
): MatchResult {
  const key = normalizeAnswer(raw);
  if (!key) return { found: false };
  const iso = lookup.get(key);
  if (!iso) return { found: false };
  return { found: true, iso, canonical: canonicalNames.get(iso) ?? iso };
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
