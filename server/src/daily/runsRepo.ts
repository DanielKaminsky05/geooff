/**
 * Daily Trek — the `daily_runs` persistence boundary (Phase 2).
 *
 * The ENTIRE database surface for finished runs sits behind this interface, so:
 *   - `routes.ts` depends only on the abstraction, never on `@supabase/*`;
 *   - production wires `supabaseRunsRepo` (service-role client);
 *   - tests wire an in-memory fake — no network, no credentials in CI;
 *   - when Supabase is unset/unreachable the repo is simply `null` and the
 *     finish path degrades to the synthetic percentile (the game never fails).
 *
 * The server is the ONLY writer and inserts only AFTER recomputing the score
 * authoritatively (see `reconcileFinish`), so point totals can't be forged. The
 * `localId` is the anonymous device UUID the client already carries as
 * `DailyRunResult.playerId` — spoofable by design; it only namespaces a device
 * in the aggregate (see docs/phase2).
 */

import type { JourneyId, DailyOutcome, DailyPromptResult } from "../protocol.js";

/** One finished run, as handed to the repo for insertion. */
export interface RunRecord {
  /** Anonymous device UUID (client's `DailyRunResult.playerId`). */
  localId: string;
  dailyDate: string;
  journey: JourneyId;
  points: number;
  outcome: DailyOutcome;
  gold: number;
  perPrompt: DailyPromptResult[];
}

/** The day's aggregate used to pick a percentile. */
export interface FieldStats {
  /** How many runs are recorded for the date (the field size). */
  fieldSize: number;
  /** Raw percentile (0..100) of `points` within that day's distribution. */
  realPct: number;
}

/** The `daily_runs` persistence boundary. */
export interface RunsRepo {
  /**
   * Insert one finished run. Idempotent on `(local_id, daily_date)` — a resubmit
   * from the same device is a no-op, so the distribution isn't double-counted.
   */
  recordRun(run: RunRecord): Promise<void>;
  /** The day's field size + the raw percentile of `points` within it. */
  fieldStats(dailyDate: string, points: number): Promise<FieldStats>;
}
