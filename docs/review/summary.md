# Daily-dive deep review — summary

Six adversarial review passes over the `daily-dive` branch (71 files, ~9.2k
insertions). Each pass: parallel domain reviewers hunt defects → every raw
finding re-checked by an adversarial verifier that tries to refute it → survivors
hand-verified before any code changed. Looped until a pass came back clean.

## Convergence

| Pass | Focus | Confirmed | Outcome |
|------|-------|-----------|---------|
| 1 | 8 domains, full surface | 10 | 7 fixed, 1 rejected (false positive) |
| 2 | regression + deep dives | 10 | 9 fixed, 1 rejected |
| 3 | migration SQL, flow, geo, wiring | 3 | 2 fixed (own-migration artifact), 1 class rejected |
| 4 | holistic sweep | 2 | 2 fixed |
| 5 | timer-lifecycle audit + critic | 4 | 3 fixed, 1 documented |
| 6 | final convergence check | 0 | clean — loop ends |

Raw findings triaged: ~60. Confirmed by the verifier: 29. Fixed: 23 distinct
defects (+ one flaky-test root-cause fix + a helper extraction). Rejected as
false positives: 6. Accepted + documented: 1.

## Fixes by area

- **Scoring integrity** — client rounds each prompt to match the server's
  `Σ round` (total/HUD/arrival/display all agree); zero-pool name-bonus clamped
  on both client and server (`clampNamedBonus`); offline `fallbackPercentile`
  uses the real `capturePercentile` S-curve.
- **State & lifecycle** — recap guarded against a corrupt stored journey id;
  DailyPlay guards every late path after unmount (postAnswer handler, `finish()`
  report, and the settle-poll timer is now cancelled); stable submit dep;
  DailyRecap "Copied" timer via `useEffect` + cleanup, restarting per copy;
  DailyDive saves+locks via the atomic `recordFinished`; replay wallet clamped.
- **Geometry** — JourneyMap settles pending animate/wait promises on cancel so
  the travel loop can't leak a hung frame.
- **Data consistency** — share-grid tier threshold aligned to `promptTier`;
  duplicate landmark positions rejected; offline fixture re-stamped with today.
- **API / protocol** — admin catalog signals `usageAvailable`; the unreachable
  `"duplicate"` daily answer reason removed; finish IIFE handles its own
  rejection.
- **Infra** — the missing Phase 2 `daily_runs` migration added, with
  `daily_percentile` matching the test contract (`<`, integer).

## Rejected (false positives) & accepted

- Rejected: export `DAILY_DISTANCE_NAME_BONUS` to the client (it's a server-only
  distance threshold); require routes ≥3 points (2-point routes are valid and
  shipped); JourneyMap smooth-vs-linear arc model (intentional, consistent);
  admin-token timing attack (dev-only route, gated out of production); plus two
  lower-confidence items the verifier refuted.
- Accepted + documented: editing an authored set mid-run drops that run's name
  bonus — unreachable in production. See `accepted-limitations.md`.

## Verification

Every fix shipped as its own logical commit with a test where behaviour changed.
Final state: server 417 tests, web 322 unit + 6 integration, `npm run build`
clean, 0 lint errors, CI green. The flaky gauntlet integration test's real cause
(territory-fill vs an over-strict assertion) was found and fixed; stable over
repeated runs.
