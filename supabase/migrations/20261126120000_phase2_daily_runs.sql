-- Phase 2 — anonymous local-id ranking.
-- Finished runs keyed by an anonymous client-generated `local_id` (localStorage),
-- used to compute a real "you beat N% of players" percentile. The game server is
-- the only writer (service_role bypasses RLS); the browser never writes here.
-- Applied 2026-11-26 via the Supabase Management API (see docs/phase2).

create table if not exists public.daily_runs (
  id          uuid primary key default gen_random_uuid(),
  local_id    text not null,
  daily_date  date not null,
  journey     text not null check (journey in ('short','medium','long')),
  points      int  not null default 0,
  outcome     text not null check (outcome in ('arrived','died')),
  gold        int  not null default 0,
  per_prompt  jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  unique (local_id, daily_date)
);

create index if not exists daily_runs_date_points_idx
  on public.daily_runs (daily_date, points desc);

-- Server-only access: RLS on with no policies; reads/writes go through the
-- service_role key, which bypasses RLS.
alter table public.daily_runs enable row level security;

-- Real percentile from the day's distribution (synthetic fallback lives in the
-- server when the field is below MIN_FIELD).
create or replace function public.daily_percentile(p_date date, p_points int)
returns int language sql stable as $$
  select case
    when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where points < p_points) / count(*))::int
  end
  from public.daily_runs
  where daily_date = p_date;
$$;
