/**
 * Supabase service-role client (Phase 2).
 *
 * A single lazily-created client built from `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`.
 * The service_role key BYPASSES RLS, so it must stay server-only (`server/.env`
 * + Fly secret) and NEVER reach the browser.
 *
 * When either env var is missing the client is `null` — the server runs exactly
 * as Phase 1 (synthetic percentile, no persistence). This keeps CI and local dev
 * credential-free: nothing imports this unless a repo is actually wired.
 *
 * `tsx` does not auto-load `.env`; the `dev`/`start` scripts pass
 * `node --env-file=.env` so `process.env` is populated in production/dev.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * The shared service-role client, or `null` when Supabase is not configured.
 * Memoised after the first call.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) {
    cached = null;
    return cached;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Reset the memoised client — tests only. */
export function resetSupabaseForTests(): void {
  cached = undefined;
}
