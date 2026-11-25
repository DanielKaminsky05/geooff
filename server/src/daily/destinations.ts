/**
 * Daily Dive — destination + route content (PHASE 0 STUB, owned by Track B).
 *
 * Each entry is one destination city plus its three authored routes
 * (short/medium/long polylines of real waypoints) to it. `window.ts` (Track A)
 * picks one entry per day (seeded by date) and pairs it with the journey config.
 *
 * Track B expands this to >= ~20 hand-authored entries so destinations don't
 * repeat within a rolling 7-day window. Keep the shape; just add entries.
 */

import type { DailyDestination, DailyRoute } from "../protocol.js";

/** One destination and the three routes that lead to it. */
export interface DestinationEntry {
  destination: DailyDestination;
  /** Exactly three routes, one per JourneyId, each ending at `destination.at`. */
  routes: DailyRoute[];
}

export const destinations: DestinationEntry[] = [
  {
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
  },
];
