/**
 * Daily Trek — compile an authored payload into a CompiledDailySet (Phase 3).
 *
 * Turns the Trek Builder's ids-only `AuthoredDailySet` into the same compiled
 * shape the generator produces: prompts resolved (with their server-side valid
 * sets), journeys built with the day's distances (optionally with authored
 * temple gold), and routes from the chosen destination. Validates every
 * reference so a bad save is rejected before it touches the overlay/DB.
 *
 * Lives apart from `authoredSets.ts` (the overlay) so the overlay stays
 * import-light and `window.ts` can read it without a cycle.
 */

import { DAILY_PROMPT_COUNT } from "../protocol.js";
import type { JourneyId, DailyLandmark } from "../protocol.js";
import { promptById, validIdsFor, type Prompt } from "../prompts.js";
import { destinations } from "./destinations.js";
import { buildJourneys, JOURNEY_LANDMARKS } from "./window.js";
import type { AuthoredDailySet } from "./authoredSets.js";
import type { CompiledDailySet } from "./types.js";

const JOURNEY_IDS: JourneyId[] = ["short", "medium", "long"];

export type CompileResult =
  | { ok: true; set: CompiledDailySet }
  | { ok: false; error: string };

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Validate a per-journey landmark override: a non-empty, well-formed array. */
function validLandmarks(ls: unknown): ls is DailyLandmark[] {
  return (
    Array.isArray(ls) &&
    ls.length > 0 &&
    ls.every(
      (l) =>
        l != null &&
        typeof (l as DailyLandmark).atFraction === "number" &&
        (l as DailyLandmark).atFraction > 0 &&
        (l as DailyLandmark).atFraction <= 1 &&
        typeof (l as DailyLandmark).gold === "number" &&
        (l as DailyLandmark).gold >= 0,
    )
  );
}

/**
 * Compile an authored set, or return a human-readable error. Pure: no DB, no
 * overlay writes — the caller persists and places the result.
 */
export function compileAuthoredSet(authored: AuthoredDailySet): CompileResult {
  if (!authored || typeof authored !== "object") return { ok: false, error: "missing body" };

  const { dailyDate, destinationName, promptIds, landmarks } = authored;

  if (typeof dailyDate !== "string" || !validDate(dailyDate)) {
    return { ok: false, error: "dailyDate must be a valid YYYY-MM-DD date" };
  }

  if (!Array.isArray(promptIds) || promptIds.length !== DAILY_PROMPT_COUNT) {
    return { ok: false, error: `promptIds must have exactly ${DAILY_PROMPT_COUNT} entries` };
  }
  if (new Set(promptIds).size !== promptIds.length) {
    return { ok: false, error: "promptIds must be distinct" };
  }
  const prompts: Prompt[] = [];
  for (const id of promptIds) {
    const prompt = typeof id === "string" ? promptById(id) : undefined;
    if (!prompt) return { ok: false, error: `unknown prompt id: ${String(id)}` };
    prompts.push(prompt);
  }

  const entry = destinations.find((d) => d.destination.name === destinationName);
  if (!entry) return { ok: false, error: `unknown destination: ${String(destinationName)}` };

  // Validate any temple-gold overrides up front: keys must be real journeys and
  // each array must be well-formed.
  if (landmarks) {
    for (const key of Object.keys(landmarks)) {
      if (!JOURNEY_IDS.includes(key as JourneyId)) {
        return { ok: false, error: `unknown journey in landmarks: ${key}` };
      }
      if (!validLandmarks(landmarks[key as JourneyId])) {
        return { ok: false, error: `invalid landmarks for journey ${key}` };
      }
    }
  }

  // Build the journeys (distances from the day's prompts), applying any override
  // and falling back to the default layout where none is given.
  const journeys = buildJourneys(prompts).map((j) => ({
    ...j,
    landmarks: landmarks?.[j.id] ?? JOURNEY_LANDMARKS[j.id],
  }));

  // Memoize each prompt's valid set up front (matches the generator's behaviour).
  for (const p of prompts) validIdsFor(p, "countries");

  const set: CompiledDailySet = {
    dailyDate,
    prompts,
    journeys,
    destination: entry.destination,
    routes: entry.routes,
  };
  return { ok: true, set };
}
