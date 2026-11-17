# geooff — Test Plan

_As of 2026-11-17_

This document is the **test plan** for geooff. It describes _what_ we test, _why_,
and the concrete `describe`/`it` blocks to write. It does not contain test code —
it is the blueprint the implementation PRs follow. It is derived directly from
`shared/protocol.ts` (the wire contract) and `docs/plan-and-requirements.md` (the
requirements).

Scope: API/integration tests **and** unit tests, for **both** backend (`server/`)
and frontend (`web/`).

---

## 1. Overview & Philosophy

### What we test and why

geooff has one defining property that shapes every test: **the server is
authoritative, and the client is untrusted.** The correctness of the game and its
anti-cheat guarantee both live on the server. Our test strategy follows:

| Layer | Primary goal of its tests |
| --- | --- |
| Backend unit | Pure logic is correct in isolation: normalization, matching, clamping, scoring, winner, room-code generation, phase transitions. |
| Backend integration | The real Socket.IO/HTTP surface behaves per `protocol.ts`: correct events, correct payloads, correct recipients, correct timing. |
| Frontend unit/component | UI reacts correctly to socket events and emits the correct socket events on user actions — with a **mocked** socket (no real server). |

### Testing pyramid

Most tests are fast backend unit tests. A focused layer of backend integration
tests covers the wire protocol end to end. Frontend component tests cover UI
behavior against a mocked socket. We do **not** write full browser E2E
(two real browsers) for the MVP — see §7, Out of Scope.

### Anti-cheat is a first-class test target

The requirements state the client **never receives the answer list or unguessed
country names** — only ISO codes for countries already filled. This is not merely
an implementation detail; it is a security property, so we assert it explicitly:

- **No payload from server to client ever contains the full answer set or an
  unguessed canonical name.** The only names a client learns are:
  - `answer_result.canonical` — but **only for its own accepted guess**.
  - `game_over.missedByPlayer` — but **only after the game is over** (reveal).
- `game_started` carries `total` (a count) and `endsAt`, never the list.
- `opponent_progress` carries only `isoCode`, never the opponent's canonical text.
- `room_state.filled` / rehydrate carries only ISO codes already earned.

These assertions appear as dedicated `it` blocks flagged **[anti-cheat]** below.

### Determinism

Timer/countdown behavior is tested with **fake timers** (`vi.useFakeTimers`).
Matching is tested against a **small fixed fake category** (see §6) so tests do not
depend on the real 196-country dataset.

---

## 2. Backend Unit Tests

Pure functions and in-memory room logic. No sockets, no HTTP. Fast.

The canonical functions `normalizeAnswer` and `clampTimeLimit` live in
`shared/protocol.ts` (mirrored to `server/src/protocol.ts`); tests import from the
server mirror and are the single enforcement of the matching rule.

### 2.1 `normalizeAnswer` — `describe("normalizeAnswer")`

- [ ] `it("lowercases input")` — `"UNITED STATES"` → `"united states"`
- [ ] `it("trims leading/trailing whitespace")` — `"  france  "` → `"france"`
- [ ] `it("collapses internal whitespace")` — `"south    korea"` → `"south korea"`
- [ ] `it("strips diacritics")` — `"Côte d'Ivoire"` → `"cote divoire"`
- [ ] `it("strips punctuation")` — `"U.S.A.!"` → `"usa"`
- [ ] `it("handles the protocol's documented example")` — `"  Côte d'Ivoire! "` → `"cote divoire"`
- [ ] `it("keeps digits")` — `"g7"` → `"g7"` (guards the `a-z0-9` class)
- [ ] `it("returns empty string for whitespace-only input")` — `"   "` → `""`
- [ ] `it("is idempotent")` — `normalize(normalize(x)) === normalize(x)` over a sample set
- [ ] `it("handles non-latin/mixed scripts without throwing")` — e.g. `"日本"` does not crash (result may be `""`)

### 2.2 `clampTimeLimit` — `describe("clampTimeLimit")`

