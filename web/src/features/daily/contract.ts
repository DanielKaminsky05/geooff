/**
 * Daily Dive — client contract (PHASE 0).
 *
 * Re-exports the daily wire types and ships a static `FIXTURE_DAILY_SET` so the
 * client tracks (play flow, map/travel, recap) develop against real-shaped data
 * with ZERO dependency on the server. Phase 2 swaps the live API in; the fixture
 * stays as a test/storybook aid.
 */

import type { DailySet } from "../../lib/protocol";

export type {
  DailySet,
  DailyPrompt,
  DailyJourney,
  DailyLandmark,
  DailyRoute,
  DailyDestination,
  GeoPoint,
  JourneyId,
  DailyOutcome,
  DailyAnswerReq,
  DailyAnswerRes,
  DailyPromptResult,
  DailyRunResult,
  DailyFinishReq,
  DailyFinishRes,
} from "../../lib/protocol";

export {
  DAILY_PROMPT_COUNT,
  DAILY_BASE_SECONDS,
  DAILY_TIME_BONUS_SECONDS,
  DAILY_COMPLETION_BONUS,
} from "../../lib/protocol";

/** One hand-authored day, shape-identical to what `GET /daily` returns. */
export const FIXTURE_DAILY_SET: DailySet = {
  dailyDate: "2026-11-25",
  prompts: [
    { id: "starts-with-b", label: "Name a country starting with B" },
    { id: "island", label: "Name an island nation" },
    { id: "borders-country-de", label: "Name a country that borders Germany" },
    { id: "flag-star", label: "Name a country whose flag has a star" },
    { id: "name-ends-stan", label: "Name a country whose name ends in “-stan”" },
  ],
  journeys: [
    { id: "short", distance: 300, landmarks: [{ atFraction: 1, gold: 40 }] },
    {
      id: "medium",
      distance: 600,
      landmarks: [
        { atFraction: 0.5, gold: 25 },
        { atFraction: 1, gold: 60 },
      ],
    },
    {
      id: "long",
      distance: 1000,
      landmarks: [
        { atFraction: 0.33, gold: 30 },
        { atFraction: 0.66, gold: 45 },
        { atFraction: 1, gold: 100 },
      ],
    },
  ],
  destination: { name: "Istanbul", at: { lat: 41.01, lon: 28.98 } },
  routes: [
    {
      journeyId: "short",
      points: [
        { lat: 38.72, lon: -9.14 },
        { lat: 41.01, lon: 28.98 },
      ],
    },
    {
      journeyId: "medium",
      points: [
        { lat: 38.72, lon: -9.14 },
        { lat: 41.9, lon: 12.5 },
        { lat: 41.01, lon: 28.98 },
      ],
    },
    {
      journeyId: "long",
      points: [
        { lat: 38.72, lon: -9.14 },
        { lat: 48.85, lon: 2.35 },
        { lat: 52.52, lon: 13.4 },
        { lat: 41.01, lon: 28.98 },
      ],
    },
  ],
};
