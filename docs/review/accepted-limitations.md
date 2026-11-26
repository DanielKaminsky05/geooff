# Daily-dive review — accepted limitations

Findings the review surfaced that we are deliberately NOT fixing in code, with
the rationale, so they aren't re-litigated each pass.

## Editing an authored set while a player is mid-run drops that run's name bonus

If an authored daily set is edited (via `POST /daily/admin/sets`) while a player
is partway through that day, their `/daily/finish` reconciles against the *new*
set. The prompts they played are no longer in today's set, so
`clampNamedBonus(..., known=false)` returns 0 and the run loses its per-name
bonus (base capture still scores).

**Why we accept it:**

- **Not reachable in production.** The admin routes mount only when
  `DAILY_ADMIN_TOKEN` is set AND `NODE_ENV !== "production"`
  (`server/src/index.ts`), and the `/builder` page is tree-shaken from the prod
  bundle. So no one can edit a live set under a player in production. The race is
  reachable only on a local/dev machine where the author is testing.
- **The 0-bonus behaviour is the intended anti-cheat path.** "Unknown prompt →
  no name bonus" (`clampNamedBonus`) is exactly what stops a client claiming a
  bonus for prompts not in today's set. In the edit-mid-run case it fires on a
  legitimate-but-now-stale prompt; that's the same mechanism working, not a new
  bug.
- **The fixes are disproportionate.** Eliminating it would need run-scoped set
  snapshots or a set version/id threaded through the client and matched at
  finish — significant surface for a dev-only edge case — and "don't allow
  editing a published date" conflicts with the intentional edit-existing feature.

If authored-set editing ever becomes a production capability, revisit this with a
set version stamped into `DailyRunResult` and matched during reconciliation.