- [ ] `it("returns the value unchanged when in range")` — `300` → `300`
- [ ] `it("clamps below minimum up to MIN")` — `10` → `60` (`TIME_LIMIT_MIN_SECONDS`)
- [ ] `it("clamps above maximum down to MAX")` — `99999` → `900` (`TIME_LIMIT_MAX_SECONDS`)
- [ ] `it("accepts exactly the minimum")` — `60` → `60`
- [ ] `it("accepts exactly the maximum")` — `900` → `900`
- [ ] `it("rounds fractional seconds")` — `300.7` → `301`
- [ ] `it("returns DEFAULT for NaN")` — `NaN` → `300` (`TIME_LIMIT_DEFAULT_SECONDS`)
- [ ] `it("returns DEFAULT for Infinity / -Infinity")`
- [ ] `it("clamps negative values up to MIN")` — `-50` → `60`

### 2.3 Country matching — `describe("country matching")`

Uses the fake category fixture (§6). Matching is `Set.has(normalizeAnswer(input))`
against the accepted-answer set, returning the canonical name + ISO on a hit.

- [ ] `it("accepts an exact canonical name")` — `"France"` → accepted, iso `"fr"`
- [ ] `it("accepts a registered alias")` — `"USA"` → accepted, canonical `"United States"`, iso `"us"`
- [ ] `it("is case-insensitive")` — `"fRaNcE"` → accepted
- [ ] `it("is accent-insensitive")` — `"Côte d'Ivoire"` → accepted
- [ ] `it("rejects a non-country / wrong guess")` — `"atlantis"` → rejected, reason `"wrong"`
- [ ] `it("rejects empty input")` — `""` → rejected, reason `"empty"`
- [ ] `it("rejects a duplicate the same player already guessed")` — reason `"duplicate"`
- [ ] `it("returns the canonical name, not the typed form")` — `"usa"` → canonical `"United States"`
- [ ] `it("maps each accepted answer to a lowercase alpha-2 ISO code")` — guards the SVG-key contract
- [ ] `it("treats two different aliases of the same country as a duplicate")` — accept `"USA"`, then `"United States"` → `"duplicate"`

### 2.4 Scoring — `describe("scoring")`

- [ ] `it("starts both players at 0")`
- [ ] `it("increments only the guessing player's score on a correct answer")`
- [ ] `it("does not change score on a wrong answer")`
- [ ] `it("does not change score on a duplicate")`
- [ ] `it("tracks each player's filled ISO set independently")` — P1 and P2 can both own `"fr"`
- [ ] `it("score equals the size of that player's filled set")`

### 2.5 Winner determination — `describe("determineWinner")`

- [ ] `it("returns p1's id when p1 > p2")`
- [ ] `it("returns p2's id when p2 > p1")`
- [ ] `it("returns null on a tie")` — equal scores → `winnerId === null`
- [ ] `it("returns null on a 0–0 tie")`
- [ ] `it("computes missedByPlayer as category minus that player's filled set")`

### 2.6 Room-code generation — `describe("generateRoomCode")`

- [ ] `it("produces a code of length ROOM_CODE_LENGTH")` — `=== 6`
- [ ] `it("uses only the allowed alphabet")` — e.g. unambiguous A–Z/2–9, no `O`/`0`/`I`/`1`
- [ ] `it("is uniqueish across many generations")` — generate 10k, assert near-zero collisions
- [ ] `it("never returns a code already in use")` — mock the active-rooms map containing a code; assert regeneration

### 2.7 Settings clamping — `describe("room settings")`

- [ ] `it("defaults a new room to TIME_LIMIT_DEFAULT_SECONDS and categoryId 'countries'")`
- [ ] `it("clamps update_settings timeLimitSeconds via clampTimeLimit")` — request `99999` → stored `900`
- [ ] `it("ignores a settings change requested by a non-host")` — only host mutates settings
- [ ] `it("rejects settings changes once phase !== 'lobby'")` — settings locked at round start
- [ ] `it("keeps the existing value when update_settings omits a field")`

### 2.8 Phase transitions — `describe("phase machine")`

Legal path: `lobby → countdown → playing → ended`.

