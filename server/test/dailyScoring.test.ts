/**
 * Additional unit tests for Daily Trek scoring behaviors that are NOT covered
 * by daily.test.ts. Focused on:
 *   1. dailyScoreMax vs distanceScoreMax relationship
 *   2. buildJourneys uses distanceScoreMax (not dailyScoreMax) for distances
 *   3. Gold landmark boundary: exact atFraction hit counted via epsilon guard
 *   4. namedIsos lowercasing and type filtering in reconcileFinish
 */

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

import { getDailySet } from "../src/daily/window.js";
import {
  dailyScoreMax,
  distanceScoreMax,
  promptTotal,
} from "../src/daily/scoring.js";
import { buildJourneys, DAILY_JOURNEY_FRACTIONS } from "../src/daily/window.js";
import { registerDailyRoutes } from "../src/daily/routes.js";
import { validIdsFor } from "../src/prompts.js";
import {
  DAILY_NAME_BONUS,
  DAILY_DISTANCE_NAME_BONUS,
  DAILY_PROMPT_MAX,
} from "../src/protocol.js";
import type { DailyFinishRes, DailyRunResult } from "../src/protocol.js";

/** A fresh Express app with the daily routes mounted, pinned to DATE. */
function makeApp(opts: Parameters<typeof registerDailyRoutes>[1] = {}) {
  const app = express();
  app.use(express.json());
  registerDailyRoutes(app, opts);
  return app;
}

const DATE = "2026-01-15";

// ---------------------------------------------------------------------------
// 1. dailyScoreMax vs distanceScoreMax
// ---------------------------------------------------------------------------

