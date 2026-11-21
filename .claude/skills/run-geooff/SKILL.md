---
name: run-geooff
description: Launch the geooff game (server + web) and drive headless Chromium players end to end — a 2-player race (lobby, countdown, play, refresh/reconnect, game over, rematch, leave, solo), a 3-player race (refresh + mid-game leave, rematch of the remaining two), and Last Standing + Showdown smoke runs. Use to run, screenshot, or verify the app end to end.
---

# Run geooff and drive it headless

## 1. Start both processes

Ports: server `3001`, web `5173`. Install deps first if `node_modules` is missing (`npm ci` in `server/` and `web/`).

```bash
(cd server && npm run dev > "$TMPDIR/geooff-server.log" 2>&1 &)
(cd web && npm run dev -- --port 5173 --strictPort > "$TMPDIR/geooff-web.log" 2>&1 &)
timeout 40 bash -c 'until curl -sf localhost:3001/health >/dev/null && curl -sf localhost:5173 >/dev/null; do sleep 1; done'
```

The web client connects to `VITE_WS_URL` (default `http://localhost:3001`). The server port is `PORT`.

If port 3001 is already taken (e.g. by someone's long-running `npm run dev`), or other people are editing `server/` while you test, run a private, non-watching server on another port and point the web client at it:

```bash
(cd server && PORT=3101 npx tsx src/index.ts > "$TMPDIR/geooff-server.log" 2>&1 &)
(cd web && VITE_WS_URL=http://localhost:3101 npm run dev -- --port 5173 --strictPort > "$TMPDIR/geooff-web.log" 2>&1 &)
```

## 2. Drive the players

The drivers sit next to this file. `lib.mjs` holds the shared helpers, so copy every `.mjs` file. Playwright is not a repo dependency, so install it in a scratch directory and run the drivers from there:

```bash
cd <scratch-dir>
npm init -y >/dev/null && npm i --silent playwright
cp <repo>/.claude/skills/run-geooff/*.mjs .
SHOTS_DIR=./shots/two   node twoplayer.mjs     # ~90s, waits out a 1-minute race
SHOTS_DIR=./shots/three node threeplayer.mjs   # ~90s, waits out a 1-minute race
SHOTS_DIR=./shots/modes node modes.mjs         # ~45s
```

The three scripts use separate rooms, so you can run them in parallel.

| Script | What it covers |
| --- | --- |
| `twoplayer.mjs` | Home → "Start a lobby" → join by code, read-only guest settings, ready/start gating, countdown, guesses (right, wrong, duplicate, aliases), the live opponent map, a refresh that rehydrates the player, the round timer, game over, rematch, Leave, then solo (Home → Play solo → solo setup → Start → Give up → Play again → Back to home) |
| `threeplayer.mjs` | A 3-player race: the focused map + leaderboard switcher, Bob refreshes and rehydrates, Carol leaves mid-game (closes her browser) and the others see the grace banner and play on, game over, then Alice and Bob rematch into a 2-seat lobby and start a 1-v-1 |
| `modes.mjs` | Last Standing (5s turns: host goes first, the turn passes, a duplicate keeps the turn, a timeout eliminates the player), then rematch into Showdown (Europe, 10s rounds, 1 life: the prompt banner, opponents' answers stay hidden, the fewest answers loses) |

Each script prints `PASS`/`FAIL` per check, exits 1 if any check fails, and writes screenshots to `SHOTS_DIR`, plus `error-<player>.png` on an unexpected exception. **Look at the screenshots**: `3-playing-*` and `5-gameover-*` (two), `2-focus-bob-alice` and `4-after-carol-left-alice` (three), `m2-*` and `m5-*` (modes).

Env vars:
- `APP_URL`: defaults to `http://localhost:5173`.
- `SHOTS_DIR`: defaults to `./shots`.
- `CHROMIUM_PATH`: an explicit Chromium executable. Use it when the browser that `npm i playwright` expects isn't downloaded but an older one is cached. On Windows, look in `%LOCALAPPDATA%\ms-playwright` (on this dev machine: `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1243\chrome-headless-shell-win64\chrome-headless-shell.exe`). On Linux, look in `~/.cache/ms-playwright`. Otherwise run `npx playwright install chromium`.

## 3. Stop

```bash
# Linux/macOS
lsof -ti:3001,5173 -sTCP:LISTEN | xargs -r kill
```
```powershell
# Windows
Get-NetTCPConnection -LocalPort 3001,5173 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
```

## Gotchas

- **The drivers go stale when UI text changes.** They select by role/label/testid and exact text: the "Start a lobby", "Ready up", "Start game", "Rematch" and "Accept rematch" buttons, the `Your name` label, the `Country guess` label, and the testids `world-map`, `timer`, `leaderboard-row-*`, `prompt-banner`, `my-final-score` and `opp-final-score`. When a check fails on a missing element, grep `web/src/pages/*.tsx` and `web/src/features/match/*` for the current text before you suspect the app.
- **Always pass `exact: true` to button lookups** (the `btn()` helper does). A substring match on "Ready up" also matches the host's "Waiting for everyone to ready up…".
- The lobby always renders **4 seat cards**, and each empty one says "Waiting…" / "Empty seat". Count the empty seats with `getByText("Empty seat", { exact: true })`, and never wait on "Waiting…".
- Each player must be a **separate browser** (or at least a separate context). The reconnect token lives in `sessionStorage`, and the socket is shared app-wide.
- Maps: a 1-v-1 race on desktop renders 2 maps (`nth(0)` is yours, `nth(1)` is the opponent's). Solo, 3-4 player races, and the turn-based modes render 1 map. Use `[data-testid="world-map"]:visible`. Naming one country can fill several paths/isos (France → French Guiana, Réunion…), so compare fill counts and don't assume one per guess.
- The input clears **before** the map repaints. Wait for `path[data-iso=…][data-filled="true"]` (`waitFilled`) before you assert on the map.
- The input is disabled until the 3-2-1 countdown ends. Wait for it to be enabled before guessing.
- There is **no in-match Leave button**. A player can leave mid-game only by closing the tab, which starts the 60s reconnect grace with a "<name> disconnected — waiting Ns" banner. The leaver's seat is swept when the game ends, so the leaver isn't on the 2-player final card or in the rematch lobby. A 2-player duel ends in a forfeit only after the grace expires.
- Minimum lengths: a race round lasts at least 1 minute. Turn/round time can go down to 5s, and lives down to 1. Showdown and Gauntlet aren't offered for "US states". Last Standing and Showdown aren't offered solo.
- Showdown prompts are server-side only. `modes.mjs` picks the Europe set and sprays European countries (paced under the 6/s answer rate limit) until one sticks.
- Answers are rate-limited (burst 8, then 6/s). If a driver spams guesses faster than that, they are dropped with "Slow down!".
- Under `npm run dev`, an edit to `server/` restarts the server (`tsx watch`), which drops every room. An edit to web config (tsconfig, vite config) makes Vite full-reload every open page. If a run fails with "Game unavailable — No room with code …", check the logs for a restart or a reload.
- A Playwright script must not name a top-level `const URL`, because that shadows the global `URL`.