- [ ] `it("starts in 'lobby'")`
- [ ] `it("stays in 'lobby' with only one player")` — cannot start with <2 players
- [ ] `it("stays in 'lobby' unless both players are ready")`
- [ ] `it("moves lobby → countdown on start_game when 2 players both ready")`
- [ ] `it("moves countdown → playing after COUNTDOWN_SECONDS")` — fake timers, sets `endsAt`
- [ ] `it("moves playing → ended when the timer reaches endsAt")`
- [ ] `it("moves playing → ended early when all answers are named")`
- [ ] `it("rejects submit_answer while not in 'playing'")` — reason `"not_playing"`
- [ ] `it("rematch resets ended → lobby with scores cleared and filled sets emptied")`

---

## 3. Backend API / Integration Tests

Spin up the real HTTP + Socket.IO server on an ephemeral port. HTTP via
**Supertest**; WebSocket via **socket.io-client** (real clients connecting to the
real server). Each test gets a fresh server + room so tests are isolated.
Fake timers are used for countdown/timer-driven tests (see §6 harness).

### 3.1 HTTP endpoints (Supertest) — `describe("HTTP API")`

- [ ] `it("GET /health returns 200 and a JSON ok body")`
- [ ] `it("GET /api/rooms/:code returns public room state for an existing room")` — code, phase, players, settings; **no answer list** [anti-cheat]
- [ ] `it("GET /api/rooms/:code returns 404 for an unknown code")`
- [ ] `it("GET /api/rooms/:code is case-insensitive on the code")` (if codes are normalized)
- [ ] `it("never includes answers/filled canonical names in the HTTP payload")` [anti-cheat]

### 3.2 Create & join flow — `describe("create + join")`

- [ ] `it("create_room responds with joined { playerId, slot:'p1', reconnectToken, state }")`
- [ ] `it("the created room is in phase 'lobby' with one player")`
- [ ] `it("a second client join_room gets joined with slot 'p2'")`
- [ ] `it("the first client receives player_joined with the new PlayerPublic")`
- [ ] `it("join_room with an unknown code emits error_msg")`
- [ ] `it("join_room on a full (2-player) room emits error_msg")`
- [ ] `it("joined.state.total / settings are present but answer list is absent")` [anti-cheat]

### 3.3 Ready + start — `describe("ready + start_game")`

- [ ] `it("set_ready broadcasts player_ready to both clients")`
- [ ] `it("start_game is ignored (or error_msg) until both players are ready")`
- [ ] `it("start_game with both ready emits countdown to both clients")`
- [ ] `it("countdown ticks COUNTDOWN_SECONDS → ... → 1")` (fake timers)
- [ ] `it("emits game_started { categoryId, total, endsAt } to both clients")`
- [ ] `it("endsAt ≈ now + settings.timeLimitSeconds*1000 at game_started")` (tolerance window)
- [ ] `it("game_started.total equals the category size, not the answer list")` [anti-cheat]

### 3.4 Submitting answers — `describe("submit_answer")`

Two connected clients, game in `playing`.

- [ ] `it("a correct guess sends answer_result { accepted:true, canonical, isoCode } to the GUESSER only")`
- [ ] `it("a correct guess sends score_update to BOTH clients")`
- [ ] `it("a correct guess sends opponent_progress { playerId, isoCode } to the OTHER client only")`
- [ ] `it("opponent_progress contains only an isoCode, never a canonical name")` [anti-cheat]
- [ ] `it("the guesser does NOT receive opponent_progress for their own guess")`
- [ ] `it("a wrong guess sends answer_result { accepted:false, reason:'wrong' } to the guesser, nothing to the opponent")`
- [ ] `it("a duplicate guess sends answer_result { accepted:false, reason:'duplicate' }")`
- [ ] `it("an empty guess sends answer_result { accepted:false, reason:'empty' }")`
- [ ] `it("submit_answer before 'playing' sends reason:'not_playing'")`
- [ ] `it("an alias is accepted and returns the canonical name")` — `"usa"` → canonical `"United States"`
- [ ] `it("both players can independently score the same country")`

### 3.5 Game end — `describe("game_over")`

