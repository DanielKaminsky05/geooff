# Phase 2 — Rollout plan

Small, shippable slices. The Phase-1 offline fallback stays in place throughout,
so a Supabase outage never breaks play.

## Slice 0 — Plumbing
- Add `@supabase/supabase-js`.
- `server/src/supabase.ts`: a service-role client from `SUPABASE_URL` /
  `SUPABASE_SERVICE_KEY`; load `.env` (`--env-file` or `dotenv`).
- A **connection smoke-test** script that reads one row — proves credentials and
  wiring without touching game logic.

## Slice 1 — The `daily_runs` table
- Author `supabase/migrations/0002_phase2_daily_runs.sql` from
  [`data-model.md`](./data-model.md): the `daily_runs` table (local-id keyed), the
  `daily_date, points` index, RLS-on-with-no-policies, and `daily_percentile`.
- Apply via the Supabase SQL editor or CLI; keep the SQL in the repo.

## Slice 2 — Record runs + real percentile
- `POST /daily/finish` recomputes the result (as today), inserts into
  `daily_runs` with `ON CONFLICT (local_id, daily_date) DO NOTHING`, and returns
  `daily_percentile(date, points)` with the synthetic `MIN_FIELD` fallback.
- Client sends its existing local UUID as `localId`; the recap uses the returned
  real percentile. Wallet and one-and-done stay on `localStorage`.

## Slice 3 — Polish (optional)
- Show a lightweight "rank X of Y today" alongside the percentile.
- Tune `MIN_FIELD` once there's real traffic.

## Later (separate phase) — accounts
Deferred and designed in [`auth.md`](./auth.md) / [`data-model.md`](./data-model.md):
anonymous → linked accounts, a claim of the device's guest runs, a server-side
derived wallet, cross-device sync, and a trusted leaderboard. Pulled in only when
you want trusted identity, not before.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Supabase free-tier **pauses** inactive projects | Cache the daily set; fall back to the generator + synthetic percentile + offline finish |
| **Forged scores** | Server recomputes every result; no client writes to `daily_runs` |
| **Spoofed/stuffed local ids skew the aggregate** | Accepted for a casual stat; `unique(local_id,date)` limits per-device; a *trusted* board needs the accounts upgrade |
| **Small early field** makes percentile silly | `MIN_FIELD` synthetic fallback |
| **Resubmit / refresh** | `unique (local_id, daily_date)` + idempotent `ON CONFLICT` |
| **Secret leakage** | `service_role` only in `server/.env` + Fly secret; the client never needs a Supabase key this phase |

## Acceptance criteria

- A finished run inserts exactly one `daily_runs` row; a resubmit from the same
  `localId` is a no-op.
- The recap shows a **real** percentile once a date has `>= MIN_FIELD` runs, and
  the synthetic curve before that.
- Wallet and one-and-done behave exactly as Phase 1 (local).
- No Supabase key reaches the browser; CI passes with no live credentials.
