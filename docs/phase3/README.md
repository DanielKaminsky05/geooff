# Phase 3 — Trek Builder (authoring tool)

A **local, dev-only** tool for hand-authoring daily treks and saving them to
Supabase, so curated days override the procedural generator. Built because the
generator makes serviceable-but-bland treks; a human draws a better route and
picks better prompts and rewards.

## What it does (built)

A map editor at `/builder` (dev only):

- **Draw on the world atlas** — place and label the destination **city**, then
  draw the three routes (short / medium / long). Each route **auto-starts at the
  city** and is drawn outward toward its origin.
- **Pick the 5 prompts** from the catalog, seeing each prompt's **correct
  answers** and the **dates it was already used** (de-dup) in the sidebar.
- **Tune temple gold** per journey landmark (positions fixed; gold editable),
  seeded from the defaults.
- **Schedule** the go-live date; the sidebar shows its **Trek #N** (Wordle-style
  ordinal from the launch epoch).
- **Manage published days** — a list tagged `past / today / upcoming`, each with
  **Edit** (load it back into the editor) and **Remove** (unpublish).

## How it fits together

```
Builder UI (/builder, dev-only)
      │  x-admin-token
      ▼
/daily/admin/*  ──►  daily_sets (Supabase)      service_role, server-only
      │                   │
      ▼                   ▼  (hydrated at boot)
  in-memory authored overlay  ◄──┘
      │
      ▼
getDailySet(date):  authored overlay  →  else procedural generator
```

- The service_role key stays **server-side** (Phase 2 client reused); the builder
  authenticates to a localhost admin route with a shared `DAILY_ADMIN_TOKEN`,
  never touching Supabase directly.
- Authored sets live in an **in-memory overlay** the generator checks first, so
  the hot `GET /daily` / `answer` / `finish` paths stay synchronous. The overlay
  is hydrated from `daily_sets` at boot, updated on each save, and **cleared on
  delete** (so unpublish takes effect live, no restart).
- Prompts are stored as **ids** (re-resolved server-side for their secret
  valid-sets); the destination and routes are stored as **drawn geometry**
  (lat/lon jsonb). No secret answers are persisted.

## Admin API

| Route | Purpose |
|---|---|
| `GET /daily/admin/catalog` | prompt catalog: `{id, label, usedOn[], answers[]}` + `journeyDefaults` |
| `POST /daily/admin/sets` | validate + compile + persist + overlay a trek; serve it immediately |
| `GET /daily/admin/sets` | list currently-published days `{dailyDate, destinationName}` |
| `GET /daily/admin/sets/:date` | load one full authored day for editing |
| `DELETE /daily/admin/sets/:date` | unpublish: remove from DB **and** overlay |

## Security — local-only by construction

- **Client:** the `/builder` route and its code are gated behind
  `import.meta.env.DEV`, so Vite tree-shakes them out of the production bundle
  entirely (no Builder chunk, no admin-API strings ship).
- **Server:** admin routes mount only when **both** `DAILY_ADMIN_TOKEN` is set
  **and** `NODE_ENV !== "production"`. Even a leaked token in a prod environment
  can't expose `/daily/admin/*`.
- Every admin request must send a matching `x-admin-token`; mismatches are 401.
- The token lives only in `server/.env` (gitignored); `.env.example` ships blank.

## Trek numbering

`web/src/features/daily/trekNumber.ts`: a pure, client-only ordinal — the launch
day (`DAILY_EPOCH`) is Trek #1 and every date counts up by one. Derived from the
date, so authored and generator days alike get a stable number with no storage.

## Deferred (later)
- Playtest-in-place, difficulty readouts, a bulk calendar view.
- Real archiving / pruning of past days (nothing is auto-deleted today).
- A dedicated `prompt_usage` table (usage is derived from `daily_sets` for now).
- A prompt registry table (editable metadata) — see the data-model note.
- Real admin auth (Supabase Auth) if this ever leaves localhost.

See [`data-model.md`](./data-model.md) for the table and the authored payload.
