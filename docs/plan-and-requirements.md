# geofight — Plan & Requirements

_As of 2026-11-17_

## Overview

geofight is a two-player head-to-head lobby for geography naming games: two
players join a room and race to name more items in a category (countries of the
world, capitals, US states, flags) before a shared timer runs out. Each player
sees the other's live score, and a winner is declared at the end with a rematch
option.

The defining technical trait is that it is **real-time multiplayer** — both
players act simultaneously and must see each other's progress live. That
requirement drives every architecture decision below.

## Tech Stack & Architecture

The app splits into two independently deployed pieces: a static client and a
real-time game server. This separation is chosen deliberately over an
all-in-one Next.js app, because the real-time backend needs long-lived
WebSocket connections that serverless Next.js hosts (Vercel) cannot provide —
so a unified framework buys no deployment saving here.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vite + React (SPA) | Client-only game UI; no SSR/SEO needed. Builds to static files — cheapest, simplest to host. |
| Backend | Standalone Node WebSocket server (`ws`, Socket.IO, or PartyKit) | Holds authoritative game rooms; needs persistent connections. |
| Game state | In-memory on the server | Short-lived per-match data; fast. No DB for MVP. |
| Category data | Static JSON (countries, capitals, aliases) | Loaded once at server startup into a lookup Set. |
| Map rendering | Pre-made SVG world map (countries as `<path>` with ISO ids) | Fill a country by setting `fill`; crisp vector zoom; free hover/click via DOM; theme-styleable. Zoom/pan via a lightweight helper (`react-zoom-pan-pinch`). |
| Database | None for MVP | Added only when data must outlive a match (accounts, history, leaderboards). |

**Key principle: the server is authoritative.** Answer validation happens
server-side against the accepted-answer list; the client never holds the answer
set (anti-cheat). Answer matching uses an O(1) `Set.has(normalize(input))`
lookup, not per-keystroke fuzzy scanning, to keep CPU near-idle.

## Deployment

Two pieces deploy to two places. The frontend is static, the backend is a
long-running process.

| Piece | Where | Notes |
| --- | --- | --- |
| Frontend (Vite `dist/`) | Netlify (preferred) or Vercel / Cloudflare Pages | Push to GitHub → auto-detects Vite → live in ~2 min, auto-deploys on every push. Free. |
| Backend (Node WS server) | AWS EC2 free-tier `t2.micro` | 750 hrs/month free for 12 months. Chosen to start; Railway/Render are easier but sleep (Render free) or cost ~$5/mo (Railway). |

**Required config:**

- **SPA routing** — Netlify `public/_redirects` with `/*  /index.html  200` so
  refreshing `/game/ABCD` doesn't 404.
- **WebSocket URL via env var** — `VITE_WS_URL=wss://<backend-host>` set in the
  host dashboard; must be `wss://` (secure) since the site is served over HTTPS.
- **TLS on EC2** — put Caddy or nginx + Let's Encrypt in front of Node to serve
  `wss://`; needs a domain. (Railway/Render give this for free.)
- **Process manager** — run under `pm2` so the server auto-restarts on crash.

**EC2 `t2.micro` capacity:** the bottleneck is CPU, not player count. With
efficient matching the instance stays near-idle and comfortably handles a few
hundred concurrent players, likely into the low thousands. At 2 players/room
that is hundreds of rooms. Starting small is correct — resizing the instance
later is a 5-minute stop/change/start. Watch CloudWatch CPU, RAM, and CPU
credit balance for the day real usage grows.

## Functional Requirements

**Lobby & matchmaking**

- Create a game and get a shareable room code or link
- Join a game via code/link
- See the opponent connect; both players ready-up before start
- Pick a game mode / category

**Room customization (host-configurable in the lobby)**

- **Time limit** — host picks the round length, constrained to a fixed range
  (**min 1 min, max 15 min**, default 5 min). Enforced server-side — the client
  can request a value but the server clamps it to the cap, so a bad/hacked
  client can't set an unbounded timer.
- **Category / map** — host picks the game mode (countries at MVP). _Future:_
  other maps/categories (capitals, US states, flags, regions) and per-map
  options.
- _Future customization ideas:_ sudden-death mode, hints on/off, allow/disallow
  common aliases, region-only maps (e.g. Europe only).
