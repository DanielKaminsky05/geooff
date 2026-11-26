/**
 * Supabase connection smoke-test (Phase 2) — MANUAL, not part of CI.
 *
 * Proves the service-role credentials and wiring work end-to-end without
 * touching game logic: it reads one row from `daily_runs` and calls the
 * `daily_percentile` RPC. Requires a real `server/.env` with `SUPABASE_URL` and
 * `SUPABASE_SERVICE_KEY`.
 *
 * Run from the `server/` directory:
 *   npx tsx scripts/supabase-smoke.ts
 */

import "dotenv/config";
import { getSupabase } from "../src/supabase.js";

async function main(): Promise<void> {
  const client = getSupabase();
  if (!client) {
    console.error(
      "Supabase is not configured. Create server/.env with SUPABASE_URL and SUPABASE_SERVICE_KEY.",
    );
    process.exit(1);
  }

  const { data, count, error } = await client
    .from("daily_runs")
    .select("id, local_id, daily_date, points, outcome", { count: "exact" })
    .limit(1);
  if (error) throw new Error(`select daily_runs failed: ${error.message}`);
  console.log(`daily_runs reachable — ${count ?? 0} row(s). Sample:`, data?.[0] ?? "(empty)");

  const today = new Date().toISOString().slice(0, 10);
  const { data: pct, error: rpcErr } = await client.rpc("daily_percentile", {
    p_date: today,
    p_points: 0,
  });
  if (rpcErr) throw new Error(`daily_percentile RPC failed: ${rpcErr.message}`);
  console.log(`daily_percentile(${today}, 0) = ${pct}`);

  console.log("OK: Supabase credentials + schema verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
