# Phase 2 — Data model

Phase 2 adds **one** table to the Supabase project: `daily_runs`, keyed by an
anonymous local id, used to compute a real percentile. (Phase 3's content tables
`daily_sets` / `prompt_usage` live alongside it.)

Design principles:

- **The server is the only writer.** Finished runs are inserted by the game
  server with the `service_role` key after it **recomputes the score
  authoritatively** — the browser never writes `daily_runs`, so point totals
  can't be forged.
- **The id is anonymous and local.** `local_id` is a UUID the client keeps in
  `localStorage`. It's spoofable by design; the percentile it feeds is a
  statistical aggregate, not a trusted ranking (see README).
- **Wallet and one-and-done stay local** this phase — they are *not* in the DB
  yet.

## Table: `daily_runs`

```sql
create table if not exists public.daily_runs (
  id          uuid primary key default gen_random_uuid(),
  local_id    text not null,            -- anonymous UUID from the client's localStorage
  daily_date  date not null,
  journey     text not null check (journey in ('short','medium','long')),
  points      int  not null default 0,
  outcome     text not null check (outcome in ('arrived','died')),
  gold        int  not null default 0,  -- stored for the future accounts wallet; not authoritative yet
  per_prompt  jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  unique (local_id, daily_date)         -- one row per device per day in the stats
);

-- Percentile/leaderboard scans by date, ordered by points.
create index if not exists daily_runs_date_points_idx
  on public.daily_runs (daily_date, points desc);

-- No accounts yet, so no per-user RLS. Enable RLS with NO policies so direct
-- client access is denied; all reads/writes go through the server's
-- service-role client (which bypasses RLS).
alter table public.daily_runs enable row level security;
```

Notes:
- `unique (local_id, daily_date)` de-dupes a device so one player can't inflate
  the day's distribution by resubmitting. (It is *not* the one-and-done lock —
  that stays in `localStorage`; clearing the local id just yields a new,
  unweighted guest.)
- `gold` is recorded now so the later accounts wallet can be derived without a
  backfill, but in this phase the authoritative wallet is still local.

## Percentile (real)

Computed from the day's actual scores. Call it **after** inserting the run so the
player is included.

```sql
create or replace function public.daily_percentile(p_date date, p_points int)
returns int language sql stable as $$
  select case
    when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where points < p_points) / count(*))::int
  end
  from public.daily_runs
  where daily_date = p_date;
$$;
```

**Small-sample fallback.** With few runs on a date the real percentile is noisy.
The server uses the real value only once `count(*) >= MIN_FIELD` (e.g. 30),
otherwise it falls back to the existing synthetic curve in `percentile.ts` — so
new days and brand-new content still feel social.

## Migration SQL location

Keep this as a versioned file, e.g.
`supabase/migrations/0002_phase2_daily_runs.sql`, so the schema is reproducible
rather than only pasted into the dashboard once.

---

## Later: accounts (deferred — designed, not built)

When you want cross-device wallets and a **trusted** leaderboard, add real
identity. This is a separate future phase; the sketch below shows it drops in
next to `daily_runs` without a rewrite.

- **`profiles`** — one row per `auth.users` id (display name, created_at),
  auto-created by a signup trigger; RLS: self read/update.
- **`daily_runs` gains a nullable `user_id uuid references auth.users`** — guest
  runs keep `user_id = null` and are keyed by `local_id`; account runs set
  `user_id`. On promotion, the server back-fills `user_id` onto the device's past
  rows (the "claim").
- **Wallet becomes a derived view** `wallet_balances` = `sum(gold)` per
  `user_id`, read server-side (replacing the local wallet for logged-in players).
- **Trusted leaderboard** via a `security definer` function returning
  `display_name` + `points` for a date (never `user_id`), gated on opted-in
  accounts.
- **RLS** tightens so authenticated players can read their own rows; writes still
  go only through the service role.

See [`auth.md`](./auth.md) for the identity tiers that drive this.