- [ ] `it("emits game_over to both clients when the timer hits endsAt")` (fake timers advance to endsAt)
- [ ] `it("game_over.winnerId is the higher scorer's id")`
- [ ] `it("game_over.winnerId is null on a tie")`
- [ ] `it("game_over.scores reflects final counts for both players")`
- [ ] `it("game_over.missedByPlayer lists ISO codes each player did NOT fill")` — the only time names are revealed [anti-cheat boundary]
- [ ] `it("ends early with game_over when all answers are named")`
- [ ] `it("rejects submit_answer after game_over")`

### 3.6 Rematch — `describe("rematch")`

- [ ] `it("request_rematch broadcasts rematch_requested { playerId }")`
- [ ] `it("rematch_start fires when both players request a rematch")`
- [ ] `it("after rematch_start the room is back in 'lobby' with scores reset")`

### 3.7 Disconnect & reconnection — `describe("disconnect + reconnect")`

Covers the reconnection spec in the requirements.

- [ ] `it("on a client disconnect, the opponent receives opponent_disconnected { playerId, graceSeconds:30 }")`
- [ ] `it("the disconnected seat is marked connected:false, not removed")`
- [ ] `it("the server-authoritative timer keeps running during a disconnect")` (fake timers) — `endsAt` unchanged
- [ ] `it("reconnect with the correct reconnectToken re-attaches to the same seat")`
- [ ] `it("reconnect sends a full room_state snapshot: scores, endsAt, filled (ISO codes), settings, phase")`
- [ ] `it("the rehydrate snapshot contains only ISO codes, never unguessed names")` [anti-cheat]
- [ ] `it("reconnect notifies the opponent with opponent_reconnected { playerId }")`
- [ ] `it("reconnect with a wrong/unknown token is rejected with error_msg (no seat hijack)")` [anti-cheat]
- [ ] `it("when the grace period expires mid-match, game_over fires and the present player wins")` (fake timers advance 30s)
- [ ] `it("when the grace period expires in the lobby, the seat is removed and the room frees up")`

### 3.8 Robustness — `describe("robustness")`

- [ ] `it("a malformed/garbage payload does not crash the server")` — handler try/catch; connection survives
- [ ] `it("events from a client not in any room are ignored safely")`
- [ ] `it("room state is deleted after the match ends and both clients leave")` — resource hygiene

---

## 4. Frontend Unit / Component Tests

`@testing-library/react` + `user-event` + `jsdom`. **The socket is always mocked**
(see §6 mock-socket harness) — no real server, no real network. Tests assert two
directions: user action → correct `emit`, and incoming event → correct UI.

### 4.1 Home — `describe("<Home>")`

- [ ] `it("renders Create and Join entry points")`
- [ ] `it("Create emits create_room with the entered player name")`
- [ ] `it("Join emits join_room with the entered code + name")`
- [ ] `it("uppercases/normalizes the room code before emitting")`
- [ ] `it("disables submit when name (or code) is empty")`
- [ ] `it("on 'joined' it navigates to the room/lobby route")`
- [ ] `it("shows error_msg content when the server rejects a join")`

### 4.2 Lobby — `describe("<Lobby>")`

- [ ] `it("renders both seats, the room code, and a share affordance")`
- [ ] `it("renders only one player when the opponent hasn't joined")`
- [ ] `it("the ready button emits set_ready { ready:true } then toggles to set_ready { ready:false }")`
- [ ] `it("reflects player_ready events on each seat")`
- [ ] `it("shows time-limit presets ONLY to the host")`
- [ ] `it("non-host sees settings as read-only")`
- [ ] `it("changing the time preset emits update_settings { timeLimitSeconds }")`
- [ ] `it("time presets cannot exceed the cap")` — UI offers no option above `TIME_LIMIT_MAX_SECONDS`; a reflected clamped value renders
- [ ] `it("Start is disabled with fewer than 2 players")`
- [ ] `it("Start is disabled unless BOTH players are ready")`
- [ ] `it("Start is enabled with 2 players + both ready, and emits start_game")`
- [ ] `it("on countdown event it shows the 3-2-1 overlay")`

### 4.3 Match — score bar — `describe("<ScoreBar>")`

