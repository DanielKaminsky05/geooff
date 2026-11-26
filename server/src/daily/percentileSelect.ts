/**
 * Daily Trek — percentile selection (Phase 2).
 *
 * Picks between the REAL aggregate percentile (from the day's `daily_runs`
 * distribution) and the Phase-1 SYNTHETIC curve. With few runs on a date the
 * real value is noisy and unflattering, so we only trust it once the field is
 * large enough; below that the synthetic curve keeps new days feeling social.
 *
 * Pure and DB-free — the real percentile and field size are passed in (computed
 * by a `RunsRepo`), so this is fully unit-testable at the `MIN_FIELD` boundary.
 */

import { capturePercentile } from "./percentile.js";

/**
 * Minimum number of runs on a date before the real percentile is trusted.
 * Below this the synthetic curve is used instead. ~30 is a reasonable floor for
 * a stable-feeling distribution.
 */
export const MIN_FIELD = 30;

export interface PercentileInputs {
  /** Runs recorded for the date (the field size). */
  fieldSize: number;
  /** Raw percentile (0..100) of the player's points within the day. */
  realPct: number;
  /** Capture ratio (points ÷ day's theoretical max, 0..1) for the synthetic curve. */
  ratio: number;
}

/**
 * Real percentile once `fieldSize >= MIN_FIELD`, otherwise the synthetic curve.
 * Result is a rounded 0..100 integer (both branches already round).
 */
export function selectPercentile({ fieldSize, realPct, ratio }: PercentileInputs): number {
  if (fieldSize >= MIN_FIELD) return realPct;
  return capturePercentile(ratio);
}
