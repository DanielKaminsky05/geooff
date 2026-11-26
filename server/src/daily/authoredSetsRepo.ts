/**
 * Daily Trek — `daily_sets` persistence boundary (Phase 3).
 *
 * The DB surface for AUTHORED treks, behind an interface so the admin routes and
 * boot hydration depend on an abstraction (production: Supabase; tests: a fake).
 * Stores ids only — the server re-resolves prompts/destination against its
 * catalogs on load (see `authoredBuild.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../supabase.js";
import type { AuthoredDailySet } from "./authoredSets.js";

export interface AuthoredSetsRepo {
  /** Insert or replace the authored trek for a date (PK = daily_date). */
  upsert(authored: AuthoredDailySet): Promise<void>;
  /** Every authored trek, for boot hydration and the builder's usage map. */
  list(): Promise<AuthoredDailySet[]>;
  /** Delete the authored trek for a date (no-op if none). */
  delete(dailyDate: string): Promise<void>;
}

/** Row shape in `public.daily_sets`. */
interface DailySetRow {
  daily_date: string;
  destination: AuthoredDailySet["destination"];
  routes: AuthoredDailySet["routes"];
  prompt_ids: string[];
  landmarks: AuthoredDailySet["landmarks"] | null;
}

/** Build the Supabase repo, or `null` when Supabase isn't configured. */
export function makeSupabaseAuthoredSetsRepo(
  client: SupabaseClient | null = getSupabase(),
): AuthoredSetsRepo | null {
  if (!client) return null;

  return {
    async upsert(authored: AuthoredDailySet): Promise<void> {
      const { error } = await client.from("daily_sets").upsert(
        {
          daily_date: authored.dailyDate,
          destination: authored.destination,
          routes: authored.routes,
          prompt_ids: authored.promptIds,
          landmarks: authored.landmarks ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "daily_date" },
      );
      if (error) throw new Error(`daily_sets upsert failed: ${error.message}`);
    },

    async list(): Promise<AuthoredDailySet[]> {
      const { data, error } = await client
        .from("daily_sets")
        .select("daily_date, destination, routes, prompt_ids, landmarks");
      if (error) throw new Error(`daily_sets list failed: ${error.message}`);
      return (data ?? []).map((row: DailySetRow) => ({
        dailyDate: row.daily_date,
        destination: row.destination,
        routes: row.routes,
        promptIds: row.prompt_ids,
        landmarks: row.landmarks ?? undefined,
      }));
    },

    async delete(dailyDate: string): Promise<void> {
      const { error } = await client.from("daily_sets").delete().eq("daily_date", dailyDate);
      if (error) throw new Error(`daily_sets delete failed: ${error.message}`);
    },
  };
}
