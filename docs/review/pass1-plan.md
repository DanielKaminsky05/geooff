# Daily-dive deep review — pass 1

Adversarial bug-hunt across the whole `daily-dive` surface (71 files, ~9.2k
insertions): 8 parallel domain reviewers → every raw finding re-checked by an
adversarial verifier that tries to *refute* it → the survivors re-verified by
hand here before any code changed.

Raw findings: 22. Auto-refuted: 12. Hand-confirmed below: 7 (one auto-confirmed
finding was rejected on manual review — see "Rejected").

## Rejected after manual verification

- **Export `DAILY_DISTANCE_NAME_BONUS` for the client (`contract.ts`)** — FALSE
  POSITIVE. The 5× distance bonus is used *only* server-side in
  `distanceScoreMax()` to set each journey's `distance` threshold, which is then
  shipped to the client inside the `DailySet`. The client never recomputes
  distance; it compares `points >= journey.distance`. Its `promptScore()`
  correctly uses `DAILY_NAME_BONUS` (10×), exactly matching the server's scoring
  (`routes.ts:252`). Adopting the finding would *introduce* a client/server
  mismatch. No change.

## Phase 1 — Scoring integrity (highest value)

1. **Per-prompt rounding mismatch** (`DailyDive.tsx` `promptScore`, HIGH).
   `captureBase()` returns a fractional value; the client did `round(Σ score)`
   while the server does `Σ round(score)` (`routes.ts:253,263`). These diverge
   by a point or two, and the per-leg reveal (rounds each) didn't sum to the HUD
   total (rounds the sum). It also made the *local* arrival check
   (`DailyDive.tsx:233`, raw sum ≥ distance) disagree with the server's
   (rounded sum ≥ distance). Fix: round inside `promptScore` so total, HUD,
   arrival, progress, and per-leg display all equal the server's `Σ round`.
   Export it and pin the invariant with a test.

2. **Name bonus not clamped for a zero-pool prompt** (`routes.ts:245`, HIGH /
   defensive). `if (total > 0) named = min(named, total)` skips the clamp when a
   *known* prompt has an empty pool, letting a client-supplied `named` inflate
   the bonus. Fix: clamp unconditionally for known prompts (`min(named, total)`
   is 0 when the pool is empty). Add a server test.

## Phase 2 — Client robustness

3. **Recap crash on a corrupt stored journey id** (`DailyDive.tsx:69-72,487`,
   MEDIUM). `pick()` uses `.find()!`; `recapResult.journey` comes from
   unvalidated `localStorage` JSON. An out-of-range id makes `journey` undefined
   and `journey.distance` throws a white-screen. Fix: harden `pick()` to fall
   back safely (never return undefined) + test.

4. **Late `setState` after unmount in `DailyPlay`** (MEDIUM→LOW on React 19).
   React 19 ignores post-unmount `setState` (no warning/crash), so this is
   hygiene, not the high-severity bug claimed. Fix: a cheap mounted guard so the
   async answer handler no-ops after unmount.

## Phase 3 — API / protocol hygiene

5. **Admin catalog hides a usage-lookup failure** (`adminRoutes.ts:75-97`,
   MEDIUM, dev-only). On a `repo.list()` error the catalog still returns 200 with
   every prompt's `usedOn: []`, so the builder shows used prompts as free. Fix:
   return `usageAvailable: false` and warn in the builder.

6. **Unreachable `"duplicate"` daily answer reason** (`*/protocol.ts:401`,
   MEDIUM, type hygiene). Daily dedup is client-side; the server never sends
   `duplicate` on `DailyAnswerRes`. Fix: drop it from that union (leave the
   main-game `AnswerRes` union at line 102 untouched).

## Phase 4 — Polish

7. **`DailyPlay.handleSubmit` recreated every 100ms** (`useFeedClock`, LOW).
   The clock object changes each tick (`secondsLeft`), and `handleSubmit`
   depended on the whole object. Fix: depend on the stable `clock.addTime`.

8. **Builder save confirmation instantly overwritten** (`Builder.tsx:215`,
   MEDIUM, dev-only). `submit()` sets the success message, then `load()` sets
   "Loading catalog…" over it. Fix: refresh silently and keep the success line.

## Execution

One logical commit per fix (per the repo's commit-splitting preference), each
with a test where behaviour changed, gated on `tsc` + `npm run build` (web) and
the server/web test suites. Then a second review pass to catch anything missed,
looping until a pass is clean.
