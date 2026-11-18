# geofight — Modes Expansion v2 (Draft Requirements)

_As of 2026-11-18 · status: **draft for review**_

Two more additions, building on the set/map registry and the `last_standing`
turn engine already shipped:

- **A. Regional sets + maps** — Europe, Africa, Asia, Middle East, Americas.
- **B. "Gauntlet" (prompt-survival)** — a turn-based elimination mode where each
  round has a *prompt* (e.g. "countries above 5000 ft elevation"); players
  alternate naming items that satisfy it until one can't, who loses a life and a
  fresh prompt cycles in.

Both keep the server-authoritative / anti-cheat stance: the client never gets
the answer list (and for B, never gets a prompt's valid-answer set).

---

## A. Regional sets + maps

### Goal

Play any existing game (race or Last Standing) scoped to one region. Ship:
**Europe, Africa, Asia, Middle East, Americas** (Americas = North + Central +
South + Caribbean).

### What's already in place (and reused)

| Piece | Reuse |
| --- | --- |
| `server/src/sets.ts` | Add one `GeoSet` per region; `items` = that region's countries (subset of the countries data). Aliases come for free. |
| `web/src/lib/continents.ts` | Already groups ISO codes by continent (Africa/Asia/Europe/N+S America/Oceania) — the backbone for most region memberships. |
| `web/src/lib/maps.ts` | Add one map entry per region. |
| `WorldMap` (`categoryId` prop) | Renders whatever the map registry returns — no component change. |

### Map approach — derive from the world SVG (no new assets)

Each region map reuses the **world** SVG paths, filtered to the region's ids,
with a **viewBox cropped to that region's bounding box** so it fills the pane.
Two ways to get the viewBox:

- **Build-time (preferred):** a small script computes the combined bounding box
  of the region's `<path>`s and writes it into the map registry entry. No
  runtime flash, deterministic.
- **Runtime fallback:** render the region paths, measure the group's `getBBox()`
  once, set the viewBox. Simpler, slight first-frame reflow.

This avoids depending on per-continent SVG packages (which may not exist / vary
in quality). _Verify_ whether `@svg-maps` ships usable continent maps; if so
they're an option, but the derive-from-world path is the safe default.

### Data model

Region sets are just curated id lists over the existing country data:

```ts
// region id → member country ISO codes
const REGIONS = {
  europe:  [...],   // ~ continents.Europe
  africa:  [...],   // ~ continents.Africa
  asia:    [...],   // ~ continents.Asia (incl. Turkey/Caucasus per quiz convention)
  "middle-east": [...], // curated, cross-continental (see caveat)
  americas:[...],   // continents["North America"] + ["South America"]
};
```

Each `GeoSet` for a region: `{ id, label, items: countries.filter(in region),
hasMap: true, mapId: <region> }`. `totalFor`/`lookupFor` already work per set.

### Named-countries list

The grouped "Your countries" view is continent-based; for a single region that
grouping is redundant. Options: group by **sub-region** (e.g. Africa → N/W/E/
Central/Southern), or just an **alphabetical list**. Alphabetical is the cheap
default; sub-region grouping is a nice-to-have.

### <a id="a-open"></a>Open questions (A)

1. **Membership** — exact country lists, especially the transcontinental ones
   (Russia, Turkey, Kazakhstan, Georgia/Armenia/Azerbaijan, Egypt, Cyprus).
   Default to the quiz conventions already encoded in `continents.ts`.
2. **Middle East** — it's not a continent; needs a curated list (e.g. the
   Arabian Peninsula + Levant + Iran/Iraq + Turkey? + Egypt?). Must decide the
   boundary.
3. **Map viewBox** — build-time script vs runtime `getBBox`.
4. Do regions appear as top-level **sets** in the lobby picker, or as a
   sub-choice under a "Countries" set? (Proposed: top-level sets, same as
   `us-states`.)

---

## B. "Gauntlet" — prompt-survival mode

### Goal & rules

A turn-based elimination game (like Last Standing) where a **prompt** constrains
valid answers:

1. A prompt is active, e.g. *"Countries above 5000 ft elevation."*
2. Players alternate, each naming a country that (a) is in the active set, (b)
   satisfies the prompt, and (c) hasn't been named yet **this prompt**.
3. A wrong/duplicate/off-prompt guess burns the current player's clock but does
   not pass the turn (as in Last Standing).
4. When a player **can't** answer before the per-turn clock expires, they **lose
   a life**, and a **new prompt cycles in** (the per-prompt claimed pool resets,
   a fresh turn starts).
5. 0 lives → eliminated; last player standing wins.

This is **Last Standing + a prompt filter + prompt cycling on life loss**, so it
reuses most of `lastStanding.ts`.

### Relationship to Last Standing (decision)

Two framings:

- **New `GameMode` `"gauntlet"`** — cleanest conceptually; the turn engine is
  shared internally but the mode is distinct in the lobby.
- **Flag on `last_standing`** (`promptsEnabled`) — less protocol surface, but
  muddies the mode.

Proposed: a **new `GameMode`**, implemented by extending the existing turn
machine (an active-prompt + cycle-on-life-loss layer), not a copy.

### The core cost: a prompt engine needs item *attributes*

Today items are just `{ id, name, aliases }`. Prompts like "above 5000 ft",
"landlocked", "borders Germany", "starts with M" require **per-item attribute
data**. This is the dominant effort of the mode.

```ts
interface CountryAttrs {
  id: string;
  elevationFtMax: number;   // highest point
  landlocked: boolean;
  borders: string[];        // adjacent country ids (for relational prompts)
  region: string;           // continent / region tags
  populationM: number;
  areaKm2: number;
  // …extensible
}
```

