# Phase 2 — API & server changes

Phase 2 keeps the existing endpoints and shapes. The only behavioural change:
`POST /daily/finish` records the run (keyed by the anonymous `localId`) and
returns a **real** percentile. No auth, no server wallet — the wallet and
one-and-done stay in `localStorage`.

## Server setup

- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (scaffolded in
  `server/.env.example`). `tsx` doesn't auto-load `.env`, so load it with
  `node --env-file=.env` on the dev script or the `dotenv` package.
- A single **service-role** Supabase client (`server/src/supabase.ts`) for the
  run insert and the percentile RPC. If Supabase is unset/unreachable, the server
  degrades gracefully (below) — it never hard-fails the game.

## Endpoint changes

### `GET /daily` — unchanged
Returns the public `DailySet` exactly as today. One-and-done is still enforced
client-side from `localStorage`; there's no per-player block to return.

### `POST /daily/answer` — unchanged
Still the only route touching the secret valid set; still stateless.

### `POST /daily/finish` — records the run, returns a real percentile
No auth header. The request includes the anonymous `localId`:

```jsonc
// request
{ "result": { /* DailyRunResult, as today */ }, "localId": "a1b2-…" }
```

Flow:
1. Recompute the authoritative result as today (`reconcileFinish`) — never trust
   the client's point/gold totals.
2. Insert into `daily_runs` with `ON CONFLICT (local_id, daily_date) DO NOTHING`
   (a resubmit from the same device doesn't double-count the distribution).
3. `percentile = daily_percentile(date, points)`; if the field is below
   `MIN_FIELD`, fall back to the synthetic curve.
4. Respond with the existing `DailyFinishRes` (no new required fields):

```jsonc
{ "percentile": 82, "result": { /* DailyRunResult */ },
  "answers": { /* promptId -> [{iso,name}] */ }, "goldLost": 0 }
```

Gold is still banked **locally** by the client at finish (as in Phase 1); the
server stores `gold` on the row only to future-proof the accounts wallet.

## Client changes (minimal)

- `getPlayerId()` already returns the local UUID — send it as `localId` on finish.
- Use the returned `percentile` (now real) in the recap. No other `DailyStore`
  changes: wallet and one-and-done stay on `localStorage`.
- The existing offline path (finish failed → unofficial local result) is
  unchanged and still covers Supabase outages.

## Percentile implementation

Replace the synthetic-only `percentile.ts` call with:

```
realPct    = daily_percentile(date, points)        -- from the day's rows
fieldSize  = count(daily_runs for date)
percentile = fieldSize >= MIN_FIELD ? realPct : syntheticCurve(points, dayMax)
```

Keep `syntheticCurve` (today's logic) as the small-sample fallback.

## Idempotency, concurrency, failure

- **Resubmit / refresh:** `unique (local_id, daily_date)` + `ON CONFLICT DO
  NOTHING` keeps the distribution clean; one-and-done itself is still the local
  lock.
- **Supabase unreachable:** `GET /daily` serves the set from the generator +
  cache; `POST /daily/finish` falls back to the client-side offline result and/or
  the synthetic percentile. Nothing hard-fails.

## Tests

- Unit: percentile selection at the `MIN_FIELD` boundary (real vs synthetic);
  `reconcileFinish` unchanged.
- Integration: a finish inserts one row; a resubmit from the same `localId` is a
  no-op; the returned percentile reflects the inserted distribution. Run against
  a disposable Supabase schema or a thin fake of the service client so CI needs
  no live credentials.

---

## Later: when accounts land (deferred)

`POST /daily/finish` gains an optional `Authorization: Bearer` — when present the
run is also stamped with `user_id` (claiming the device's guest rows), the wallet
moves server-side (`wallet_balances`), `GET /daily` returns a `me` block
(played-today, wallet), and a trusted `GET /daily/leaderboard` appears. See
[`auth.md`](./auth.md) and the "Later" section of [`data-model.md`](./data-model.md).
