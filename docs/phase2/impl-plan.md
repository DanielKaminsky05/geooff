# Phase 2 — Implementation plan (parallelized + testable)

Turns the [rollout](./rollout.md) slices into concrete, **parallel** work lanes
with a testing strategy that needs **no live Supabase credentials in CI**. Work
on a branch off `daily-dive`; one logical commit per concern.

Current state: Slice 1 (the `daily_runs` table + `daily_percentile` function) is
already applied to Supabase and versioned in
`supabase/migrations/20261126120000_phase2_daily_runs.sql`. This plan covers
Slices 0, 2, and 3.

## The seam that makes everything parallel + testable

`registerDailyRoutes(app, options)` already injects `now` / `today` /
`answerLimit` / `finishLimit` for deterministic tests. We add **one more
injectable**: a `RunsRepo` — the entire DB boundary behind a tiny interface.

```ts
// server/src/daily/runsRepo.ts  (the CONTRACT — built first, in Wave 0)
export interface RunRecord {
  localId: string; dailyDate: string; journey: JourneyId;
  points: number; outcome: DailyOutcome; gold: number;
  perPrompt: DailyPromptResult[];
}
export interface FieldStats { fieldSize: number; realPct: number }

export interface RunsRepo {
  /** Insert one finished run; ON CONFLICT(local_id,daily_date) DO NOTHING. */
  recordRun(run: RunRecord): Promise<void>;
  /** The day's field size + raw percentile of `points` within it. */
  fieldStats(dailyDate: string, points: number): Promise<FieldStats>;
}
```

- **Production** wires a `supabaseRunsRepo` (Lane A).
- **Tests** wire an in-memory `fakeRunsRepo` (Lane C) — no network, no creds.
- **No repo configured** (Supabase env unset/unreachable): routes pass `null`
  and the finish path degrades to today's synthetic percentile. The game never
  hard-fails. This is the acceptance-criterion "offline fallback stays in place."

Defining this interface is the **only serial prerequisite**. Once it exists,
four lanes proceed at once against it.

## Identity: reuse `playerId`, no protocol churn

`DailyRunResult.playerId` **already exists** and already flows to
`POST /daily/finish` inside `result`. We use it as the anonymous `localId`
rather than adding a new `localId` field — this avoids touching the three
byte-identical protocol files (shared / server / web) and the `diff -u`
protocol CI job. The only client change is ensuring `result.playerId` is set
from `getPlayerId()` at finish (Lane D). (The docs' `localId` naming maps 1:1 to
this field; note it in `api-and-server.md` rather than renaming the wire.)

---

## Waves

### Wave 0 — the seam (serial, ~1 small commit)
Blocks the parallel lanes, so do it first and keep it mechanical:
- Add `server/src/daily/runsRepo.ts` with the `RunsRepo` interface + `RunRecord`
  / `FieldStats` types (no implementation).
- Add `server/src/daily/percentileSelect.ts` **stub signature** +
  `MIN_FIELD = 30` constant.
- Add an optional `runsRepo?: RunsRepo` to `DailyRoutesOptions` and thread it
  into `registerDailyRoutes` (unused for now). Build stays green.

### Wave 1 — four independent lanes (parallel, disjoint files)
Each lane is gated by `npm run build` + `npm test` (server) /
`npm run build` (web) and committed on its own.

