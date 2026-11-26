# Phase 2 — Rollout plan

Ordered, shippable slices. Each builds on the last and leaves the game working
(the Phase-1 offline fallback stays in place throughout, so a Supabase outage
never breaks play).

## Slice 0 — Plumbing
- Add `@supabase/supabase-js`.
- `server/src/supabase.ts`: a service-role client from `SUPABASE_URL` /
  `SUPABASE_SERVICE_KEY`; load `.env` (`--env-file` or `dotenv`).
- A **connection smoke-test** script that reads one row — proves credentials and
  wiring without touching game logic.

## Slice 1 — Player tables
- Author `supabase/migrations/0002_phase2_player_tables.sql` from
  [`data-model.md`](./data-model.md): `profiles`, `daily_runs`, `wallet_balances`,
  `daily_percentile`, the signup trigger, and RLS.
- Apply via the Supabase SQL editor or CLI; keep the SQL in the repo.

## Slice 2 — Guest id + lazy anonymous auth (client)
- Guest tier first: generate a `localId` UUID in `localStorage` on first visit;
  the daily plays fully locally (no account), exactly as Phase 1.
- Add `@supabase/supabase-js` with `SUPABASE_URL` + `SUPABASE_ANON_KEY` (public).
- **Promote on first finish** (recommended): `signInAnonymously()`, claim local
  progress, then attach `Authorization: Bearer <access_token>` to daily API calls.
- `getPlayerId()` returns the Supabase `user.id` once promoted, else the `localId`.

## Slice 3 — Authoritative, persisted finish
- `POST /daily/finish` requires auth, inserts `daily_runs` with
  `ON CONFLICT DO NOTHING` (idempotent), banks gold, returns `wallet`.
- Server recomputes the result (as today) — the client cannot assert a score.

## Slice 4 — Server-truth state
- `GET /daily` returns the `me` block (played-today, `myResult`, wallet) when
  authed.
- Re-point `DailyStore`: one-and-done and wallet come from the server; keep
  `localStorage` as the offline cache only.

## Slice 5 — Real percentile
- Swap `percentile.ts` for `daily_percentile`, with the synthetic curve as the
  `MIN_FIELD` small-sample fallback.

## Slice 6 — Login upgrade (optional)
- Email magic-link / Google OAuth to link an identity to the anonymous user.
- Display-name capture; wallet/history carry over (same `user_id`).

## Slice 7 — Leaderboard & hardened timing (stretch)
- `GET /daily/leaderboard` + a simple board UI.
- Signed run token for clock integrity.

## Migration from Phase 1

- No data migration is required: anonymous users simply start fresh server-side.
- **Optional** one-time, best-effort import of the local wallet on first session
  (guarded against replay). Decide based on how much gold players realistically
  hold; the safe default is to treat the old local wallet as cosmetic and let the
  server become the source of truth.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Supabase free-tier **pauses** inactive projects | Cache the daily set in-process; fall back to the generator + offline finish path; or use a paid tier |
| **Anti-cheat** (forged scores) | Server recomputes every result; no client insert policy (RLS); auth only says *who* |
| **Privacy** (leaderboard identities) | Leaderboard exposes display names only, opt-in; `user_id` never returned |
| **Secret leakage** | service_role only in `server/.env` + Fly secret; anon key is the only client value |
| **Small early field** makes percentile silly | `MIN_FIELD` synthetic fallback |
| **Double-finish / refresh** | `unique (user_id, daily_date)` + idempotent `ON CONFLICT` |

## Acceptance criteria

- A finished run persists; clearing the browser preserves wallet/history after
  re-auth (once identity is linked) and the day stays locked for an anonymous
  user on the same device.
- Finishing twice banks gold once.
- Percentile is real once a date has `>= MIN_FIELD` runs, synthetic before.
- No `service_role` key reaches the browser; CI passes without live Supabase
  credentials (service client is faked/skipped in tests).
