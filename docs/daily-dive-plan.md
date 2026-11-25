# geofight — Daily Dive Implementation Plan (Phased, Parallel-First)

_As of 2026-11-25 · companion to [`daily-dive-requirements.md`](./daily-dive-requirements.md)_

The feature splits cleanly into one small **contract foundation** that must land
first, then **five independent tracks** that can be built concurrently (ideally
in isolated worktrees), then a thin **integration + verification** pass. The
whole point of the shape below is that no two parallel tracks touch the same
file — collisions are confined to the foundation (lands first) and integration
(lands last).

## Dependency graph

```
                         ┌─────────────────────────────┐
                         │ PHASE 0 — Contract foundation│   (serial, small, lands on main first)
                         │ shared types · route stubs · │
                         │ fixtures · DailyStore iface   │
                         └──────────────┬───────────────┘
                                        │  everything below branches off this
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼
   ┌─────────┐   ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────┐
   │ A server │   │ B content │   │ C play flow│   │ D map/   │   │ E recap/ │
   │ logic    │   │ destinations│  │ + API +    │   │ travel   │   │ share +  │
   │ + scoring│   │ + routes    │  │ store      │   │ visuals  │   │ wallet   │
   └────┬─────┘   └─────┬──────┘   └─────┬──────┘   └────┬─────┘   └────┬─────┘
        └───────────────┴───────────────┴───────────────┴──────────────┘
                                        ▼
                         ┌─────────────────────────────┐
                         │ PHASE 2 — Integration + verify│  (serial, thin)
                         │ mount routes · router · Home  │
                         │ entry · swap mocks · build+test│
                         └─────────────────────────────┘
```

Tracks A–E depend **only on Phase 0's contract**, never on each other. C/D/E each
own distinct files under `web/src/features/daily/`; A/B own distinct files under
`server/src/daily/`. That's what makes them safe to run in parallel worktrees.

---

## Phase 0 — Contract foundation (serial, must land first)

Small and fast; its only job is to unblock everyone by freezing the interfaces
and shipping mocks so client tracks don't wait on the server.

**Files (all new except the shared protocol):**

- `shared/protocol.ts` (edit) — add the daily wire types:
  - `DailyPrompt { id, label }`
  - `DailyJourney { id: "short"|"medium"|"long", distance, landmarks: {atFraction, gold}[] }`
  - `DailyDestination { name, lat, lon }` + `DailyRoute { journeyId, points: {lat,lon}[] }`
  - `DailySet { dailyDate, prompts: DailyPrompt[], journeys, destination, routes }`
  - `DailyAnswerReq/Res`, `DailyFinishReq/Res` (incl. `percentile`), and the
    DB-ready `DailyRunResult { runId, dailyDate, journey, points, perPrompt, gold, outcome, playerId }`.
- `server/src/daily/types.ts` (new) — server-internal types (compiled set with
  per-prompt `validIds`, scoring config).
- `server/src/daily/routeStubs.ts` (new) — the three Express handlers wired to
  **throwaway stub logic** + mounted behind a `registerDailyRoutes(app)` export,
  so A can flesh them out and Phase 2 just calls `registerDailyRoutes`.
- `web/src/features/daily/contract.ts` (new) — re-export of the shared types +
  **a static fixture `DailySet`** (one hand-written day) so C/D/E develop against
  real-shaped data with zero server dependency.
- `web/src/features/daily/DailyStore.ts` (new, interface + localStorage impl) —
  `getWallet()/addGold()/isPlayedToday()/markPlayed()/saveResult()`; callers only
  see the interface.

**Done when:** types compile across `shared`/`server`/`web`, the fixture imports
cleanly, and the stub routes return fixture-shaped JSON. Land on `main`.

---

## Parallel tracks (all branch off Phase 0)

### Track A — Server daily logic + scoring  _(backend only)_
Owns `server/src/daily/*` (except `types.ts`/`routeStubs.ts` from Phase 0).
- `window.ts` — random 5-prompt selection from `buildPromptPool("countries")`,
  **fixed per UTC date**, pre-generated rolling 7-day window (regenerate as days
  roll). Pure, no I/O.
- `scoring.ts` — rarity weight (log `populationM` from `countryAttributes.ts`,
  normalized mean ≈ 10) + 50% completion bonus. Returns per-answer + totals.
