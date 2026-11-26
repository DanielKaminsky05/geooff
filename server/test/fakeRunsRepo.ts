/**
 * In-memory `RunsRepo` for tests — mirrors the `daily_runs` SQL semantics
 * (`unique(local_id,daily_date)` + the `daily_percentile` formula) without a
 * network or credentials. Lets the finish route run end-to-end in CI.
 */

import type { RunsRepo, RunRecord, FieldStats } from "../src/daily/runsRepo.js";

export interface FakeRunsRepo extends RunsRepo {
  /** Every stored run (insertion order), for assertions. */
  readonly rows: RunRecord[];
}

/**
 * Build a fake repo. `onError`, when set, makes both methods reject — used to
 * exercise the graceful-degrade path (DB down → synthetic percentile).
 */
export function makeFakeRunsRepo(opts: { failWith?: Error } = {}): FakeRunsRepo {
  // Keyed by `local_id|daily_date`, enforcing the unique constraint.
  const byKey = new Map<string, RunRecord>();
  const order: RunRecord[] = [];
  const key = (localId: string, date: string) => `${localId}|${date}`;

  return {
    get rows() {
      return order;
    },
    async recordRun(run: RunRecord): Promise<void> {
      if (opts.failWith) throw opts.failWith;
      const k = key(run.localId, run.dailyDate);
      if (byKey.has(k)) return; // ON CONFLICT DO NOTHING
      byKey.set(k, run);
      order.push(run);
    },
    async fieldStats(dailyDate: string, points: number): Promise<FieldStats> {
      if (opts.failWith) throw opts.failWith;
      const sameDay = order.filter((r) => r.dailyDate === dailyDate);
      const fieldSize = sameDay.length;
      // round(100 * count(points < p_points) / count) — the SQL formula.
      const below = sameDay.filter((r) => r.points < points).length;
      const realPct = fieldSize === 0 ? 0 : Math.round((100 * below) / fieldSize);
      return { fieldSize, realPct };
    },
  };
}
