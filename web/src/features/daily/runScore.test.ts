import { describe, it, expect } from "vitest";
import { promptScore, pick } from "./runScore";
import { DAILY_NAME_BONUS, DAILY_PROMPT_MAX, FIXTURE_DAILY_SET } from "./contract";
import type { DailyPromptResult, JourneyId } from "./contract";

/**
 * Mirror of the server's per-prompt reconcile (server/src/daily/routes.ts):
 * clamp base to [0, DAILY_PROMPT_MAX], clamp named to the pool, round ONCE per
 * prompt. The client's promptScore must agree with this term-for-term so the
 * local run total equals the authoritative /daily/finish total.
 */
function serverPerPrompt(r: DailyPromptResult): number {
  const base = Math.max(0, Math.min(DAILY_PROMPT_MAX, r.points));
  // Mirrors clampNamedBonus: an empty pool (total === 0) forces named to 0.
  const named = r.total > 0 ? Math.min(Math.max(0, r.named), r.total) : 0;
  return Math.round(base + DAILY_NAME_BONUS * named);
}

const mk = (points: number, named = 0, total = 10): DailyPromptResult => ({
  promptId: "p",
  points,
  named,
  total,
  namedIsos: [],
});

describe("promptScore", () => {
  it("returns an integer even for a fractional capture base", () => {
    expect(promptScore(mk(95.4))).toBe(95);
    expect(Number.isInteger(promptScore(mk(142.6, 1)))).toBe(true);
  });

  it("matches the server's per-prompt rounding term-for-term", () => {
    const rows = [mk(95.4), mk(0.5), mk(142.6, 2, 5), mk(73.49, 3)];
    for (const r of rows) expect(promptScore(r)).toBe(serverPerPrompt(r));
  });

  it("sums to the server total (Σ round, not round Σ)", () => {
    // round(95.4)+round(95.4) = 190, NOT round(95.4+95.4) = round(190.8) = 191.
    const rows = [mk(95.4), mk(95.4)];
    const clientTotal = rows.reduce((s, r) => s + promptScore(r), 0);
    const serverTotal = rows.reduce((s, r) => s + serverPerPrompt(r), 0);
    expect(clientTotal).toBe(serverTotal);
    expect(clientTotal).toBe(190);
  });

  it("clamps base to the prompt ceiling and named to the pool", () => {
    expect(promptScore(mk(999))).toBe(DAILY_PROMPT_MAX);
    expect(promptScore(mk(0, 50, 3))).toBe(DAILY_NAME_BONUS * 3); // named clamped to total
    expect(promptScore(mk(-5, -5, 10))).toBe(0);
  });

  it("grants no name bonus for a zero-pool prompt (matches clampNamedBonus)", () => {
    // Empty pool (total === 0, only reachable via corruption): named must be 0,
    // not trusted from the stored result, so the client agrees with the server.
    expect(promptScore(mk(40, 5, 0))).toBe(40);
    expect(promptScore(mk(40, 5, 0))).toBe(serverPerPrompt(mk(40, 5, 0)));
  });
});

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