A **prompt** compiles its criteria to a server-side valid-answer **Set** over a
set's items:

```ts
interface Prompt {
  id: string;
  label: string;            // shown to players ("Countries above 5000 ft")
  setScope: CategoryId[];   // which sets it applies to (e.g. ["countries", region sets])
  validIds: Set<string>;    // precomputed from attributes — NEVER sent to clients
}
```

Prompt families (each compiles to `validIds`):

- **Threshold:** `elevationFtMax > 5000`, `populationM > 50`, `areaKm2 > 1e6`.
- **Boolean:** landlocked, island nation, coastal.
- **Relational:** borders X; in region Y; shares a border with the last answer
  (a "chain" variant — optional/advanced).
- **Lexical:** starts with letter L; name is one word; name has ≥ 3 words.

Units and thresholds must be defined explicitly (e.g. **feet vs metres** for the
"5000" example) and shown in the label.

### Prompt selection & cycling

- A curated **prompt pool** per set (world prompts, Europe prompts, us-states
  prompts…). At round start and on each life loss, pick a prompt:
  - **not recently used**, and
  - with **enough valid answers** for a real duel (a `minValid` guard, e.g.
    ≥ 12), so a prompt doesn't dead-end immediately.
- Reset the per-prompt claimed pool on each cycle; keep the shared map's colours
  (claims by player) or clear them per prompt (decision below).

### State machine (extends `lastStanding.ts`)

Adds to the room's turn runtime: `currentPromptId`, `promptValidIds` (server
only), `claimedThisPrompt`. On submit (gauntlet branch):

- Reject `not_your_turn` as today.
- Valid = answer resolves to an item **in `promptValidIds`** and **not in
  `claimedThisPrompt`** → claim, score, pass turn.
- Not in prompt → reject `off_prompt` (burns clock, no pass).
- Duplicate-this-prompt → reject `duplicate`.
- **Turn timeout** → life lost (reuse), **then cycle prompt** (new prompt, reset
  `claimedThisPrompt`, fresh turn) instead of just passing.
- **Prompt exhausted** (every valid answer named before anyone fails) → cycle a
  new prompt with **no** life lost.

### Protocol additions

- `RoomState` gains `prompt?: { id: string; label: string; remaining?: number }`
  (label + optional remaining count; **never** the valid set).
- Event `prompt_changed: { id, label, remaining? }`.
- `RejectReason` gains `off_prompt`.
- `GameMode` gains `"gauntlet"`; `update_settings` already carries mode.
- Mirrors kept byte-identical (CI diff).

### Frontend

- Prominent **prompt banner** (big, central) with the current label and,
  optionally, "N left" / a running count of correct answers this prompt.
- Reuse the Last Standing shell: lives in the score bar, per-turn timer, shared
  colour-by-claimer map, turn indicator, hit/heartbreak FX.
- Named list: show answers for the **current prompt** (and/or a history of past
  prompts). Decision below.

### <a id="b-open"></a>Open questions (B)

1. **Mode shape** — new `GameMode "gauntlet"` (proposed) vs a flag on
   `last_standing`.
2. **Attribute data source** — where elevation / landlocked / borders /
   population come from, and the unit conventions. This is the big one.
3. **Prompt pool v1** — which families ship first? (Proposed: region, lexical
   first-letter, landlocked/island, one threshold like elevation — the ones with
   cheap, reliable data.)
4. **"Can't" = timeout only**, or also a **"Pass / I'm stuck"** button that
   immediately costs a life and cycles?
5. **Map/claims per prompt** — clear the map's colours each new prompt, or keep
   a cumulative battlefield across prompts?
6. **Remaining count** — show how many valid answers are left (tension + hints)
   or hide it (harder)?
7. **Solo variant** — a solo survival (name prompt-matches until you fail,
   lose a life, new prompt)? Last Standing is multiplayer-only today; Gauntlet
   could justify a solo mode since a prompt gives a single player something to
   race. Optional.
8. **Difficulty balance** — prompts vary wildly in ease; need a difficulty tag
   and/or `minValid` so rounds are fair.

---

## Cross-cutting

- **Anti-cheat:** region sets are plain data; Gauntlet's `promptValidIds` stays
  server-side — clients get only the label + optional counts.
- **Protocol mirrors** (`shared` → server + web, CI `diff`): any `GameMode` /
  event / reject-reason change touches all three.
- **Content is the cost**, not code: regional memberships (A) and the attribute
  dataset + prompt authoring (B) dominate. The turn engine, protocol, and UI are
  modest extensions of what exists.
- **Testing:** region sets resolve + map viewBox sane; Gauntlet valid-set
  compilation, off-prompt rejection, prompt cycling on life loss, prompt
  exhaustion, elimination.

## Suggested phasing

1. **Regional sets (A)** — pure data + map registry; immediately playable in race
   and Last Standing. Low risk, high value.
2. **Attribute dataset + prompt compiler** — enrich countries; build the
   `Prompt → validIds` pipeline with a first, safe family (region, first-letter,
   landlocked). No gameplay yet; unit-tested.
3. **Gauntlet mode** — extend `lastStanding.ts` with the prompt layer + cycling;
   protocol + lobby + prompt banner.
4. **Richer prompts** (elevation, population, borders/chain) + solo variant +
   difficulty balancing.

## Decisions needed before build

- **A:** region membership lists (esp. Middle East) and whether regions are
  top-level sets.
- **B2:** the attribute data source (the gating dependency).
- **B1:** `GameMode "gauntlet"` vs a `last_standing` flag.
- **B3/B4:** v1 prompt families and timeout-only vs a Pass button.
