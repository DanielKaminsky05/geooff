/**
 * Daily Trek — server-internal types.
 *
 * The public wire types live in `protocol.ts` (mirrored to web). These are the
 * server-only shapes the `daily` module passes around — chiefly the COMPILED
 * daily set, which keeps each prompt's `validIds` (never serialized to clients).
 *
 * The behaviour (window / scoring / percentile / routes) is implemented against
 * these signatures.
 */

import type {
  DailyDestination,
  DailyJourney,
  DailyRoute,
  DailySet,
} from "../protocol.js";
import type { Prompt } from "../prompts.js";

/**
 * The day's set as the server holds it: the five compiled `Prompt`s (each with
 * server-only `validIds`) plus the public journey/destination/route content.
 * `toPublicDailySet` strips the valid sets down to `{id,label}` for the wire.
 */
export interface CompiledDailySet {
  dailyDate: string;
  prompts: Prompt[];
  journeys: DailyJourney[];
  destination: DailyDestination;
  routes: DailyRoute[];
}

/** Strip a compiled set to the client-safe `DailySet` (labels only). */
export function toPublicDailySet(set: CompiledDailySet): DailySet {
  return {
    dailyDate: set.dailyDate,
    prompts: set.prompts.map((p) => ({ id: p.id, label: p.label })),
    journeys: set.journeys,
    destination: set.destination,
    routes: set.routes,
  };
}
