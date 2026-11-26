# Phase 3 — Trek Builder (authoring tool)

A **local, dev-only** tool for hand-authoring daily treks and saving them to
Supabase, so curated days override the procedural generator. Built because the
generator makes serviceable-but-bland treks; a human picks better prompts,
destinations and rewards.

## Scope of slice 1 (this slice) — metadata-first

Author the **metadata** of a day and reuse the generator's route geometry:

- pick the **go-live date**;
- pick the **destination** (from the existing hand-authored destination catalog,
  which carries its three route polylines);
- pick the **5 prompts** (from the prompt catalog), with a **"used already"**
  flag showing which prior dates each prompt appeared on (de-dup);
- optionally tune **temple gold** per journey landmark.

Freehand route drawing (laying the three polylines on the map with control
points) is a **later slice** — slice 1 reuses the chosen destination's routes.

## How it fits together

```
Builder UI (/builder, dev-only)
      │  x-admin-token
      ▼
POST /daily/admin/sets  ──►  daily_sets (Supabase)      service_role, server-only
      │                           │
      ▼                           ▼  (hydrated at boot)
  in-memory authored overlay  ◄───┘
      │
      ▼
getDailySet(date):  authored overlay  →  else procedural generator
```

- The service_role key stays **server-side** (Phase 2 client reused); the builder
  authenticates to a localhost admin route with a shared `DAILY_ADMIN_TOKEN`,
  never touching Supabase directly.
- Authored sets live in an **in-memory overlay** the generator checks first, so
  the hot `GET /daily` / `answer` / `finish` paths stay synchronous. The overlay
  is hydrated from `daily_sets` at boot and updated on each save.
- Stored content is **ids only** (prompt ids + destination name); the server
  re-resolves them against its catalogs, so no secret valid-sets are persisted
  and the stored row stays tiny.

## Security — local-only by construction

- **Client:** the `/builder` route and its code are gated behind
  `import.meta.env.DEV`, so Vite tree-shakes them out of the production bundle
  entirely (no Builder chunk, no admin-API strings ship).
- **Server:** admin routes mount only when **both** `DAILY_ADMIN_TOKEN` is set
  **and** `NODE_ENV !== "production"`. The env guard means even a leaked token in
  a prod environment can't expose `/daily/admin/*`.
- Every admin request must send a matching `x-admin-token`; mismatches are 401.
- The token lives only in `server/.env` (gitignored); `.env.example` ships blank.

## Deferred (later slices)
- Freehand route/waypoint drawing on the map.
- A dedicated `prompt_usage` table (slice 1 derives usage from `daily_sets`).
- Playtest-in-place, difficulty readouts, bulk calendar view.
- Real admin auth (Supabase Auth) if this ever leaves localhost.

See [`data-model.md`](./data-model.md) for the table and the authored payload.