- Settings are locked once the round starts; changing them requires a rematch
  or a new round.

**Gameplay**

- Shared round start with a countdown synced to both players
- Each player types answers into their own input
- **Accept-and-clear input:** when a submitted name matches an accepted answer,
  the server accepts it, that country lights up in the player's color, and the
  input bar **empties** ready for the next guess (e.g. type `usa` → accepted →
  USA fills → input clears). Rejected or duplicate guesses leave the text in
  place (with a brief shake/flash) so the player can edit it.
- Server-side fuzzy/alias matching ("USA" = "United States", accents, casing, typos)
- Live score and count for both players, updated in real time
- Shared timer, and an end condition (time up, or all items named)
- Winner determination at round end
- Rematch button

**Content / data**

- Authoritative lists per category with accepted aliases (countries, capitals, states, flags, rivers)
- Normalization rules for matching

**Nice-to-haves (post-MVP)**

- Accounts, win/loss history, leaderboards
- Spectators and more than 2 players per room
- In-room chat and emotes
- More categories and timed/sudden-death variants

## Non-Functional Requirements

- **Low latency** — score updates should feel instant (<100ms); WebSockets, not polling.
- **Anti-cheat** — the server is authoritative; the client never receives the
  answer list, and all validation runs server-side.
- **Consistency** — one authoritative copy of each room's state on the server
  prevents the two clients from diverging.
- **Reliability** — handle player disconnects and reconnects gracefully; wrap
  message handlers in try/catch so one bad message can't crash the process; run
  under `pm2` for auto-restart.
- **Resource hygiene** — delete room state and close sockets when a match ends;
  leaked rooms, not active players, are what exhaust a small instance.
- **Single point of failure (accepted for MVP)** — one instance means a crash
  drops everyone; acceptable now, addressed in the scaling path.

## Reconnection

A WebSocket connection is disposable (wifi blip, phone sleep, tab refresh); the
player's **seat in the room is not**. Reconnection re-attaches a new socket to
an existing seat, linked by a secret token.

**Flow**

1. **On join** — server creates the seat and returns a `reconnectToken` tied to
   it; the client stores it in `sessionStorage` (survives refresh, per-tab).
2. **On disconnect** — server does not delete the seat. It marks it
   `disconnected`, starts a grace-period timer, tells the opponent
   (`opponent_disconnected { playerId, graceSeconds }`), and **keeps the game
   running** — the server-authoritative timer keeps ticking, the absent
   player's score frozen.
3. **On reconnect** — client opens a new socket and sends `join_room` with the
   `reconnectToken`. Server validates it, re-attaches to the disconnected seat,
   and sends a **full `room_state` snapshot** (scores, `endsAt`, each player's
   filled countries, settings, phase) so the client rebuilds the maps without
   replaying events. Opponent gets `opponent_reconnected`.
4. **If the grace period expires** — in a match, the match ends and the present
   player wins; in the lobby, the seat is removed and the room frees up.

**Why a token:** without a secret, anyone with the room code + a name could
hijack a seat; the token proves "same person returning" and distinguishes a
refresh from a new joiner. Never put the answer list or anything cheat-relevant
in the snapshot — only each player's already-filled ISO codes.

**Client behavior:** on socket close, show a "Reconnecting…" overlay (don't
boot the user) and auto-retry with backoff (0.5s, 1s, 2s, 4s…) up to the grace
window; on success swap in the snapshot and hide the overlay; on giving up,
offer "Rejoin" back to `/room/:code`.

**In-memory constraint:** reconnection works while the server process stays up.
If it restarts/crashes, rooms (and tokens) are gone — the single-instance
tradeoff. At scale, Redis holds room state and the token→seat mapping so any
instance can rehydrate any player (this is the main reason sticky sessions /
shared state matter).

**Defaults**

| Decision | Default |
| --- | --- |
| Grace period | 30s |
| Timer during disconnect | Keeps running (no pause — prevents stalling) |
| Grace expires mid-match | Present player wins |
| Token storage | `sessionStorage` (per-tab) |

## MVP Scope

The minimal first slice that proves the core loop:

1. One game mode: name all countries of the world
2. Create room → share code → two players join → 3-2-1 countdown
3. Shared 5-minute timer
4. Server-side matching with aliases + live count for both players
5. Winner screen + rematch button
6. No accounts, no database, single server instance, in-memory rooms

