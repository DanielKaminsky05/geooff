# Phase 3 — Data model

Slice 1 adds **one** table, `daily_sets`, holding authored days as **ids** the
server re-resolves against its catalogs. (A `prompt_usage` table is deferred —
usage is derived from `daily_sets` for now.)

## Table: `daily_sets`

```sql
create table if not exists public.daily_sets (
  daily_date       date primary key,       -- the day this trek goes live (UTC)
  destination_name text  not null,         -- resolved against the destination catalog
  prompt_ids       text[] not null,        -- exactly 5 ids from the prompt catalog
  landmarks        jsonb,                  -- optional per-journey gold overrides; null = defaults
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Server-only: RLS on with no policies; the service-role client bypasses it.
alter table public.daily_sets enable row level security;
```

- **`daily_date` is the primary key** — one authored trek per day; re-saving a
  day is an upsert.
- **Ids, not content.** `destination_name` + `prompt_ids` are re-resolved on the
  server against the destination/prompt catalogs, so a stored row never contains
  a secret valid-set and survives catalog edits by reference.
- **`landmarks`** overrides temple gold per journey, e.g.
  `{"short":[{"atFraction":0.5,"gold":25},{"atFraction":1,"gold":40}]}`. Null →
  the default landmark layout from `window.ts`.

## Authored payload (wire + overlay)

```ts
interface AuthoredDailySet {
  dailyDate: string;        // "YYYY-MM-DD"
  destinationName: string;  // must match a catalog destination
  promptIds: string[];      // exactly 5, each must resolve in the catalog
  landmarks?: Partial<Record<JourneyId, DailyLandmark[]>>;
}
```

The server **compiles** this into the same `CompiledDailySet` the generator
produces (prompts resolved with their valid-sets, journeys built with the
day's distances, routes from the chosen destination), then places it in the
in-memory overlay that `getDailySet` checks first.

## Validation (server, on save)

- `dailyDate` is a real UTC date string.
- `promptIds` has exactly `DAILY_PROMPT_COUNT` entries, all distinct, all
  resolving via `promptById`.
- `destinationName` matches a catalog entry.
- landmark overrides (if present) are well-formed `{atFraction, gold}` arrays.

A failure returns `400` with the reason and nothing is persisted.

## Usage / de-dup

The builder's "has this prompt been used?" is computed from
`daily_sets`: for each prompt id, the list of `daily_date`s whose `prompt_ids`
contain it. Slice 1 derives this in the admin catalog endpoint; a denormalized
`prompt_usage` table is a later optimization if the scan ever gets large.
