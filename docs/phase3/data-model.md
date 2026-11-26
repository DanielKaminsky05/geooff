# Phase 3 — Data model

One table, `daily_sets`: prompts stored as **ids** (re-resolved server-side for
their secret valid-sets), the destination and routes as **drawn geometry**
(lat/lon jsonb). (A `prompt_usage` table is deferred — usage is derived from
`daily_sets`.)

## Table: `daily_sets`

```sql
create table if not exists public.daily_sets (
  daily_date   date primary key,   -- the day this trek goes live (UTC)
  destination  jsonb  not null,    -- { name, at: { lat, lon } }
  routes       jsonb  not null,    -- [ { journeyId, points: [ { lat, lon } ] } ]  (short|medium|long)
  prompt_ids   text[] not null,    -- exactly 5 ids from the prompt catalog
  landmarks    jsonb,              -- optional per-journey temple-gold overrides; null = defaults
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Prompt usage / de-dup: "which days used prompt X?" via prompt_ids @> array['id'].
create index if not exists daily_sets_prompt_ids_idx
  on public.daily_sets using gin (prompt_ids);

-- Server-only: RLS on with no policies; the service-role client bypasses it.
alter table public.daily_sets enable row level security;
```

- **`daily_date` is the primary key** — one authored trek per day; re-saving a
  day is an upsert; deleting reverts it to the generator.
- **Prompts are ids.** `prompt_ids` are re-resolved on the server against the
  prompt catalog, so a stored row never contains a secret valid-set.
- **Destination + routes are drawn geometry** — the author draws them on the map;
  the game needs no catalog destination. Routes run origin → city (the city is
  the last point of each route); the builder draws city-first and reverses on
  save.
- **`landmarks`** overrides temple gold per journey, e.g.
  `{"short":[{"atFraction":0.5,"gold":25},{"atFraction":1,"gold":40}]}`. Null →
  the default landmark layout from `window.ts`.

## Authored payload (wire + overlay)

```ts
interface AuthoredDailySet {
  dailyDate: string;                 // "YYYY-MM-DD"
  destination: { name: string; at: GeoPoint };   // drawn
  routes: DailyRoute[];              // 3 drawn routes (short/medium/long), origin -> city
  promptIds: string[];               // exactly 5, each must resolve in the catalog
  landmarks?: Partial<Record<JourneyId, DailyLandmark[]>>;
}
```

The server **compiles** this into the same `CompiledDailySet` the generator
produces (prompts resolved with their valid-sets, journeys built with the day's
distances + gold, the drawn destination and routes), then places it in the
in-memory overlay that `getDailySet` checks first.

## Validation (server, on save)

- `dailyDate` is a real UTC date string.
- `promptIds` has exactly `DAILY_PROMPT_COUNT` entries, all distinct, all
  resolving via `promptById`.
- `destination` has a non-empty name and a valid lat/lon point.
- `routes` has exactly one entry per journey (short/medium/long), each a polyline
  of ≥ 2 valid points.
- landmark overrides (if present) are well-formed `{atFraction, gold}` arrays for
  real journeys.

A failure returns `400` with the reason and nothing is persisted.

## Usage / de-dup

"Has this prompt been used?" is computed from `daily_sets`: for each prompt id,
the `daily_date`s whose `prompt_ids` contain it (GIN-indexed `@>`). A denormalized
`prompt_usage` table is a later optimization if the scan ever gets large.

## Not stored (derived)

- **Correct answers** — re-resolved from the prompt ids on demand (the admin
  catalog reveals them for the builder sidebar; players never receive them).
- **Trek number** — a pure ordinal from the date (`trekNumber.ts`), client-side.
- **past / today / upcoming** — compared against the current date in the builder.