Nail this loop first, then layer on more categories, then accounts and a
leaderboard (that is when a database enters).

## Scaling Path

The MVP design (one instance, in-memory rooms) has a hard ceiling: you cannot
add a second instance, because two players might land on different machines and
not see each other. The scaling story is staged:

1. **Now** — 1 EC2 `t2.micro`, in-memory rooms → hundreds to low-thousands of
   players. Easy.
2. **When usage grows** — resize the instance (micro → small → medium), a
   5-minute stop/change/start. Buys more headroom on the same single-instance
   design.
3. **When one instance isn't enough** — add **Redis** for shared room state +
   pub/sub, run multiple Node instances behind a load balancer. Effectively
   unlimited.

Building efficient matching and clean room teardown now means the jump to Redis
later is additive, not a rewrite. Decide early with sticky sessions or
Redis-backed rooms so the single → multi-instance move stays clean.

## Visual / Theme Direction

Reference: the classic "name all the countries" quiz layout (see `world.png`
and `world_completed.png`) — a timer, an "Enter country's name here" input, a
give-up button, a live `X / 196 guessed` counter, and a world map where each
correct country fills in. geofight keeps that familiar layout but renders two
players racing on the same map at once.

**Direction:** take that light blue-ocean / yellow-land scheme and move it to a
**darker, tasteful** palette — deep ocean, muted land, no glare — with correct
countries lighting up in a clear fill. Keep it palatable: desaturated base,
one or two vivid accents, not neon.

| Role | Color | Hex | Notes |
| --- | --- | --- | --- |
| Ocean / background | Deep navy slate | `#0F1B2A` | Replaces the bright sky-blue ocean; low glare. |
| Land (unguessed) | Muted slate | `#2B3A4D` | Readable borders, no yellow glare. |
| Country borders | Soft gray-blue | `#415169` | Subtle separation between countries. |
| Player 1 fill (correct) | Emerald green | `#3FB950` | Keeps the original "correct = green" cue. |
| Player 2 fill (correct) | Amber | `#E3A008` | Distinct second racer; the muted nod to the old yellow. |
| Both guessed it | Teal blend | `#1F9E8E` | When both players have named the same country. |
| Primary text | Off-white | `#E6EDF3` | High contrast on the dark background. |
| Muted text / labels | Gray | `#8B98A5` | Counters, secondary labels. |
| Timer / alert accent | Warm coral | `#F0623E` | Timer, low-time warning, errors. Palatable, not harsh red. |
| Panel / input surface | Raised slate | `#1A2838` | Input box, score panels, buttons. |

**Principles**

- Dark but not pure black — navy base is easier on the eyes for a timed game.
- Each player gets one consistent fill color used everywhere (their map fills,
  their score, their name) so the race reads at a glance.
- Reserve the coral accent for time pressure and errors so it stays meaningful.
- Maintain WCAG-AA contrast for text on dark surfaces.

_Colors are a starting proposal — easy to shift the exact hues once we see it
rendered._

## Screen Layout & Responsive Design

Both players see their own map and their opponent's; how they're arranged
depends on screen size. The vertical order is always the same: **score (top) →
map (middle) → country input (bottom).**

**Top — score bar (all sizes)**

- Both players' scores shown together: name + live `X / 196` count, each in
  that player's fill color (P1 emerald, P2 amber).
- Shared timer and category in the center.

**Middle — map**

- Desktop/laptop: **your map and your opponent's map side by side**, each with
  independent **zoom and pan** (zoom into a dense region like Europe or the
  Caribbean). Optional sync-zoom toggle so both maps zoom together.
- Mobile: **your map full-width**, with a **toggle button** ("View opponent")
  to swap to the opponent's map and back.

**Bottom — country input**

- A single text field spanning the width, where you type country names.
- Accept-and-clear: a correct guess fills the country and empties the field
  (see Gameplay); rejected/duplicate guesses keep the text with a shake/flash.
- On mobile the input stays pinned at the bottom above the keyboard.

Opponent's map is view-only (you can't type on it). Layout breakpoint:
single-map + toggle below ~768px, side-by-side above.

Each map fills countries in that player's color in real time as the players
guess.
