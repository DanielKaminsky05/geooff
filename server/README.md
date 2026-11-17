# geooff — game server

Real-time backend for **geooff**, a two-player geography face-off. Authoritative
Node + TypeScript server using Express (HTTP) and typed Socket.IO (WebSocket).

The server owns all game state: it validates answers against a server-side
country list (clients never receive the answer set), runs the shared countdown,
and owns the round timer via an authoritative `endsAt` timestamp.

## Requirements

- Node 18+ and npm.

## Install

```bash
npm install
```

## Scripts

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Dev server with reload (`tsx watch`).          |
| `npm run build`     | Compile TypeScript to `dist/` (`tsc`).         |
| `npm start`         | Run the compiled server (`node dist/index.js`).|
| `npm test`          | Run the Vitest unit tests once.                |
| `npm run typecheck` | Type-check with no emit.                        |

## Run

```bash
npm run dev        # http://localhost:3001
```

Port is `process.env.PORT ?? 3001`. Copy `.env.example` to `.env` to override.
CORS allows all origins (the Vite client runs at http://localhost:5173 in dev).

## HTTP endpoints

- `GET /health` → `{ ok: true }`
- `GET /api/rooms/:code` → `{ exists, status, playerCount }`

## Socket.IO

The wire contract is defined in `src/protocol.ts` (mirror of
`../shared/protocol.ts`). The server is created as
`new Server<ClientToServerEvents, ServerToClientEvents>()` and emits/listens for
exactly those typed events. Core happy path:

```
create_room / join_room → set_ready → start_game
  → countdown (3,2,1) → game_started → submit_answer* → game_over
```

## Answer matching

- `src/data/countries.ts` holds `{ iso, name, aliases }` for the 193 UN members
  plus Vatican City, Palestine, Kosovo and Taiwan. `iso` is ISO 3166-1 alpha-2
  **lowercase** to match the frontend SVG map keys.
- At startup a `Map<string, iso>` is built from `normalizeAnswer(name)` and each
  `normalizeAnswer(alias)`. Matching is O(1) `Map.get`.
- `normalizeAnswer` lowercases, strips diacritics and punctuation, and collapses
  whitespace, so `"USA"`, `"united states"`, `"Côte d'Ivoire"` all resolve.
- The matching/scoring logic lives in the pure, tested `src/matching.ts`.

## Tests

`npm test` covers `normalizeAnswer`, `clampTimeLimit`, country
matching/scoring (correct / alias / wrong / duplicate / empty) and winner
determination (p1>p2, p2>p1, tie→null).
