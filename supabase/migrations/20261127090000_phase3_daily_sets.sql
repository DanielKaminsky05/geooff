-- Phase 3 — authored daily treks (Trek Builder).
-- One hand-authored trek per day, stored as IDS the server re-resolves against
-- its destination/prompt catalogs (no secret valid-sets persisted). A curated
-- row for a date overrides the procedural generator. The local builder writes
-- here only through the server's service_role client (admin route); the browser
-- never touches this table.

create table if not exists public.daily_sets (
  daily_date       date primary key,
  destination_name text  not null,
  prompt_ids       text[] not null,
  landmarks        jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Prompt usage / de-dup: "which days used prompt X?" via array-containment
-- (prompt_ids @> array['id']). A GIN index keeps that fast as days accumulate.
create index if not exists daily_sets_prompt_ids_idx
  on public.daily_sets using gin (prompt_ids);

-- Server-only access: RLS on with no policies; the service_role key bypasses RLS.
alter table public.daily_sets enable row level security;