| Lane | Files (disjoint) | Deliverable |
|---|---|---|
| **A — Supabase impl** | `server/package.json`, `server/src/supabase.ts`, `server/src/daily/supabaseRunsRepo.ts`, `server/scripts/supabase-smoke.ts`, `server/package.json` dev script | `@supabase/supabase-js` dep; lazy service-role client from `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (returns `null` when unset); `supabaseRunsRepo` implementing `RunsRepo` (insert via `upsert ... ignoreDuplicates`, `fieldStats` via `count` + `daily_percentile` RPC); env loading via `node --env-file=.env` on `dev`/`start`; a manual smoke script that reads one row. |
| **B — Percentile selection** | `server/src/daily/percentileSelect.ts`, `server/test/percentileSelect.test.ts` | Pure `selectPercentile({ fieldSize, realPct, ratio }) → number`: real when `fieldSize >= MIN_FIELD`, else `capturePercentile(ratio)`. No DB. Fully unit-tested at the boundary. |
| **C — Fake repo + repo tests** | `server/test/fakeRunsRepo.ts`, `server/test/runsRepo.test.ts` | In-memory `RunsRepo` (Map keyed by `localId|date`) mirroring the SQL semantics; tests for insert idempotency, field-size counting, and percentile-of-points math. |
| **D — Client wiring** | `web/src/pages/DailyDive.tsx` (or wherever the run is assembled), `web/src/features/daily/DailyStore.ts` if needed | Ensure `result.playerId = getPlayerId()` at finish; confirm recap consumes the returned (now real) `percentile`; offline path unchanged. Verify with `npm run build`. |

Lanes A, B, C are server-side but touch **disjoint files**, so they don't
collide. Lane D is web-side and independent.

### Wave 2 — integration (depends on Wave 1)
One commit, in `server/src/daily/routes.ts` + a test file:
- In `reconcileFinish` (or a thin async wrapper around it), after computing the
  authoritative `result`: call `runsRepo.recordRun(...)` **best-effort**
  (swallow errors — a DB hiccup must not fail the finish), then
  `fieldStats(date, points)`, then `selectPercentile(...)` for the response.
- When `runsRepo` is `null` or throws: fall straight through to
  `capturePercentile(ratio)` exactly as today.
- Integration tests (`server/test/dailyFinish.supabase.test.ts`) via `supertest`
  with the **fake repo injected** through `DailyRoutesOptions`:
  1. a finish inserts exactly one row;
  2. a resubmit from the same `playerId` is a no-op (distribution unchanged);
  3. the returned percentile reflects the inserted distribution once
     `fieldSize >= MIN_FIELD`, and the synthetic curve below it;
  4. **graceful degrade**: a repo whose methods reject still returns a valid
     synthetic percentile and a normal `DailyFinishRes`.

### Wave 3 — verify + live smoke (serial)
- Full `npm run build` + `npm test` on server and `npm run build` on web.
- Manual live smoke (**not CI**): with a real `server/.env`, run
  `server/scripts/supabase-smoke.ts` and one real finish; confirm a row lands
  and the percentile is real once seeded past `MIN_FIELD`.
- Slice 3 polish (optional): surface "rank X of Y today" from `fieldStats`.

---

## Dependency graph

```
Wave 0 (seam)
   │
   ├── Lane A (supabase impl) ─┐
   ├── Lane B (select logic) ──┤
   ├── Lane C (fake + tests) ──┤→ Wave 2 (routes integ + tests) → Wave 3 (verify+live)
   └── Lane D (client) ────────┘
```

Critical path = Wave 0 → (slowest of A/B/C) → Wave 2 → Wave 3. Lane D runs fully
off the critical path.

## Testing strategy (what runs where)

- **CI (no credentials):** Lane B unit tests, Lane C repo tests against the fake,
  Wave 2 integration tests against the injected fake, and the unchanged
  `reconcileFinish` scoring tests. The existing protocol `diff -u` job stays
  green because we add no protocol fields.
- **Local/manual only:** the live Supabase smoke script (reads one row) and a
  real end-to-end finish. Gated on `server/.env`; never in CI.
- **Not attempted in CI:** exercising the actual `daily_percentile` SQL — the
  fake mirrors its semantics and the migration is verifiable by hand. (A future
  option: a disposable-schema integration behind an env flag.)

## Risks specific to implementation

| Risk | Mitigation |
|---|---|
| `@supabase/supabase-js` pulled into the server bundle/types breaks build | Lane A isolates it behind `supabaseRunsRepo`; routes depend only on the `RunsRepo` interface. |
| `tsx` doesn't auto-load `.env` | `node --env-file=.env` on `dev`/`start`; client stays `null` when unset so tests/CI need nothing. |
| Best-effort insert hides real DB errors | Log on failure in `supabaseRunsRepo`; the graceful-degrade test asserts the game still responds, not that errors are silent. |
| Service-role key leakage | Key only in `server/.env` + Fly secret; never imported by web; no protocol field carries it. |

## Pre-work checklist (user)
- Create `server/.env` with `SUPABASE_URL=https://rdtjnwvatvowstoponbq.supabase.co`
  and the real `service_role` key (Settings → API). Needed only for Lane A's
  live smoke and the Wave 3 end-to-end — **not** for CI or the parallel lanes.
- Rotate the access token that was pasted earlier in chat.
