/**
 * Daily Trek — authored-set overlay (Phase 3).
 *
 * Hand-authored days (from the Trek Builder) live here in-memory, keyed by date.
 * `getDailySet` checks this overlay FIRST, so a curated day overrides the
 * procedural generator while the hot read paths stay synchronous. The overlay is
 * hydrated from `daily_sets` at boot and updated whenever the admin route saves.
 *
 * This module deliberately imports only TYPES — it holds no catalog logic — so
 * `window.ts` can read the overlay without an import cycle. Compilation of an
 * authored payload into a `CompiledDailySet` lives in `authoredBuild.ts`.
 */

import type { JourneyId, DailyLandmark, GeoPoint, DailyRoute } from "../protocol.js";
import type { CompiledDailySet } from "./types.js";

/** An authored day as stored/sent. Prompts are catalog ids (re-resolved
 *  server-side for their valid answers); the destination and the three routes
 *  are drawn geometry (lat/lon) from the map builder. */
export interface AuthoredDailySet {
  dailyDate: string;
  /** Drawn destination: a label + its geographic point. */
  destination: { name: string; at: GeoPoint };
  /** The three drawn routes (one per journey), ordered waypoints to the destination. */
  routes: DailyRoute[];
  /** Exactly DAILY_PROMPT_COUNT prompt ids from the catalog. */
  promptIds: string[];
  /** Optional per-journey temple-gold overrides; omit a journey to use defaults. */
  landmarks?: Partial<Record<JourneyId, DailyLandmark[]>>;
}

/** date -> compiled authored set. Curated days override the generator. */
const overlay = new Map<string, CompiledDailySet>();

/** The authored set for a date, or undefined if none is curated. */
export function getAuthoredSet(dailyDate: string): CompiledDailySet | undefined {
  return overlay.get(dailyDate);
}

/** Place/replace a compiled authored set in the overlay. */
export function setAuthoredSet(dailyDate: string, set: CompiledDailySet): void {
  overlay.set(dailyDate, set);
}

/** Remove an authored set from the overlay so `getDailySet` falls back to the
 *  generator for that date. Returns true if a set was actually present. */
export function unsetAuthoredSet(dailyDate: string): boolean {
  return overlay.delete(dailyDate);
}

/** The dates that currently have an authored set (for diagnostics/tests). */
export function authoredDates(): string[] {
  return [...overlay.keys()];
}

/** Drop all authored sets — tests only. */
export function clearAuthoredSets(): void {
  overlay.clear();
}