- `percentile.ts` — hardcoded capture-ratio → percentile curve.
- `routes.ts` — real handlers for `GET /daily`, `POST /daily/answer` (validates
  via `validate.ts`/`validIdsFor`, **rate-limited per IP** reusing `TokenBucket`
  from `rateLimit.ts`), `POST /daily/finish` (totals + percentile + echo result).
- Tests: `server/test/daily.test.ts` (determinism of the day's set, scoring,
  rate-limit drop, `validIds` never serialized).

### Track B — Destinations + route content  _(pure data)_
Owns `server/src/daily/destinations.ts`.
- ≥ ~20 hand-authored destinations (city + lat/lon) each with three authored
  routes (short/medium/long polylines of real waypoints) + landmark placements.
- Small validation test: every route ends at its destination; ≥20 entries so no
  repeat within a 7-day window.
- (Track A's `window.ts` consumes this; the **shape** is fixed in Phase 0, so B
  and A run concurrently — A codes against the type, B fills the data.)

### Track C — Play flow + API client + store wiring  _(client)_
Owns `web/src/features/daily/{dailyApi.ts, useFeedClock.ts, JourneySelect.tsx,
DailyPlay.tsx}` and the page container `web/src/pages/DailyDive.tsx`.
- `dailyApi.ts` — `fetch` wrappers for the three routes (against the stub in dev).
- `useFeedClock.ts` — 20s base, +2s per accepted answer, early-advance **forfeits**
  remainder; emits time-up. Unit-tested in isolation.
- `JourneySelect.tsx` — shows the 5 labels + destination, three journey cards.
- `DailyPlay.tsx` — the 5-prompt loop reusing the existing answer input + map
  highlight; drives the clock; accumulates points.
- `DailyDive.tsx` — orchestrates phases (select → play → recap) and composes the
  D/E components via props (defines the slots so D/E never edit this file).

### Track D — Map / travel visuals  _(client)_
Owns `web/src/features/daily/JourneyMap.tsx` (+ any small helper it needs).
- Route polyline(s) projected via existing `lonToX`/`latToY`; a traveler SVG
  token easing along the active route by a `progress: 0..1` prop; landmark pins
  that light up + coin-burst when passed. Pure presentational — driven entirely
  by props (`route`, `progress`, `passedLandmarks`), so it's trivially storybook-
  able against the fixture and never touches play logic.

### Track E — Recap + share + wallet surface  _(client)_
Owns `web/src/features/daily/{DailyRecap.tsx, shareGrid.ts}`.
- `DailyRecap.tsx` — lived/died headline, points (total + per-prompt), gold +
  new wallet balance (via `DailyStore`), synthetic percentile line.
- `shareGrid.ts` — spoiler-free emoji/text recap (journey, lived/died, per-prompt
  capture tier). Unit-tested.
- Reads `DailyStore` (Phase 0) — no dependency on A/C internals.

---

## Phase 2 — Integration + verification (serial, thin)

Only here do we touch the few **shared** files, one time, to avoid parallel
collisions:
- `server/src/index.ts` — call `registerDailyRoutes(app)` (one line in the HTTP
  section next to `/health`).
- `web/src/App`/router — add the `/daily` route to `DailyDive`.
- `web/src/pages/Home.tsx` — add the "Daily Dive" entry card + the pan/zoom
  cross-fade into the mode.
- Swap `dailyApi` from stub to the real routes; delete the throwaway stub logic.
- Full check: `npm run build` (web) + `tsc --noEmit` (server) + `npm test` both
  sides. Per the repo rule, **gate on `npm run build`, not just typecheck.**

---

## How to run the parallelism

1. Land **Phase 0** on `main` first (small, serial). Everything else branches
   from it so each worktree has the frozen contract + fixtures.
2. Launch **A, B, C, D, E as five background agents in isolated git worktrees**
   (`isolation: "worktree"`, each branched off the Phase-0 commit). File
   ownership above guarantees no two edit the same file, so merges are clean.
   - Natural pairing if fewer lanes are wanted: **A+B** (one backend agent),
     **C** (play), **D** (map), **E** (recap) → four lanes; or A, B, (C+D+E) → three.
3. Merge A–E back to `main` in any order (no inter-dependencies).
4. Do **Phase 2** serially as the single integrating pass, then verify.

**Critical path** = Phase 0 → (longest of A–E, likely C or D) → Phase 2. With the
tracks truly concurrent, wall-clock ≈ foundation + one track + integration, not
the sum.

**Commit discipline:** each track is its own logical commit (or a few) per the
repo's commit-splitting rule; co-author line on every commit.