- [ ] `it("renders both players' names in their fill colors (P1 emerald, P2 amber)")`
- [ ] `it("renders each player's 'X / total' count")`
- [ ] `it("updates a player's count on score_update")`
- [ ] `it("renders the shared timer and category in the center")`

### 4.4 Match — country input (accept-and-clear) — `describe("<CountryInput>")`

The accept-and-clear behavior from the requirements.

- [ ] `it("emits submit_answer { text } on Enter")`
- [ ] `it("CLEARS the field when answer_result.accepted is true")`
- [ ] `it("KEEPS the text when answer_result.accepted is false (wrong)")`
- [ ] `it("KEEPS the text and shakes/flashes on reason:'duplicate'")`
- [ ] `it("applies the shake/flash class on a rejected result and removes it after")`
- [ ] `it("does not clear optimistically before the server responds")` — only clears on the accepted result
- [ ] `it("trims and ignores an all-whitespace submit (no emit, or server returns 'empty')")`

### 4.5 Match — SVG map — `describe("<WorldMap>")`

- [ ] `it("fills a country path when its iso is in the player's filled set")`
- [ ] `it("leaves a country unfilled when its iso is NOT in the set")`
- [ ] `it("uses the player's color for their own map (P1 emerald / P2 amber)")`
- [ ] `it("renders the 'both guessed' teal blend when both own the same iso")` (if the map composites both)
- [ ] `it("adds an iso to the opponent map on opponent_progress")`
- [ ] `it("opponent map is view-only (no input / typing)")`
- [ ] `it("matches ISO codes case-insensitively against SVG keys (lowercase alpha-2)")`

### 4.6 Match — timer — `describe("<Timer>")`

Uses fake timers.

- [ ] `it("counts down toward endsAt")` — advance time, assert decreasing display
- [ ] `it("derives remaining time from endsAt (server clock), not a local duration")`
- [ ] `it("shows the coral low-time warning under a threshold")`
- [ ] `it("reaches 00:00 at endsAt and does not go negative")`
- [ ] `it("stops/freezes display when game_over is received")`

### 4.7 Match — responsive / mobile toggle — `describe("<MatchLayout> responsive")`

- [ ] `it("renders both maps side-by-side above the ~768px breakpoint")`
- [ ] `it("renders a single map + 'View opponent' toggle below ~768px")`
- [ ] `it("the toggle swaps the visible map between yours and the opponent's")`
- [ ] `it("vertical order is always score → map → input")`

### 4.8 Reconnection UI — `describe("reconnect overlay")`

- [ ] `it("shows a 'Reconnecting…' overlay on socket close (does not boot the user)")`
- [ ] `it("hides the overlay and applies the room_state snapshot on reconnect")`
- [ ] `it("rebuilds both maps from the snapshot's filled ISO codes")`
- [ ] `it("stores the reconnectToken in sessionStorage on joined")`
- [ ] `it("sends join_room with the stored reconnectToken when reconnecting")`
- [ ] `it("offers a 'Rejoin' action after giving up (grace window elapsed)")`

### 4.9 Game over screen — `describe("<GameOver>")`

- [ ] `it("announces the winner from game_over.winnerId")`
- [ ] `it("announces a tie when winnerId is null")`
- [ ] `it("shows final scores for both players")`
- [ ] `it("reveals missed countries from game_over.missedByPlayer")`
- [ ] `it("the Rematch button emits request_rematch")`
- [ ] `it("shows rematch_requested status when the opponent asks for a rematch")`

---

## 5. Test Data & Fixtures

### 5.1 Fake category

A tiny deterministic category so matching tests don't depend on the 196-country
dataset. Shape mirrors the real category loader.

```ts
// test/fixtures/fakeCategory.ts
export const fakeCategory = {
  id: "countries",
  total: 4,
  entries: [
    { iso: "fr", canonical: "France", aliases: [] },
    { iso: "us", canonical: "United States", aliases: ["usa", "america", "united states of america"] },
    { iso: "ci", canonical: "Côte d'Ivoire", aliases: ["ivory coast"] },
    { iso: "kr", canonical: "South Korea", aliases: ["korea", "republic of korea"] },
  ],
};
```

