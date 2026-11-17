---
name: run-geooff
description: Launch the geooff game (server + web) and drive two headless Chromium players through a full match — lobby, countdown, play, mid-match refresh/reconnect, game over, rematch, leave — then both solo entry points (Home → Play solo, lone host in lobby). Use to run, screenshot, or verify the app end to end.
---

# Run geooff and play a two-player match headless

## 1. Start both processes

Ports: server `3001`, web `5173`. Install deps first if `node_modules` is missing (`npm ci` in `server/` and `web/`).

```bash
(cd server && npm run dev > "$TMPDIR/geooff-server.log" 2>&1 &)
(cd web && npm run dev -- --port 5173 --strictPort > "$TMPDIR/geooff-web.log" 2>&1 &)
timeout 40 bash -c 'until curl -sf localhost:3001/health >/dev/null && curl -sf localhost:5173 >/dev/null; do sleep 1; done'
```

The web client connects to `VITE_WS_URL` (default `http://localhost:3001`).

## 2. Drive two players

The driver is `twoplayer.mjs` next to this file. Playwright is not a repo dependency, so install it in a scratch directory and run the driver from there:

```bash
cd <scratch-dir>
npm init -y >/dev/null && npm i --silent playwright
cp <repo>/.claude/skills/run-geooff/twoplayer.mjs .
SHOTS_DIR=./shots node twoplayer.mjs   # ~75s: waits out a 1-minute round
```

It prints `PASS`/`FAIL` for each check, exits 1 if any check fails, and writes screenshots (`1-lobby-*` … `7-after-leave-*`) to `SHOTS_DIR`. **Look at the screenshots**, especially `3-playing-*` and `5-gameover-*`.

Env vars:
- `APP_URL`: defaults to `http://localhost:5173`.
- `CHROMIUM_PATH`: an explicit Chromium executable. Use it when the browser that `npm i playwright` expects isn't downloaded but an older one is cached in `%LOCALAPPDATA%\ms-playwright` (Windows) or `~/.cache/ms-playwright`. Point it at `chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell(.exe)`. Otherwise run `npx playwright install chromium`.

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

- Each player must be a **separate browser** (or at least a separate context). The reconnect token lives in `sessionStorage`, and the socket is shared app-wide.
- Both map panes are in the DOM, and CSS hides one layout. Select maps with `[data-testid="world-map"]:visible`: on desktop, `nth(0)` is your map and `nth(1)` is the opponent's.
- The input is disabled until the 3-2-1 countdown ends, so wait for it to be enabled before guessing.
- The minimum round length is 1 minute, so the game-over and rematch steps can't run faster.
- A Playwright script must not name a top-level `const URL`, because that shadows the global `URL`.
