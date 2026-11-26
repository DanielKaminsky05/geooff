import { describe, it, expect } from "vitest";
import { pick } from "./DailyDive";
import { FIXTURE_DAILY_SET } from "../features/daily/contract";
import type { JourneyId } from "../features/daily/contract";

describe("pick", () => {
  it("returns the matching journey and route for a valid id", () => {
    const { journey, route } = pick(FIXTURE_DAILY_SET, "medium");
    expect(journey.id).toBe("medium");
    expect(route.journeyId).toBe("medium");
  });

  it("falls back to the first journey/route instead of crashing on a corrupt id", () => {
    // Simulates a corrupt DailyRunResult.journey read from localStorage: the recap
    // path passes it straight into pick(). It must degrade, never dereference undefined.
    const bogus = "not-a-journey" as JourneyId;
    expect(() => pick(FIXTURE_DAILY_SET, bogus)).not.toThrow();
    const { journey, route } = pick(FIXTURE_DAILY_SET, bogus);
    expect(journey).toBe(FIXTURE_DAILY_SET.journeys[0]);
    // The route matches the fallen-back journey, so distance/landmarks stay coherent.
    expect(route.journeyId).toBe(journey.id);
  });
});