This fixture exercises: plain name, aliases, diacritics, multi-word names — enough
to cover every matching rule. `total === 4` keeps winner/missed math trivial to
assert.

### 5.2 Mock-socket harness (frontend)

A reusable fake that stands in for the Socket.IO client: records `emit` calls and
lets a test push server events into registered `on` handlers.

```ts
// test/fixtures/mockSocket.ts
export function createMockSocket() {
  const handlers = new Map<string, Function[]>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    on: (e, cb) => { handlers.set(e, [...(handlers.get(e) ?? []), cb]); },
    off: () => {},
    emit: (e, payload) => { emitted.push({ event: e, payload }); },
    // test helper: simulate a server→client event
    __server: (e, payload) => (handlers.get(e) ?? []).forEach((cb) => cb(payload)),
    __emitted: emitted,
  };
}
```

Components receive the socket via context/prop injection so tests swap in the mock.
Assertions check `__emitted` for outgoing events and call `__server(...)` to drive UI.

### 5.3 Two simulated clients (backend integration)

A helper that boots the real server and returns connected `socket.io-client`
instances plus an `awaitEvent` promise helper.

```ts
// test/fixtures/serverHarness.ts
// startTestServer() -> { url, io, close }
// connectClient(url) -> socket.io-client Socket
// awaitEvent(socket, "game_started") -> Promise<payload>  (with timeout)
```

Pattern for a two-player test: create client A → `create_room`; wait `joined`;
connect client B → `join_room` with the code; wait `player_joined` on A.

### 5.4 Fake timers

Countdown and the game timer are time-driven. All such tests use
`vi.useFakeTimers()` in `beforeEach` and `vi.useRealTimers()` in `afterEach`,
advancing with `vi.advanceTimersByTimeAsync(ms)`. For Socket.IO integration, fake
timers must be installed before the server schedules its countdown/timer; the
harness exposes a flag to opt in per test. `endsAt` assertions use a small
tolerance (e.g. ±50ms) where real wall-clock sampling is unavoidable.

---

## 6. Requirement → Test Coverage Map

| Requirement / protocol element | Covered by |
| --- | --- |
| Create room + shareable code | 3.2 create+join; 2.6 room-code; 4.1 Home |
| Join via code | 3.2 create+join; 4.1 Home |
| See opponent connect | 3.2 (`player_joined`); 4.2 Lobby |
| Both players ready-up | 3.3 ready+start; 4.2 Lobby |
| Pick category/mode | 2.7 settings; 4.2 Lobby |
| Time limit host-configurable + **server clamp to cap** | 2.2 `clampTimeLimit`; 2.7 settings; 3.3 (`endsAt`); 4.2 Lobby presets |
| Settings locked at round start | 2.7; 2.8 phase machine |
| Synced 3-2-1 countdown | 2.8; 3.3 (`countdown`); 4.2 Lobby overlay |
| Server-authoritative shared timer (`endsAt`) | 2.8; 3.3/3.5; 4.6 Timer |
| Accept-and-clear input | 4.4 CountryInput |
| Rejected/duplicate keeps text + shake | 4.4 CountryInput; 3.4 (`reason`) |
| Server-side matching: alias/case/accent | 2.1 normalize; 2.3 matching; 3.4 (`alias`) |
| Live score for both players | 2.4 scoring; 3.4 (`score_update`); 4.3 ScoreBar |
| Live opponent map progress | 3.4 (`opponent_progress`); 4.5 WorldMap |
| Map fills by ISO | 4.5 WorldMap |
| Winner determination (p1/p2/tie→null) | 2.5 determineWinner; 3.5 game_over |
| End on time up or all named | 2.8; 3.5 game_over |
| Rematch | 2.8; 3.6 rematch; 4.9 GameOver |
| **Anti-cheat: client never gets answers** | 1 (philosophy); 3.1/3.2/3.3/3.4/3.7 [anti-cheat] blocks |
| Reconnection via token + snapshot | 3.7 disconnect+reconnect; 4.8 reconnect overlay |
| Disconnect → opponent notified, timer runs | 3.7 (`opponent_disconnected`) |
| Grace expiry → present player wins | 3.7 grace-expiry |
| Reliability: bad message can't crash | 3.8 robustness |
| Resource hygiene: room teardown | 3.8 robustness |
| Responsive layout / mobile toggle | 4.7 MatchLayout responsive |
| `normalizeAnswer` contract | 2.1 |
| `clampTimeLimit` contract | 2.2 |
| ISO codes are lowercase alpha-2 (SVG keys) | 2.3; 4.5 |