describe("dailyScoreMax vs distanceScoreMax — two-max design", () => {
  it("distanceScoreMax is strictly less than dailyScoreMax for a real day's prompts", () => {
    const set = getDailySet(DATE)!;
    expect(set).not.toBeNull();
    const dMax = dailyScoreMax(set.prompts);
    const distMax = distanceScoreMax(set.prompts);
    expect(distMax).toBeLessThan(dMax);
  });

  it("the gap equals (DAILY_NAME_BONUS - DAILY_DISTANCE_NAME_BONUS) × total answer count", () => {
    const set = getDailySet(DATE)!;
    const dMax = dailyScoreMax(set.prompts);
    const distMax = distanceScoreMax(set.prompts);
    const totalAnswers = set.prompts.reduce((sum, p) => sum + promptTotal(p), 0);
    const expectedGap = (DAILY_NAME_BONUS - DAILY_DISTANCE_NAME_BONUS) * totalAnswers;
    expect(dMax - distMax).toBe(expectedGap);
  });

  it("per-prompt contribution: DAILY_PROMPT_MAX + DAILY_NAME_BONUS×N vs DAILY_PROMPT_MAX + DAILY_DISTANCE_NAME_BONUS×N", () => {
    const set = getDailySet(DATE)!;
    // Recompute both maxes manually from first principles and verify they match.
    let manualDailyMax = 0;
    let manualDistMax = 0;
    for (const p of set.prompts) {
      const n = promptTotal(p);
      manualDailyMax += DAILY_PROMPT_MAX + DAILY_NAME_BONUS * n;
      manualDistMax += DAILY_PROMPT_MAX + DAILY_DISTANCE_NAME_BONUS * n;
    }
    expect(dailyScoreMax(set.prompts)).toBe(manualDailyMax);
    expect(distanceScoreMax(set.prompts)).toBe(manualDistMax);
  });

  it("constants differ as designed: DAILY_NAME_BONUS > DAILY_DISTANCE_NAME_BONUS", () => {
    // Sanity check: the protocol constants haven't been accidentally equalized.
    expect(DAILY_NAME_BONUS).toBeGreaterThan(DAILY_DISTANCE_NAME_BONUS);
    // The design intent is +10 for players, +5 for distances.
    expect(DAILY_NAME_BONUS).toBe(10);
    expect(DAILY_DISTANCE_NAME_BONUS).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. buildJourneys resolves distances from distanceScoreMax, not dailyScoreMax
// ---------------------------------------------------------------------------

describe("buildJourneys — distances use distanceScoreMax", () => {
  it("each journey distance equals round(DAILY_JOURNEY_FRACTIONS[id] * distanceScoreMax)", () => {
    const set = getDailySet(DATE)!;
    const distMax = distanceScoreMax(set.prompts);
    const journeys = buildJourneys(set.prompts);

    for (const j of journeys) {
      const expectedDistance = Math.round(DAILY_JOURNEY_FRACTIONS[j.id] * distMax);
      expect(j.distance).toBe(expectedDistance);
    }
  });

  it("distances do NOT equal round(DAILY_JOURNEY_FRACTIONS[id] * dailyScoreMax) for a real day", () => {
    // This confirms the distinction is real: distances are smaller than they
    // would be if we used the full dailyScoreMax.
    const set = getDailySet(DATE)!;
    const dMax = dailyScoreMax(set.prompts);
    const journeys = buildJourneys(set.prompts);

    // At least one journey's distance should differ from the dailyScoreMax formula.
    const anyDiffers = journeys.some(
      (j) => j.distance !== Math.round(DAILY_JOURNEY_FRACTIONS[j.id] * dMax),
    );
    expect(anyDiffers).toBe(true);
  });

  it("getDailySet journeys match buildJourneys output exactly", () => {
    const set = getDailySet(DATE)!;
    const rebuilt = buildJourneys(set.prompts);
    for (let i = 0; i < set.journeys.length; i++) {
      expect(set.journeys[i].id).toBe(rebuilt[i].id);
      expect(set.journeys[i].distance).toBe(rebuilt[i].distance);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Gold landmark boundary: exact atFraction hit is counted (epsilon guard)
// ---------------------------------------------------------------------------

describe("gold landmark boundary — epsilon guard in reconcileFinish", () => {
  /**
   * Short journey landmarks: { atFraction: 0.5, gold: 20 }, { atFraction: 1, gold: 30 }
   * We want to test that a run whose progress == exactly 0.5 counts the first
   * landmark (goldLost >= 20) even though the run died (points < distance).
   *
   * Strategy: set points so that points / distance == exactly 0.5. We need
   * distance to be even so that points = distance / 2 is an integer. The short
   * journey distance is computed from distanceScoreMax — we read it directly.
   */
  it("a run with progress == landmark.atFraction exactly counts that landmark (epsilon hit)", async () => {
    const set = getDailySet(DATE)!;
    const shortJourney = set.journeys.find((j) => j.id === "short")!;
    const distance = shortJourney.distance;

    // We need exactly distance/2 points so progress = 0.5 (the first landmark).
    // If distance is odd, floor(distance/2) gives progress < 0.5 — we'd miss.
    // Use ceiling so progress >= 0.5, ensuring the epsilon hits.
    const targetPoints = Math.ceil(distance / 2);

    // Build perPrompt to reach exactly targetPoints total (and die: points < distance).
    // Distribute across prompts using base only (named = 0 for simplicity).
    let remaining = targetPoints;
    const perPrompt = set.prompts.map((p) => {
      const pts = Math.min(DAILY_PROMPT_MAX, remaining);
      remaining = Math.max(0, remaining - pts);
      return { promptId: p.id, named: 0, total: 0, points: pts };
    });

    const result: DailyRunResult = {
      runId: "boundary-test",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt,
      gold: 0,
      outcome: "died",
      playerId: null,
    };

    const app = makeApp({ today: () => DATE });
    const res = await request(app).post("/daily/finish").send({ result });
    const body = res.body as DailyFinishRes;

    // The run must have died (points < distance).
    expect(body.result.outcome).toBe("died");
    expect(body.result.points).toBeLessThan(distance);
    // Progress >= 0.5 means the first short landmark (atFraction 0.5) is counted.
    // goldLost must include at least the first landmark's gold (20).
    expect(body.goldLost).toBeGreaterThanOrEqual(20);
  });

  it("a run with progress just below landmark.atFraction does NOT count that landmark", async () => {
    const set = getDailySet(DATE)!;
    const shortJourney = set.journeys.find((j) => j.id === "short")!;
    const distance = shortJourney.distance;

    // Set points to distance/2 - 2 so progress is strictly below 0.5 - 1e-9.
    // Using -2 so the gap comfortably exceeds the epsilon.
    const targetPoints = Math.max(0, Math.floor(distance / 2) - 2);
    let remaining = targetPoints;
    const perPrompt = set.prompts.map((p) => {
      const pts = Math.min(DAILY_PROMPT_MAX, remaining);
      remaining = Math.max(0, remaining - pts);
      return { promptId: p.id, named: 0, total: 0, points: pts };
    });

    const result: DailyRunResult = {
      runId: "below-boundary-test",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt,
      gold: 0,
      outcome: "died",
      playerId: null,
    };

    const app = makeApp({ today: () => DATE });
    const res = await request(app).post("/daily/finish").send({ result });
    const body = res.body as DailyFinishRes;

    expect(body.result.outcome).toBe("died");
    // No landmark reached: goldLost must be 0.
    expect(body.goldLost).toBe(0);
  });

  it("an arrived run at exactly the journey distance banks ALL gold (not just reachedGold)", async () => {
    const set = getDailySet(DATE)!;
    const shortJourney = set.journeys.find((j) => j.id === "short")!;
    const distance = shortJourney.distance;
    const totalGold = shortJourney.landmarks.reduce((s, l) => s + l.gold, 0); // 20 + 30 = 50

    // Build a run with exactly `distance` points using base only.
    let remaining = distance;
    const perPrompt = set.prompts.map((p) => {
      const pts = Math.min(DAILY_PROMPT_MAX, remaining);
      remaining = Math.max(0, remaining - pts);
      return { promptId: p.id, named: 0, total: 0, points: pts };
    });

    const result: DailyRunResult = {
      runId: "exact-arrival",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt,
      gold: 0,
      outcome: "died",
      playerId: null,
    };

    const app = makeApp({ today: () => DATE });
    const res = await request(app).post("/daily/finish").send({ result });
    const body = res.body as DailyFinishRes;

    expect(body.result.outcome).toBe("arrived");
    expect(body.result.gold).toBe(totalGold);
    expect(body.goldLost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. namedIsos lowercasing and string filtering in reconcileFinish
// ---------------------------------------------------------------------------

describe("namedIsos lowercasing and type filtering", () => {
  it("lowercases mixed-case isos in the returned perPrompt", async () => {
    const set = getDailySet(DATE)!;
    const prompt = set.prompts[0];
    const perPrompt = set.prompts.map((p, i) =>
      i === 0
        ? {
            promptId: p.id,
            named: 0,
            total: 0,
            points: 0,
            namedIsos: ["GB", "FR", "Us"],
          }
        : { promptId: p.id, named: 0, total: 0, points: 0, namedIsos: [] },
    );

    const result: DailyRunResult = {
      runId: "lowercase-test",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt,
      gold: 0,
      outcome: "died",
      playerId: null,
    };

    const app = makeApp({ today: () => DATE });
    const res = await request(app).post("/daily/finish").send({ result });
    const body = res.body as DailyFinishRes;

    const pp0 = body.result.perPrompt.find((pp) => pp.promptId === prompt.id)!;
    expect(pp0.namedIsos).toEqual(["gb", "fr", "us"]);
  });

  it("filters out non-string entries from namedIsos", async () => {
    const set = getDailySet(DATE)!;
    const prompt = set.prompts[0];
    const perPrompt = set.prompts.map((p, i) =>
      i === 0
        ? {
            promptId: p.id,
            named: 0,
            total: 0,
            points: 0,
            // Mix of valid strings, number, null, boolean, object.
            namedIsos: ["DE", 42, null, true, { iso: "fr" }, "AU"],
          }
        : { promptId: p.id, named: 0, total: 0, points: 0, namedIsos: [] },
    );

    const result: DailyRunResult = {
      runId: "typefilter-test",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt,
      gold: 0,
      outcome: "died",
      playerId: null,
    };

    const app = makeApp({ today: () => DATE });
    const res = await request(app).post("/daily/finish").send({ result });
    const body = res.body as DailyFinishRes;

    const pp0 = body.result.perPrompt.find((pp) => pp.promptId === prompt.id)!;
    // Only the actual strings remain, lowercased; non-strings are dropped.
    expect(pp0.namedIsos).toEqual(["de", "au"]);
  });

  it("produces an empty namedIsos array when namedIsos is absent from the payload", async () => {
    const set = getDailySet(DATE)!;
    const prompt = set.prompts[0];
    // No namedIsos field at all.
    const perPrompt = set.prompts.map((p) => ({
      promptId: p.id,
      named: 0,
      total: 0,
      points: 0,
    }));

    const result: DailyRunResult = {
      runId: "noisos-test",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt,
      gold: 0,
      outcome: "died",
      playerId: null,
    };

    const app = makeApp({ today: () => DATE });
    const res = await request(app).post("/daily/finish").send({ result });
    const body = res.body as DailyFinishRes;

    const pp0 = body.result.perPrompt.find((pp) => pp.promptId === prompt.id)!;
    expect(pp0.namedIsos).toEqual([]);
  });
});
