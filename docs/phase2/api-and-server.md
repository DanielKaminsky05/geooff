# Phase 2 — API & server changes

Phase 2 keeps the existing endpoints and shapes; it adds auth, server-side
persistence, and a real percentile. The client's `DailyStore` seam is re-pointed
from `localStorage` to the server.

## Server setup

- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (already scaffolded in
  `server/.env.example`). `tsx` doesn't auto-load `.env`, so load it with
  `node --env-file=.env` on the dev script or the `dotenv` package.
- A single **service-role** Supabase client module (`server/src/supabase.ts`)
  used for all authoritative reads/writes. A helper `userFromRequest(req)`
  validates the bearer token (`auth.getUser`) and returns the `user_id` or null.

## Endpoint changes

### `GET /daily` — unchanged set, plus personal state
Still returns the public `DailySet`. If a valid bearer token is present, also
return the player's state so one-and-done and the wallet come from server truth:

```jsonc
{
  "set": { /* DailySet, as today */ },
  "me": {                       // present only when authed
    "playedToday": true,
    "myResult": { /* DailyRunResult */ },   // if already finished today
    "wallet": 420
  }
}
```

### `POST /daily/answer` — unchanged
Still the only route that touches the secret valid set; still stateless. May tie
its rate-limit bucket to the `user_id` when present (otherwise IP, as today).

### `POST /daily/finish` — now authoritative & persisted
Requires auth. Flow:

1. `user_id = userFromRequest(req)` → 401 if missing/invalid.
2. Recompute the authoritative result exactly as today (`reconcileFinish`):
   clamp per-prompt scores, resolve gold (all-or-nothing on arrival), etc.
3. **Insert** into `daily_runs` with `ON CONFLICT (user_id, daily_date) DO
   NOTHING`:
   - New row → it's their official run.
   - Conflict (already played) → **idempotent**: read the stored run and return
     that (a replay attempt gets the original result, never a second bank).
4. **Percentile**: call `daily_percentile(date, points)`; if the field is below
   `MIN_FIELD`, fall back to the synthetic curve.
5. **Wallet**: read `wallet_balances` for the user.
6. Respond with the existing `DailyFinishRes`, plus `wallet`:

```jsonc
{ "percentile": 82, "result": { /* DailyRunResult */ },
  "answers": { /* promptId -> [{iso,name}] */ },
  "goldLost": 0, "wallet": 420 }
```

### `GET /daily/leaderboard?date=` — new, optional
Returns `daily_leaderboard(date, limit)` (display names + points) and, when
authed, the caller's rank. Omit until there's a UI for it.

## Client: the `DailyStore` swap

Phase 1's `localDailyStore` (localStorage) is replaced by a **remote-backed**
implementation behind the *same interface* — callers in `DailyDive.tsx` don't
change:

| `DailyStore` method | Phase 1 | Phase 2 |
|---|---|---|
| `getPlayerId()` | random device id | guest `localId`, or Supabase `user.id` once promoted |
| `isPlayedToday()` / `getResult()` | localStorage | guest: localStorage; account: `GET /daily`'s `me` block |
| `getWallet()` | localStorage | guest: localStorage; account: `me.wallet` / finish response |
| `recordFinished()` | localStorage write | guest: localStorage; account: `POST /daily/finish` (server persists) |
| `addGold()` | local increment | guest: local; account: banked server-side at finish |

`localStorage` is kept only as an **offline cache / fallback** (the Phase-1
"couldn't reach the server — unofficial result" path already exists and stays).

## Percentile implementation

Replace the synthetic-only `percentile.ts` with:

```
realPct      = daily_percentile(date, points)      -- from data
fieldSize    = count(daily_runs for date)
percentile   = fieldSize >= MIN_FIELD ? realPct : syntheticCurve(points, dayMax)
```

Keep `syntheticCurve` (today's logic) as the small-sample fallback so early days
and brand-new content still feel social.

## Idempotency, concurrency, failure

- **Double finish / refresh:** the unique constraint + `ON CONFLICT DO NOTHING`
  makes finishing idempotent; the stored run is the single source of truth.
- **Supabase unreachable:** `GET /daily` still serves the set from the generator
  + cache; `POST /daily/finish` returns the existing client-side **offline**
  result (unofficial, no bank) — already implemented. Nothing hard-fails.
- **Clock/anti-cheat (stretch):** issue a signed run token at `GET /daily` with
  an expiry; require it on `answer`/`finish` to bound how long a run can take.
  Deferred — document, don't build yet.

## Tests

- Unit: percentile selection (real vs synthetic fallback at the `MIN_FIELD`
  boundary); `userFromRequest` accept/reject.
- Integration: finish inserts a run; a second finish is idempotent and re-banks
  nothing; wallet reflects summed gold; one-and-done surfaces in `GET /daily`.
  Run against a disposable Supabase schema (or a thin fake of the service client)
  so CI doesn't need live credentials.
