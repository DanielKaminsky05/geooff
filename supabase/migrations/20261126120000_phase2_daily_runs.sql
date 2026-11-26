-- Phase 2 — daily run persistence + real percentile.
-- One row per (local_id, daily_date): the anonymous device's finished run for a
-- day. Resubmits are idempotent (ON CONFLICT DO NOTHING via the unique key). The
-- server writes here only through its service_role client; the browser never
-- touches this table. The daily_percentile() RPC turns the day's field of runs
-- into a real "you beat ~N%" once enough players have finished.

create table if not exists public.daily_runs (
  id          bigint generated always as identity primary key,
  local_id    text        not null,          -- anonymous device UUID
  daily_date  date        not null,
  journey     text        not null,          -- short | medium | long
  points      integer     not null,
  outcome     text        not null,          -- arrived | died
  gold        integer     not null default 0,
  per_prompt  jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  unique (local_id, daily_date)              -- one recorded run per device per day
);

-- fieldStats() counts and percentiles by day, so index the day.
create index if not exists daily_runs_daily_date_idx
  on public.daily_runs (daily_date);

-- Real percentile for a score within a day's field: the share of that day's runs
-- whose points are <= p_points (the player's own row is already recorded, so it
-- counts). 0 when the day has no runs yet. Matches supabaseRunsRepo.fieldStats().
create or replace function public.daily_percentile(p_date date, p_points integer)
returns numeric
language sql
stable
as $$
  select case
    when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where points <= p_points) / count(*), 2)
  end
  from public.daily_runs
  where daily_date = p_date;
$$;

-- Server-only access: RLS on with no policies; the service_role key bypasses RLS.
alter table public.daily_runs enable row level security;
