/**
 * Daily Trek — Supabase-backed `RunsRepo` (Phase 2).
 *
 * The production implementation of the persistence boundary. Wraps the
 * service-role client:
 *   - `recordRun` upserts with `ignoreDuplicates` so a resubmit from the same
 *     `(local_id, daily_date)` is a no-op (`ON CONFLICT DO NOTHING`).
 *   - `fieldStats` reads the day's field size (a `head` count) and the raw
 *     percentile via the `daily_percentile` RPC.
 *
 * Returns `null` from `makeSupabaseRunsRepo()` when Supabase isn't configured,
 * so the caller falls back to the synthetic percentile with no persistence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../supabase.js";
import type { RunsRepo, RunRecord, FieldStats } from "./runsRepo.js";

/** Build the Supabase repo, or `null` when Supabase isn't configured. */
export function makeSupabaseRunsRepo(client: SupabaseClient | null = getSupabase()): RunsRepo | null {
  if (!client) return null;

  return {
    async recordRun(run: RunRecord): Promise<void> {
      const { error } = await client
        .from("daily_runs")
        .upsert(
          {
            local_id: run.localId,
            daily_date: run.dailyDate,
            journey: run.journey,
            points: run.points,
            outcome: run.outcome,
            gold: run.gold,
            per_prompt: run.perPrompt,
          },
          { onConflict: "local_id,daily_date", ignoreDuplicates: true },
        );
      if (error) throw new Error(`daily_runs insert failed: ${error.message}`);
    },

    async fieldStats(dailyDate: string, points: number): Promise<FieldStats> {
      const { count, error: countErr } = await client
        .from("daily_runs")
        .select("id", { count: "exact", head: true })
        .eq("daily_date", dailyDate);
      if (countErr) throw new Error(`daily_runs count failed: ${countErr.message}`);

      const { data, error: rpcErr } = await client.rpc("daily_percentile", {
        p_date: dailyDate,
        p_points: points,
      });
      if (rpcErr) throw new Error(`daily_percentile failed: ${rpcErr.message}`);

      return { fieldSize: count ?? 0, realPct: typeof data === "number" ? data : 0 };
    },
  };
}
