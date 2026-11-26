# Phase 2 — Data model

All tables live in the Supabase (Postgres) project under `public`. Phase 2 adds
**player** tables; Phase 3's **content** tables (`daily_sets`, `prompt_usage`)
live alongside them in the same database.

Design principles:

- **The server is the only writer of scores.** Finished runs are inserted by the
  game server using the `service_role` key (which bypasses RLS). There is
  deliberately **no insert policy** for players, so points/gold can't be forged
  from the browser.
- **Derive money, don't mutate it.** The wallet is the *sum of banked gold across
  a user's runs*, not a counter that gets `+=`'d — so it can't drift and is fully
  auditable. (A cached column can be added later if the sum ever gets expensive.)
- **One-and-done is a constraint**, not application logic: `unique (user_id,
  daily_date)`.

## Tables

### `profiles`
One row per account, created automatically on signup. Holds the public-facing
display name used on leaderboards.

```sql
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: self read"   on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: self update" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile row whenever an auth user is created (incl. anonymous).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### `daily_runs`
One finished run per user per day. The `unique (user_id, daily_date)` constraint
is the server-side one-and-done lock. `per_prompt` stores the same shape the
recap already uses (`DailyPromptResult[]`).

```sql
create table if not exists public.daily_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  daily_date  date not null,
  journey     text not null check (journey in ('short','medium','long')),
  points      int  not null default 0,
  outcome     text not null check (outcome in ('arrived','died')),
  gold        int  not null default 0,
  per_prompt  jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  unique (user_id, daily_date)
);

-- Ranking/percentile scans by date, ordered by points.
create index if not exists daily_runs_date_points_idx
  on public.daily_runs (daily_date, points desc);

alter table public.daily_runs enable row level security;

-- Players read ONLY their own runs. No insert/update/delete policy: writes go
-- through the server's service-role client, so scores can't be forged.
create policy "daily_runs: self read" on public.daily_runs
  for select using (auth.uid() = user_id);
```

## Wallet (derived)

```sql
-- Balance = sum of all gold a user has banked. Read-only, always consistent.
create or replace view public.wallet_balances as
  select user_id, coalesce(sum(gold), 0)::int as gold
  from public.daily_runs
  group by user_id;
```

The server reads `wallet_balances` for the signed-in user when returning the
recap/HUD wallet. (If summation ever becomes hot, add `profiles.gold_wallet` as a
cache updated in the same transaction as the run insert — but start derived.)

## Percentile (real)

Computed from the day's actual scores, replacing the synthetic curve. Call it
**after** inserting the run so the player is counted.

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

**Small-sample fallback.** With only a handful of runs on a date, a real
percentile is noisy ("you beat 0%"). The server blends: use the real value only
once `count(*) >= MIN_FIELD` (e.g. 30), otherwise fall back to the existing
synthetic curve from `percentile.ts`. This keeps the social hit from day one.

## Leaderboard (optional)

A public top-N board exposes display names, so make it opt-in and expose it
through a function that returns only `display_name` + `points` (never `user_id`).

```sql
create or replace function public.daily_leaderboard(p_date date, p_limit int default 20)
returns table (display_name text, points int, journey text)
language sql stable security definer set search_path = public as $$
  select coalesce(p.display_name, 'Anonymous') as display_name, r.points, r.journey
  from public.daily_runs r
  join public.profiles p on p.id = r.user_id
  order by r.points desc
  limit p_limit;
$$;
```

## Indexes & constraints summary

- `profiles.id` PK → `auth.users`.
- `daily_runs unique (user_id, daily_date)` — one-and-done.
- `daily_runs (daily_date, points desc)` — percentile & leaderboard.
- RLS on both tables; the server uses `service_role` (bypasses RLS) for writes.

## Migration SQL location

Keep these statements as a versioned file (e.g. `supabase/migrations/0002_phase2_player_tables.sql`)
so the schema is reproducible, rather than only pasted into the dashboard once.
