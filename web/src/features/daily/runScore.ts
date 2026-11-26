/**
 * Daily Trek — pure run helpers shared by the page orchestrator and its tests.
 *
 * Kept out of DailyDive.tsx so the component file exports only a component (fast
 * refresh stays happy) and these stay unit-testable without mounting the page.
 */

import { DAILY_PROMPT_MAX, DAILY_NAME_BONUS } from "./contract";
import type {
  DailySet,
  DailyJourney,
  DailyRoute,
  DailyPromptResult,
  JourneyId,
} from "./contract";

/**
 * One prompt's score, rounded to an integer — mirrors the server's per-prompt
 * reconcile (`routes.ts`: `Math.round(base + DAILY_NAME_BONUS * named)`). Round
 * HERE, per prompt, so every client total matches the server's `Σ round(...)`
 * exactly: summing the raw floats and rounding once (`round(Σ)`) drifts by a
 * point or two and makes the per-leg reveal not add up to the HUD total.
 */
export function promptScore(r: DailyPromptResult): number {
  const base = Math.max(0, Math.min(DAILY_PROMPT_MAX, r.points));
  const named = r.total > 0 ? Math.min(Math.max(0, r.named), r.total) : Math.max(0, r.named);
  return Math.round(base + DAILY_NAME_BONUS * named);
}

/**
 * The journey + route for an id. Falls back to the set's first journey/route if
 * the id isn't present. Normal play always passes a valid JourneyId from state;
 * the one untrusted caller is the recap, whose id can come from corrupt
 * localStorage (`getResult`) — degrade to a real journey rather than dereference
 * `undefined` and white-screen. A valid DailySet always has all three journeys.
 */
export function pick(set: DailySet, id: JourneyId): { journey: DailyJourney; route: DailyRoute } {
  const journey = set.journeys.find((j) => j.id === id) ?? set.journeys[0];
  const route = set.routes.find((r) => r.journeyId === journey?.id) ?? set.routes[0];
  return { journey, route };
}
