# geofight — Daily Dive (Draft Requirements)

_As of 2026-11-25 · status: **draft for review**_

A single-player **daily** mode: one seeded set of 5 prompts per day, played as a
push-your-luck **journey** across the map. Name as many valid countries as you
can per prompt; points carry a traveler toward a fixed destination, banking gold
at landmarks. Reach the destination and you keep the gold; fall short and you
die with nothing.

Builds on today's server-authoritative design (see
[`plan-and-requirements.md`](./plan-and-requirements.md)) and reuses the existing
Gauntlet prompt engine ([`server/src/prompts.ts`](../server/src/prompts.ts)).
**Anti-cheat is unchanged: the client never receives the valid-answer list.**

> **Scope fence.** Phase 1 ships the daily loop with a **real (stateless)
> backend** — but **no database, no accounts, and no collectibles shop**.
> Everything that needs saving (gold wallet, one-attempt-per-day) lives in
> `localStorage` for now and is understood to be device-local and clearable until
> accounts land. The server contract is **designed so the DB drops in cleanly**
> later (see [Forward-compatibility](#forward-compatibility-db-ready)).

---

## Terminology

| Term | Meaning |
| --- | --- |
| **Daily set** | The 5 prompts + destination/routes for a given UTC date. Chosen **randomly on the server** and fixed for the day; the server pre-generates a rolling **7-day** window so the set is stable and identical for every player. |
| **Journey** | One of three routes (Short / Medium / Long) across the map to the same fixed destination. Chosen before play; a risk/reward dial, not a content difficulty. |
| **Distance** | Abstract travel units. Your total weighted points convert to distance covered along the chosen route. |
| **Landmark** | A waypoint on a route at a fixed fraction of its distance. Passing it banks (provisional) gold. |
| **Arrive / die** | Covering the full route distance = arrive (keep all gold). Falling short = die (lose all gold collected this run). |
| **Wallet** | Running gold balance in `localStorage`. No sink yet (shop deferred). |

---

## Core loop

1. **Entry.** A "Daily Dive" card on Home. On click, the home `OutlineMap`
   pans/zooms toward the start region and cross-fades into the mode
   (react-zoom-pan-pinch is already wired).
2. **Read the terrain.** The map shows the fixed destination and today's 5
   prompt **labels** (not answers). This is the information the journey choice is
   made on.
3. **Commit to a journey.** Pick Short / Medium / Long. This locks in the
   distance you must cover and the gold at stake — **the wager is made before you
   play**, so it's a read on your own knowledge, not blind luck.
4. **Run the 5 prompts** in sequence (feed-the-clock timer, below). Each correct
   country lights up on the board and advances the traveler.
5. **Resolve.** After prompt 5, the traveler finishes its animation along the
   route. Arrive → bank all gold. Die → lose it.
6. **Recap + share.** Points, lived/died, gold, synthetic percentile, and a
   spoiler-free shareable grid.

---

## Mechanics

### Timer — feed the clock

- **Base 20 seconds per prompt.** Resets at the start of each of the 5 prompts.
- **Each correct, not-yet-named country adds +2 seconds.** Knowledge literally
  buys survival time; a hot streak snowballs, a stall is lethal.
- The prompt ends when its clock hits 0, **or** when the player taps "next" to
  move on early. **Early-advance forfeits the remaining seconds** — they do not
  carry over. This keeps each prompt a self-contained survival race (no
  cross-prompt time banking) while still letting players skip dead air on a
  prompt they've exhausted. Duplicate/invalid answers add no time.
- Clock is **server-driven** for fairness and anti-cheat: the server validates
  each answer, so it owns the authoritative remaining time. Reuse the
  server-clock pattern already used for turn timers (`serverClock.ts`).

### Scoring — rarity-weighted + completion bonus

- **Base:** each correct country = 10 points.
- **Rarity weight:** scale by obscurity using existing data
  (`populationM` in [`countryAttributes.ts`](../server/src/data/countryAttributes.ts)),
  on a log curve, normalized so the mean answer ≈ 10 pts. Common giants (China)
  worth less; micro-states (Nauru) worth ~2–3×.
- **Completion bonus:** naming every valid answer for a prompt adds +50% of that
  prompt's full weighted pool. Rewards depth, not just the easy five.
- **Run points** = sum over the 5 prompts. Computed server-side (it owns
  `validIds`), returned to the client per-answer and as a total.

### Distance, journeys, and gold

- Each journey has a fixed **distance target** `D_short < D_medium < D_long`.
- **Distance covered** = run points × a tuned scalar (1:1 to start).
- **Landmarks** sit at fixed fractions of `D` (e.g. Short: 1.0; Medium: .4/.7/1.0;
  Long: .25/.5/.75/1.0). Passing a landmark banks its gold (provisional).
- **Gold is all-or-nothing:** realized only if distance covered ≥ `D`. Fall short
  → die → 0 gold this run, regardless of landmarks passed.
- Longer journeys carry more total gold and more landmarks, so the choice is:
  bank a modest sure thing vs. gamble on a big haul you might not reach.

| Journey | Distance | Landmarks | Total gold | Feel |
| --- | --- | --- | --- | --- |
| Short | low | 1 | modest | sure thing |
| Medium | moderate | 3 | good | the default gamble |
| Long | high | 4–5 | big | "I know my stuff" |

### Destination & routes (map)

- **One fixed destination** per day (a real city), drawn from a **hand-authored
  destination list** (city name + lat/long + three authored routes of increasing
  length to it). Routes are projected from real lat/longs via the existing
  `lonToX`/`latToY` calibration, so the trek crosses real geography. The day's
  destination is picked randomly alongside the prompts and cached in the 7-day
  window. Size the list so destinations don't repeat within a window (≥ ~20).
- Route = SVG polyline; **traveler** = a small SVG token easing along it as
  distance accrues; landmarks = waypoint pins that light up + coin-burst when
  passed.
- Destination/route geography is content, seeded by date alongside the prompts.

### End screen (v1, no DB)

Shows, for this run:

- **Lived or died** (the headline).
- **Points** (total + per-prompt breakdown).
- **Gold** earned this run and new wallet balance.
- **Synthetic percentile** — "you beat ~N% of players." Phase 1 is a
  **hardcoded** mapping from your capture ratio (your points ÷ the day's
  theoretical max) to a percentile — no statistical basis, just a plausible curve
  for the social hit. Labeled as an estimate. Phase 2 swaps it for a real
  aggregate behind the same response.
- **Share grid** — spoiler-free emoji/text recap (Wordle-style): journey chosen,
  lived/died, per-prompt capture tier.

---

## What's new vs. reused

| Concern | Reuse | New |
| --- | --- | --- |
| Prompt pool & validation | `prompts.ts` (`buildPromptPool`, `validIdsFor`), `validate.ts` | Random 5-prompt selection, fixed per day, pre-generated for a rolling 7-day window |
| Answer input + map highlight | `WorldMap`, answer bar, `matchState` | Daily-specific HUD (feed-the-clock meter, per-prompt progress) |
| Server clock | `serverClock.ts` pattern | Feed-the-clock remaining-time accounting |
| Map projection | `lonToX`/`latToY`, react-zoom-pan-pinch | Route polylines, traveler token, landmark pins |
| — | — | Scoring (rarity weight + completion), distance/gold model, synthetic percentile, share grid |
| Persistence | — | `localStorage`: gold wallet + one-attempt-per-day lock |

### Server surface (phase 1: stateless REST — no DB)

A `daily` module that **randomly generates and caches a rolling 7-day window** of
daily sets in memory at startup (regenerated as days roll over): 5 prompts drawn
at random from `buildPromptPool("countries")` per day, plus that day's
destination + three routes from the destination list. Random selection is fixed
per date so every player gets the same set; nothing is persisted to disk.

Three stateless endpoints — no per-run server memory, no sockets:

- **`GET /daily`** → today's `{ dailyDate, prompts: [{id, label}], journeys,
  destination, routes }`. Labels only; `validIds` never leave the server.
  Cacheable.
- **`POST /daily/answer`** → `{ dailyDate, promptId, answer }` → the server
  validates against `validIds` (reusing `validate.ts`) and returns `{ valid,
  iso?, name?, points?, timeBonusSec? }`. This is the only call that touches the
  secret set. The client runs the feed-the-clock timer locally and tallies
  points from these responses.
- **`POST /daily/finish`** → the completed-run result payload → the server
  returns `{ percentile }` (hardcoded curve) and echoes the normalized result for
  the client to store.

**No server-authoritative clock in phase 1** — the client owns the timer. This is
safe because nothing is persisted or ranked yet (hardcoded percentile, local
wallet), so there's no incentive to cheat timing. The only anti-cheat that
matters — keeping `validIds` secret — is preserved, since answer validity is
always a server round-trip. Phase 2 hardens timing (signed run token or move the
clock server-side) when a real leaderboard makes it worth protecting.

**Rate-limit `POST /daily/answer` per IP.** It is the only route that touches the
secret `validIds`, called once per guess — so unthrottled it is a brute-force
oracle (POST all ~197 names → learn the valid set). The socket path already
throttles `submit_answer` via a `TokenBucket` (`DEFAULT_ANSWER_LIMIT` in
`rateLimit.ts`); the Express routes currently have **no** limiter, so the daily
answer route must add one (reuse `TokenBucket` keyed by IP, or `express-rate-limit`).

### Why REST over Socket.IO (for the record)

- Express already serves stateless JSON routes in `index.ts` (`/health`,
  `/api/rooms/:code`) with `express.json()` + `cors` wired — REST is the existing
  pattern for lookups, not a new transport.
- The socket layer is entirely room/seat-centric (`seatForSocket` → `{room,
  seat}`, room broadcasts, grace/reconnect). Daily Dive is single-player with
  nothing to push, so it would need fake rooms or model-bypassing events to fit.
- Sockets' one free advantage — authoritative-clock plumbing (`time_sync`,
  `endsAt`) — is moot while the timer is client-run (phase 1), and a signed token
  covers it over REST when it matters (phase 2).

### Forward-compatibility (DB-ready)

Phase 1 has no DB, but the contract is shaped so persistence and accounts drop in
without reshaping client/server messages:

- **Stable `runId`** issued at `daily_start`, carried through to `daily_finish`.
  Phase 2 persists the run under this id; phase 1 just uses it in memory.
- **`dailyDate` key** (UTC date string) on every message — the natural partition
  key for a future `daily_runs` table and for leaderboard queries.
- **Completed-run result payload** (`{ runId, dailyDate, journey, points,
  perPrompt, gold, outcome: "arrived" | "died", playerId }`) returned at finish.
  Phase 2 writes this exact shape to the DB; phase 1 drops it into `localStorage`.
- **Anonymous identity slot:** `playerId` is `null`/a device-local anonymous id
  in phase 1. When accounts land it becomes the real account id — no new field.
- **Synthetic → real percentile:** the end screen asks the server for a
  percentile. Phase 1 computes it from a difficulty model; phase 2 swaps the
  implementation for an aggregate query over persisted runs. Same request/response.
- **Storage behind an interface:** the client reads/writes the wallet and the
  one-attempt-per-day lock through a small `DailyStore` seam. Phase 1 implements
  it on `localStorage`; phase 2 implements it against the server. Callers unchanged.

---

## Out of scope (needs accounts/db)

- Collectibles shop — gold accrues in the wallet with **no sink yet**; the recap
  says "spend soon."
- Real cross-player comparison / leaderboards (v1 uses the synthetic percentile).
- Cross-device persistence; durable one-attempt-per-day enforcement
  (localStorage is clearable — acceptable while there's no leaderboard to
  protect).

---

## Resolved decisions

- **Timer:** feed-the-clock, 20s base per prompt, +2s per correct answer.
- **Early-advance:** allowed, **forfeits** remaining seconds (no cross-prompt
  banking). Each prompt is a self-contained survival race.
- **Scoring:** rarity-weighted (log-population) + 50% completion bonus.
- **End screen:** synthetic percentile + points + lived/died + gold.
- **Backend:** real but stateless in phase 1; **no DB/accounts/shop**, contract
  designed DB-ready.
- **Server transport:** **stateless REST** (`GET /daily`, `POST /daily/answer`,
  `POST /daily/finish`). Client owns the timer; server owns validity + scoring.
- **Prompt mix:** **purely random**, fixed server-side per day — no forced
  family-spanning. Pre-generated for a rolling **7-day** window.
- **Destination list:** **hand-authored** (city + lat/long + three authored
  routes), ≥ ~20 entries so they don't repeat within a 7-day window.
- **Percentile:** **hardcoded** capture-ratio → percentile curve, no statistical
  basis, labeled an estimate.
- **Replay:** **one-and-done per day.** No practice/replay once the day's run is
  finished (enforced by the `localStorage` lock in phase 1).

## Open questions

1. **Scalar tuning:** `D_short/med/long`, points→distance scalar, landmark gold
   values, and the hardcoded percentile curve — all need playtesting against a
   few real daily sets. (Pure tuning; doesn't block building the structure.)
