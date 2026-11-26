/**
 * Daily Trek — compile an authored payload into a CompiledDailySet (Phase 3).
 *
 * Turns the Trek Builder's payload (catalog prompt ids + drawn destination and
 * routes) into the same compiled shape the generator produces: prompts resolved
 * (with their server-side valid sets), journeys built with the day's distances
 * (optionally with authored temple gold), and the drawn destination + routes.
 * Validates every reference/shape so a bad save is rejected before it touches
 * the overlay/DB.
 */

import { DAILY_PROMPT_COUNT } from "../protocol.js";
import type { JourneyId, DailyLandmark, GeoPoint, DailyRoute } from "../protocol.js";
import { promptById, validIdsFor, type Prompt } from "../prompts.js";
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

function validPoint(p: unknown): p is GeoPoint {
  return (
    p != null &&
    typeof (p as GeoPoint).lat === "number" &&
    typeof (p as GeoPoint).lon === "number" &&
    (p as GeoPoint).lat >= -90 &&
    (p as GeoPoint).lat <= 90 &&
    (p as GeoPoint).lon >= -180 &&
    (p as GeoPoint).lon <= 180
  );
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

  const { dailyDate, destination, routes, promptIds, landmarks } = authored;

  if (typeof dailyDate !== "string" || !validDate(dailyDate)) {
    return { ok: false, error: "dailyDate must be a valid YYYY-MM-DD date" };
  }

  // Prompts.
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

  // Destination (drawn).
  if (
    !destination ||
    typeof destination.name !== "string" ||
    !destination.name.trim() ||
    !validPoint(destination.at)
  ) {
    return { ok: false, error: "destination needs a name and a valid point" };
  }

  // Routes (drawn): exactly one per journey, each a polyline of >= 2 valid points.
  if (!Array.isArray(routes) || routes.length !== JOURNEY_IDS.length) {
    return { ok: false, error: `routes must have exactly ${JOURNEY_IDS.length} entries (short, medium, long)` };
  }
  const seen = new Set<string>();
  const byJourney = new Map<JourneyId, DailyRoute>();
  for (const r of routes) {
    if (!r || !JOURNEY_IDS.includes(r.journeyId)) {
      return { ok: false, error: `route has an invalid journeyId: ${String(r?.journeyId)}` };
    }
    if (seen.has(r.journeyId)) return { ok: false, error: `duplicate route for ${r.journeyId}` };
    seen.add(r.journeyId);
    if (!Array.isArray(r.points) || r.points.length < 2 || !r.points.every(validPoint)) {
      return { ok: false, error: `route ${r.journeyId} needs at least 2 valid points` };
    }
    byJourney.set(r.journeyId, { journeyId: r.journeyId, points: r.points });
  }

  // Temple-gold overrides (optional).
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

  // Journeys: distances from the day's prompts; gold from override or defaults.
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
    destination: { name: destination.name.trim(), at: destination.at },
    routes: JOURNEY_IDS.map((id) => byJourney.get(id)!),
  };
  return { ok: true, set };
}