Every `ServerToClientEvents` member is asserted at least once: `joined` (3.2),
`room_state` (3.7), `player_joined` (3.2), `player_left` (3.8), `player_ready`
(3.3), `opponent_disconnected`/`opponent_reconnected` (3.7), `countdown` (3.3),
`game_started` (3.3), `answer_result`/`score_update`/`opponent_progress` (3.4),
`game_over` (3.5), `rematch_requested`/`rematch_start` (3.6), `error_msg` (3.2).

---

## 7. Scope, Coverage Targets, and Running Tests

### Out of scope (for now)

- Full browser end-to-end (two real browsers / Playwright) — the integration layer
  with two `socket.io-client` instances gives most of the value cheaper.
- Load / stress testing (hundreds of concurrent rooms) — noted in requirements as a
  capacity concern, not an MVP correctness concern.
- Visual regression / pixel snapshots of the SVG map and theme colors.
- Redis / multi-instance scaling path (does not exist in the MVP).
- Real network conditions (latency, packet loss); reconnection is tested logically
  via fake disconnects, not a flaky real socket.
- Accounts, history, leaderboards (post-MVP features, no code yet).

### Coverage targets

| Area | Target |
| --- | --- |
| Matching + room-state logic (normalize, clamp, match, score, winner, phase) | **≥ 80%** lines/branches (core correctness; keep high) |
| Backend socket handlers | ≥ 70% |
| Frontend components | ≥ 70% |
| Overall | ≥ 75% |

Coverage is reported via `vitest --coverage` (v8 provider). The anti-cheat
assertions are treated as **must-not-regress** regardless of the coverage number.

### How to run

Each package has its own Vitest config; run from the package directory:

```bash
# Backend (server/)
cd server && npm test            # run once
cd server && npm run test:watch  # watch mode
cd server && npm run coverage    # with coverage

# Frontend (web/)
cd web && npm test
cd web && npm run coverage
```

A root script may fan out to both (`npm test` at the repo root → runs server then
web). Shared protocol logic is tested through the server mirror; if `shared/` grows
its own test suite, add a third `npm test` target there.

### CI note

Run both suites in CI (e.g. GitHub Actions) on every push/PR: a matrix job per
package (`server`, `web`) running `npm ci && npm test` on Node LTS. Tests must be
hermetic — ephemeral ports, fake timers, in-memory rooms, no external network — so
they pass identically locally and in CI. Fail the build on any test failure or if
coverage drops below the targets above. Because the protocol is the contract, a
protocol change that breaks a test should break CI by design.

---

## Appendix — Test case count

Enumerated `it` blocks in this plan:

| Section | Count |
| --- | --- |
| 2.1 normalizeAnswer | 10 |
| 2.2 clampTimeLimit | 9 |
| 2.3 country matching | 10 |
| 2.4 scoring | 6 |
| 2.5 winner | 5 |
| 2.6 room code | 4 |
| 2.7 settings | 5 |
| 2.8 phase machine | 9 |
| 3.1 HTTP API | 5 |
| 3.2 create+join | 7 |
| 3.3 ready+start | 7 |
| 3.4 submit_answer | 11 |
| 3.5 game_over | 7 |
| 3.6 rematch | 3 |
| 3.7 disconnect+reconnect | 11 |
| 3.8 robustness | 3 |
| 4.1 Home | 7 |
| 4.2 Lobby | 13 |
| 4.3 ScoreBar | 4 |
| 4.4 CountryInput | 7 |
| 4.5 WorldMap | 7 |
| 4.6 Timer | 5 |
| 4.7 responsive | 4 |
| 4.8 reconnect overlay | 6 |
| 4.9 GameOver | 6 |
| **Total** | **181** |
