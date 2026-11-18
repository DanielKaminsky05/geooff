# geofight — Game Modes Expansion (Draft Requirements)

_As of 2026-11-18 · status: **draft for review**_

Two additions to the game, independent but sharing some plumbing:

- **A. More geography sets** — play the existing timed race over sets other than
  world countries: US states, Canadian provinces, and other polities.
- **B. "Last Standing" (turn-based lives) mode** — players alternate naming
  items against a configurable per-turn clock; running the clock out costs a
  life, last player with lives left wins.

Both build on today's server-authoritative design (see
[`plan-and-requirements.md`](./plan-and-requirements.md)). Nothing here changes
the anti-cheat stance: the client still never receives the answer list.

---

## Terminology

| Term | Meaning |
| --- | --- |
| **Set** (a.k.a. category) | A named collection of answerable items — e.g. "World countries", "US states". Today's only set is `countries`. |
| **Item** | One answerable entry in a set (a country, a state…) with a canonical name + aliases. |
| **Map key** | The id that links an item to a region in an SVG map. Today this is the ISO alpha-2 code (`us`, `fr`). Generalized below to `itemId`. |
| **Race mode** | The current game: both players name simultaneously against one shared timer; most items wins. |
| **Last Standing mode** | New turn-based elimination game (feature B). |

---

## A. More geography sets

### Goal

Let the host pick *what* to name, not just how long. Ship at least: World
countries (done), **US states**, **Canadian provinces/territories**, plus a
couple of "other polity" sets. Each set plays the existing race exactly as today
— shared timer, live opponent progress, winner by count.

### What's hardcoded today (and must generalize)

| Location | Current state | Needed change |
| --- | --- | --- |
| `protocol.ts` → `CategoryId` | Union of just `"countries"` | Add the new set ids (or make it a validated `string`). |
| `server/src/matching.ts` | Imports `countries` directly; `total` and `allIsoCodes` are module-level constants | Become per-set; resolve by the room's `categoryId`. |
| `server/src/index.ts` | Builds **one** `lookup`/`canonicalNames` per process; `KNOWN_CATEGORIES = ["countries"]` | Build (or lazily cache) a lookup **per set**; validate against the real registry. |
| `server/src/data/countries.ts` | `Country { iso, name, aliases }` | Generalize to `AnswerItem { id, name, aliases }`; one data file per set. |
| `web/src/lib/worldMap.ts` | Hardcodes `@svg-maps/world` | A **map registry**: `categoryId → { svg, viewBox }`, plus a map-less fallback. |
| `web/src/components/WorldMap.tsx` | Always renders world paths | Render the active set's map; render a list/grid view for map-less sets. |

### Proposed sets

| Set id | Label | Items | Map | Notes |
| --- | --- | --- | --- | --- |
| `countries` | World countries | ~197 | `@svg-maps/world` | Exists today. |
| `us-states` | US states | 50 | `@svg-maps/usa` | Decide: include DC / territories? (default: 50 states only.) |
| `ca-provinces` | Canadian provinces & territories | 13 | SVG **to source** | Verify an SVG map package exists; else map-less or ship our own. |
| `world-capitals` | World capitals | ~197 | map-less (list/grid) | "Other polity": names, no per-item region to fill. |
| `us-capitals` | US state capitals | 50 | reuse `us-states` map? | Capital → fills its state region, or map-less. (Decide.) |

