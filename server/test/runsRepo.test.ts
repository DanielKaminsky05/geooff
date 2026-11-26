import { describe, it, expect } from "vitest";
import { makeFakeRunsRepo } from "./fakeRunsRepo.js";
import type { RunRecord } from "../src/daily/runsRepo.js";

const DATE = "2026-01-15";

function run(over: Partial<RunRecord>): RunRecord {
  return {
    localId: "device-a",
    dailyDate: DATE,
    journey: "short",
    points: 100,
    outcome: "arrived",
    gold: 0,
    perPrompt: [],
    ...over,
  };
}

describe("fakeRunsRepo — mirrors daily_runs semantics", () => {
  it("records one run", async () => {
    const repo = makeFakeRunsRepo();
    await repo.recordRun(run({ localId: "a", points: 100 }));
    expect(repo.rows).toHaveLength(1);
    const stats = await repo.fieldStats(DATE, 100);
    expect(stats.fieldSize).toBe(1);
  });

  it("is idempotent on (local_id, daily_date) — a resubmit is a no-op", async () => {
    const repo = makeFakeRunsRepo();
    await repo.recordRun(run({ localId: "a", points: 100 }));
    await repo.recordRun(run({ localId: "a", points: 999 })); // same key, ignored
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].points).toBe(100); // first write wins, like ON CONFLICT DO NOTHING
  });

  it("counts distinct devices on the same day", async () => {
    const repo = makeFakeRunsRepo();
    await repo.recordRun(run({ localId: "a" }));
    await repo.recordRun(run({ localId: "b" }));
    await repo.recordRun(run({ localId: "c" }));
    expect((await repo.fieldStats(DATE, 0)).fieldSize).toBe(3);
  });

  it("scopes the field to the date", async () => {
    const repo = makeFakeRunsRepo();
    await repo.recordRun(run({ localId: "a", dailyDate: DATE }));
    await repo.recordRun(run({ localId: "a", dailyDate: "2026-02-20" }));
    expect((await repo.fieldStats(DATE, 0)).fieldSize).toBe(1);
  });

  it("computes the percentile as round(100 * below / total)", async () => {
    const repo = makeFakeRunsRepo();
    // points: 10, 20, 30, 40 → a player on 30 beats 10 and 20 → 2/4 = 50%
    for (const [i, p] of [10, 20, 30, 40].entries()) {
      await repo.recordRun(run({ localId: `d${i}`, points: p }));
    }
    expect((await repo.fieldStats(DATE, 30)).realPct).toBe(50);
    expect((await repo.fieldStats(DATE, 10)).realPct).toBe(0); // beats nobody strictly below
    expect((await repo.fieldStats(DATE, 999)).realPct).toBe(100); // beats all four
  });

  it("returns a zero field for an empty day", async () => {
    const repo = makeFakeRunsRepo();
    expect(await repo.fieldStats(DATE, 50)).toEqual({ fieldSize: 0, realPct: 0 });
  });

  it("rejects from both methods when configured to fail", async () => {
    const repo = makeFakeRunsRepo({ failWith: new Error("db down") });
    await expect(repo.recordRun(run({}))).rejects.toThrow("db down");
    await expect(repo.fieldStats(DATE, 0)).rejects.toThrow("db down");
  });
});
