/**
 * Daily Dive — deterministic per-date set generation (Track A).
 *
 * The day's set MUST be identical for every player and every server instance on
 * a given UTC date — so selection is seeded ENTIRELY by the "YYYY-MM-DD" string
 * via a small hash + seeded PRNG (mulberry32). We NEVER call Date.now() or
 * Math.random() for selection: multiple server instances and restarts must
 * reproduce the same set for the same date.
 *
 * The rolling 7-day window is just on-demand, memoized computation: each date's
 * set is pure w.r.t. its string, so we compute it when asked and cache it.
 */

import type { DailyJourney } from "../protocol.js";
import { DAILY_PROMPT_COUNT } from "../protocol.js";
import { buildPromptPool, validIdsFor, type Prompt } from "../prompts.js";
import { destinations } from "./destinations.js";
import type { CompiledDailySet } from "./types.js";

/* ---------------------------------------------------------------- */
/* Seeded PRNG                                                       */
/* ---------------------------------------------------------------- */

/** Hash a string into a 32-bit unsigned seed (xmur3 step). */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: a tiny, fast, well-distributed seeded PRNG. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n) from a PRNG stream. */
function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/* ---------------------------------------------------------------- */
/* Journey config (fixed game config; tunable)                      */
/* ---------------------------------------------------------------- */

/**
 * The three journeys — a risk/reward dial, NOT content difficulty. Distances and
 * landmark gold are game-design tunables (see requirements §Distance/journeys).
 * Gold is all-or-nothing on arrival (reach the end, bank every landmark's gold;
 * die and get nothing), so the landmarks are the checkpoints that light up along
 * the road. More landmarks on the longer roads: short 2, medium 5, long 7,
 * spaced evenly with the final (arrival) landmark as the biggest payoff. Totals
 * escalate with risk: short 50, medium 100, long 200.
 */
// Distances are in POINTS (1 point = 1 unit of distance). Tuned low enough that
// a single prompt moves you a visible chunk and arrival is achievable: a casual
// run clears the short road, a strong run reaches the far road. (First-pass
// numbers — the one open tuning knob.)
export const JOURNEYS: DailyJourney[] = [
  {
    id: "short",
    distance: 110,
    landmarks: [
      { atFraction: 0.5, gold: 20 },
      { atFraction: 1, gold: 30 },
    ],
  },
  {
    id: "medium",
    distance: 230,
    landmarks: [
      { atFraction: 0.2, gold: 12 },
      { atFraction: 0.4, gold: 15 },
      { atFraction: 0.6, gold: 18 },
      { atFraction: 0.8, gold: 20 },
      { atFraction: 1, gold: 35 },
    ],
  },
  {
    id: "long",
    distance: 400,
    landmarks: [
      { atFraction: 0.14, gold: 18 },
      { atFraction: 0.29, gold: 22 },
      { atFraction: 0.43, gold: 25 },
      { atFraction: 0.57, gold: 28 },
      { atFraction: 0.71, gold: 32 },
      { atFraction: 0.86, gold: 35 },
      { atFraction: 1, gold: 40 },
    ],
  },
];

/* ---------------------------------------------------------------- */
/* Set generation                                                   */
/* ---------------------------------------------------------------- */

/** Validate a "YYYY-MM-DD" date string. */
function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip through a UTC Date to reject e.g. 2026-02-30.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Pick `count` DISTINCT prompts (seeded) from the pool via a partial
 * Fisher-Yates shuffle, so no prompt repeats within a day. The pool is sorted by
 * id first so pool ORDER (which depends only on static data) is stable regardless
 * of insertion order, keeping selection reproducible across versions.
 */
function pickPrompts(rng: () => number, pool: Prompt[], count: number): Prompt[] {
  const arr = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const n = Math.min(count, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + randInt(rng, arr.length - i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, n);
}

/** Memo cache keyed by date string — deterministic, so caching is free. */
const cache = new Map<string, CompiledDailySet | null>();

/**
 * The compiled daily set for a UTC date string ("YYYY-MM-DD"), or null for a
 * malformed date. Deterministic and memoized: the same date always yields the
 * same set (same prompts, same destination), across instances and restarts.
 */
export function getDailySet(dailyDate: string): CompiledDailySet | null {
  if (cache.has(dailyDate)) return cache.get(dailyDate)!;
  if (!isValidDateString(dailyDate)) {
    cache.set(dailyDate, null);
    return null;
  }

  const rng = mulberry32(hashSeed(dailyDate));
  const pool = buildPromptPool("countries");
  const prompts = pickPrompts(rng, pool, DAILY_PROMPT_COUNT);
  // Touch each chosen prompt's "countries" valid set so it's memoized up front.
  for (const p of prompts) validIdsFor(p, "countries");

  const entry = destinations[randInt(rng, destinations.length)];

  const set: CompiledDailySet = {
    dailyDate,
    prompts,
    journeys: JOURNEYS,
    destination: entry.destination,
    routes: entry.routes,
  };
  cache.set(dailyDate, set);
  return set;
}

/** Today's UTC date string, "YYYY-MM-DD". The ONE place Date.now() is used — to
 *  pick WHICH day, never to pick the day's content. */
export function todayUtc(now: () => number = Date.now): string {
  return new Date(now()).toISOString().slice(0, 10);
}