"Other polities" is open-ended — the table above is a proposal. Final list is an
[open question](#a-open-questions).

### Data model

Generalize the per-set data file:

```ts
export interface AnswerItem {
  id: string;        // map key (lowercase). For map-less sets, a stable slug.
  name: string;      // canonical display name
  aliases: string[];
}
```

`countries.ts` keeps its ISO ids (they're already valid map keys). A set
**registry** ties it together:

```ts
interface GeoSet {
  id: CategoryId;
  label: string;
  items: AnswerItem[];
  hasMap: boolean;
  mapId?: string;    // which SVG map the frontend uses
}
```

### Server changes

- A `sets` registry (id → `GeoSet`) replacing the single `countries` import.
- `buildLookup`/`buildCanonicalNames`/`total`/`allIds` become **functions of a
  set** (or a small per-set cache built at startup). `matchAnswer`/`scoreGuess`
  stay pure — they already take `lookup`/`canonicalNames` as args.
- `start_game` / `game_started` resolve totals from the room's set; the
  end-early check (`seat.filled.size >= total`) uses the set's total.
- `update_settings` validates `categoryId` against the registry (not a literal
  array).

### Frontend changes

- **Map registry** keyed by `categoryId`. `game_started` already carries
  `categoryId`, so the client picks the right SVG + viewBox.
- **Map-less sets**: when `hasMap` is false, swap the SVG pane for a
  progress/list view (we already have `NamedCountries`-style grouped lists to
  reuse) so the "fill a region" UI degrades to "fill a slot."
- Lobby gains a **set picker** (host-only, lobby-only, locked once started) next
  to the existing time picker.
- The wire field `isoCode` is really a map key; generalize to **`itemId`**
  across `protocol.ts` and both mirrors (see [Cross-cutting](#cross-cutting)).
  The grouping in `NamedCountries` ("by continent") is countries-specific — make
  grouping a per-set concern (states by region, or ungrouped).

### Matching / content

- Same `normalizeAnswer` rules (diacritics/punctuation-insensitive) apply to all
  sets, so e.g. "Québec" needs no alias.
- Each set curates aliases/abbreviations (e.g. "Calif."/"CA" → California,
  "PEI" → Prince Edward Island).

### <a id="a-open-questions"></a>Open questions (A)

1. **Exact set list** for v1 — which "other polities" ship first?
2. **US states**: 50 only, or +DC and/or territories?
3. **Canadian provinces**: is there a ready SVG map, or do we ship map-less
   first and add a map later?
4. **Capitals-type sets**: fill the parent region on its map, or go map-less?

---

## B. "Last Standing" mode (turn-based lives)

### Goal & rules

A new mode selectable in the lobby. Over a chosen set, players **alternate
turns**:

1. It's one player's turn; they have a **per-turn timer** (configurable).
2. Naming a **valid, not-yet-named** item ends their turn immediately and passes
   play to the opponent with a fresh turn timer. The item stays claimed (can't
   be reused by either player).
3. Wrong/duplicate guesses do **not** pass the turn — they just burn the current
   player's clock.
4. If the turn timer hits zero, that player **loses a life**; play passes to the
   opponent with a fresh timer.
5. A player reaching **0 lives is eliminated**; the last player standing wins.
   (With 2 players, first to 0 lives loses.)

### Settings (new, host-configurable, lobby-only, server-clamped)

| Setting | Proposed default | Proposed range | Notes |
| --- | --- | --- | --- |
| `mode` | `race` | `race` \| `last_standing` | Selects the whole game shape. |
| `turnSeconds` | 15 | 5–60 | Per-turn clock. The **configurable timer** the request calls for. |
| `lives` | 3 | 1–5 | Open question whether to expose or fix at 3. |

The existing `timeLimitSeconds` (shared round length) is **ignored** in
`last_standing` — there's no shared round clock, only the per-turn clock. The
set picker from feature A applies here too.

### State machine & turn flow

Reuses the `lobby → countdown → playing → ended` phases. During `playing` the
room additionally tracks:

- `currentPlayerId` — whose turn it is.
- `turnEndsAt` (epoch ms) — server-authoritative per-turn deadline; clients
  count down to it (same pattern as today's `endsAt`).
- `lives: Record<playerId, number>`.
- Shared claimed-items set (both players draw from the same pool; an item named
  by either is gone).

Server owns a per-turn `setTimeout(turnEndsAt)`:

- **On valid answer** from the current player: clear the turn timer, mark the
  item claimed, broadcast it, flip `currentPlayerId`, set a new `turnEndsAt`,
  start a new timeout.
- **On timeout**: decrement `lives[current]`; if 0 → eliminate → if one player
  left, `endGame(winner)`; else flip turn and restart the clock.
- Guesses from the **non-current** player are rejected (`not_your_turn`).

### Protocol changes

- `RoomSettings`: add `mode`, `turnSeconds`, (maybe) `lives`.
- `RoomState`: add optional `turn` block (`currentPlayerId`, `turnEndsAt`) and
  `lives` for rehydrate/reconnect.
- New server→client events (names TBD): `turn_started { playerId, turnEndsAt }`,
  `life_lost { playerId, livesLeft }`. `answer_result` gains a `not_your_turn`
  reject reason. `score_update` can be reused for the claimed count, or replaced
  by the per-item broadcast.
- Keep both protocol mirrors byte-identical (CI diff — see Cross-cutting).

### Frontend changes

- Lobby: mode toggle; when `last_standing`, show `turnSeconds` (and `lives`)
  pickers instead of the round-length picker.
- Match: show **whose turn** it is, the **per-turn countdown**, and each
  player's **remaining lives** (hearts). Disable the input when it's not your
  turn. Map still fills claimed regions (shared pool, maybe colored by who
  claimed each).

### Edge cases

- **Disconnect during your turn**: today a mid-match disconnect keeps the race
  running with a 30s grace. Here, decide: does the turn clock **pause** during
  grace, or keep ticking (and you can bleed lives while away)? Proposed: pause
  the turn clock during grace; on grace-expiry the absent player forfeits
  (present player wins), consistent with today.
- **Pool exhausted** (every item named before anyone hits 0 lives): end the game
  and decide by **most lives remaining**; tie on lives → tie, or decide by
  claimed count. (Open question.)
- **Reconnect**: snapshot must include `turn`, `lives`, and claimed items so the
  returning client rebuilds state (extends the existing `room_state` rehydrate).
- **Solo variant (optional)**: a one-player *survival* — name one item per turn
  before the clock, each miss costs a life, until 0; score = items named. Nice
  reuse of the same machinery; flag as optional for v1.

### <a id="b-open-questions"></a>Open questions (B)

1. **Lives**: expose as a setting (1–5) or fix at 3 for v1?
2. **Turn clock during disconnect**: pause (proposed) or keep ticking?
3. **Pool-exhausted tiebreak**: by lives, then by count? allow a tie?
4. **Solo survival**: in v1 or later?
5. **Naming**: "Last Standing" vs "Elimination" vs "Lives" for the UI label.

---

## <a id="cross-cutting"></a>Cross-cutting concerns

- **Protocol mirrors**: every `protocol.ts` change must be copied to
  `web/src/lib/protocol.ts` and `server/src/protocol.ts` byte-for-byte; CI fails
  on `diff`. Generalizing `isoCode → itemId` touches many call sites — do it as
  its own commit.
- **Backward compatibility**: default `mode: "race"`, `categoryId: "countries"`
  so existing flows (and the solo-flag work just shipped) are unchanged.
- **Lobby UX**: both features add host-only, lobby-locked pickers (set; mode;
  turn/lives). Keep them consistent with the existing time-preset buttons.
- **Testing** (mirrors `server/test/socket.test.ts` + web suites):
  - A: per-set lookup/total; `update_settings` accepts a new set and rejects
    unknown; a race over a non-countries set scores and ends correctly.
  - B: turn passes on valid answer; non-current player rejected; timeout costs a
    life; elimination ends the game; reconnect restores turn/lives.
- **Docs**: fold the accepted parts of this draft into
  `plan-and-requirements.md` (Functional Requirements → mode/category) once
  decisions are locked.

---

## Suggested phasing

1. **Set abstraction** (A plumbing): registry, per-set lookups, `itemId` rename,
   map registry + map-less fallback — but still only `countries` live. No
   user-visible change; pure refactor with green tests.
2. **Ship 1–2 new sets** (US states first — map exists) behind the lobby set
   picker.
3. **Last Standing mode** (B): settings + state machine + per-turn timer,
   server-first with tests, then the lobby/match UI.
4. Remaining sets + polish (map-less sets, solo survival, more aliases).

---

## Decisions (locked 2026-11-18)

- **A2** US states: **50 only** (no DC, no territories).
- **A1** v1 sets: **World countries** (exists) + **US states**. Other polities
  (capitals, provinces) deferred to a later pass.
- **B1** Lives: **configurable 1–10, default 5** (`LIVES_MIN=1`, `LIVES_MAX=10`,
  `LIVES_DEFAULT=5`).
- **B2** Turn clock **pauses on disconnect** (resumes on reconnect; grace-expiry
  still forfeits to the present player).
- **B4** Solo **survival in v1**: lone host + `last_standing` → name one item
  per turn before the clock; each miss costs a life; 0 lives ends it; score =
  items named.

Deferred (not v1): `isoCode → itemId` rename (US state ids ride in the existing
`isoCode`/`iso` field), Canadian provinces, capitals sets, map-less rendering.
