/**
 * Phase 2 integration: POST /daily/finish with a RunsRepo injected (the
 * in-memory fake — no Supabase credentials). Verifies the run is persisted,
 * resubmits are no-ops, the percentile reflects the real distribution past
 * MIN_FIELD (synthetic below it), and a failing repo degrades gracefully.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

import { registerDailyRoutes } from "../src/daily/routes.js";
import { getDailySet } from "../src/daily/window.js";
import { dailyScoreMax } from "../src/daily/scoring.js";
import { capturePercentile } from "../src/daily/percentile.js";
import { MIN_FIELD } from "../src/daily/percentileSelect.js";
import { validIdsFor } from "../src/prompts.js";
import { DAILY_PROMPT_MAX } from "../src/protocol.js";
import type { DailyFinishRes, DailyRunResult } from "../src/protocol.js";
import { makeFakeRunsRepo, type FakeRunsRepo } from "./fakeRunsRepo.js";
import type { RunRecord } from "../src/daily/runsRepo.js";

const DATE = "2026-01-15";
const set = getDailySet(DATE)!;

function makeApp(opts: Parameters<typeof registerDailyRoutes>[1] = {}) {
  const app = express();
  app.use(express.json());
  registerDailyRoutes(app, { today: () => DATE, ...opts });
  return app;
}

/** A full-clear run (max points) for a given device. */
function fullClear(playerId: string): DailyRunResult {
  const perPrompt = set.prompts.map((p) => {
    const total = validIdsFor(p, "countries").size;
    return { promptId: p.id, named: total, total, points: DAILY_PROMPT_MAX };
  });
  return {
    runId: `run-${playerId}`,
    dailyDate: DATE,
    journey: "long",
    points: 0, // recomputed server-side
    perPrompt,
    gold: 0,
    outcome: "died",
    playerId,
  };
}

function seedRun(over: Partial<RunRecord>): RunRecord {
  return {
    localId: "seed",
    dailyDate: DATE,
    journey: "short",
    points: 0,
    outcome: "died",
    gold: 0,
    perPrompt: [],
    ...over,
  };
}

async function seed(repo: FakeRunsRepo, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await repo.recordRun(seedRun({ localId: `seed-${i}`, points: 0 }));
  }
}

describe("POST /daily/finish — Phase 2 persistence", () => {
  it("inserts exactly one row for a finished run", async () => {
    const repo = makeFakeRunsRepo();
    const app = makeApp({ runsRepo: repo });
    await request(app).post("/daily/finish").send({ result: fullClear("device-a") });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].localId).toBe("device-a");
    // The persisted points are the authoritative (recomputed) total, not 0.
    expect(repo.rows[0].points).toBe(dailyScoreMax(set.prompts));
  });

  it("treats a resubmit from the same device as a no-op", async () => {
    const repo = makeFakeRunsRepo();
    const app = makeApp({ runsRepo: repo });
    await request(app).post("/daily/finish").send({ result: fullClear("device-a") });
    await request(app).post("/daily/finish").send({ result: fullClear("device-a") });
    expect(repo.rows).toHaveLength(1);
  });

  it("does not persist a run with no playerId (keeps the synthetic percentile)", async () => {
    const repo = makeFakeRunsRepo();
    const app = makeApp({ runsRepo: repo });
    const res = await request(app)
      .post("/daily/finish")
      .send({ result: { ...fullClear("x"), playerId: null } });
    expect(repo.rows).toHaveLength(0);
    const body = res.body as DailyFinishRes;
    expect(body.percentile).toBe(capturePercentile(body.result.points / dailyScoreMax(set.prompts)));
  });

  it("returns a REAL percentile once the field reaches MIN_FIELD", async () => {
    const repo = makeFakeRunsRepo();
    await seed(repo, MIN_FIELD); // MIN_FIELD zero-point runs already on the day
    const app = makeApp({ runsRepo: repo });
    const res = await request(app).post("/daily/finish").send({ result: fullClear("hero") });
    const body = res.body as DailyFinishRes;
    // Field is now MIN_FIELD + 1; the hero beats all MIN_FIELD zero-point runs.
    const expected = Math.round((100 * MIN_FIELD) / (MIN_FIELD + 1));
    expect(body.percentile).toBe(expected);
    // And it is NOT the synthetic value (full clear → synthetic 99).
    expect(body.percentile).not.toBe(capturePercentile(1));
  });

  it("uses the synthetic curve when the field is below MIN_FIELD", async () => {
    const repo = makeFakeRunsRepo();
    await seed(repo, 5); // well under MIN_FIELD
    const app = makeApp({ runsRepo: repo });
    const res = await request(app).post("/daily/finish").send({ result: fullClear("hero") });
    const body = res.body as DailyFinishRes;
    expect(body.percentile).toBe(capturePercentile(body.result.points / dailyScoreMax(set.prompts)));
  });

  it("degrades gracefully when the repo fails — still a valid synthetic response", async () => {
    const repo = makeFakeRunsRepo({ failWith: new Error("db down") });
    const app = makeApp({ runsRepo: repo });
    const res = await request(app).post("/daily/finish").send({ result: fullClear("device-a") });
    expect(res.status).toBe(200);
    const body = res.body as DailyFinishRes;
    expect(body.percentile).toBe(capturePercentile(body.result.points / dailyScoreMax(set.prompts)));
    expect(body.answers).toBeDefined();
  });
});
