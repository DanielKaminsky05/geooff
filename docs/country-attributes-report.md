# Country Attributes Dataset Report

Generated artifact: `server/src/data/countryAttributes.ts`
Exports: `interface CountryAttrs` and `const countryAttributes: Record<string, CountryAttrs>`.

## Coverage

- Expected countries: **197**
- Entries written: **197**
- Missing (expected but absent): **none**
- Extra (present but not in expected list): **none**

One entry per ISO a2 code, keyed and sorted by `iso`.

## Purpose and scope

These are **server-only (anti-cheat) inputs** for the Gauntlet prompt engine. They
must never be shipped to the client, because exposing borders, landlocked/island
status, population, area, or elevation would let players derive answers.

Values are **research estimates**, not authoritative measurements. They were taken
verbatim from the validated source dataset; this write step did not re-research or
alter any numeric/boolean value. Only the normalisation below was applied.

## Units

- `populationM` — population in **millions of people** (e.g. `84.5` = 84.5M).
- `areaKm2` — area in **square kilometres**.
- `elevationFtMax` — highest point in **feet** (max elevation).

## Normalisation applied

1. **Symmetric borders (union).** If A listed B or B listed A, both now list each
   other:
   - `ps -> eg` had no reciprocal: **`eg` now also lists `ps`** (correct — Gaza
     borders Egypt).
2. **Removed bogus `cy -> gb` adjacency** (manual correction). Cyprus and Great
   Britain share no land border (a UK Sovereign Base Areas artifact); `cy` is now
   a proper island (`borders: []`, `island: true`) and `gb` lists only `ie`.
3. **Sorted** each `borders` array alphabetically.
4. **Derived `island: boolean`** = (`borders` is empty AND NOT `landlocked`).

### Dropped border targets (not in our 197-country list)

These border references point at territories outside our country list and were
dropped during normalisation (they never become entries, and no reciprocal edge
is created for them):

- `es -> gi` (Gibraltar)
- `dz -> eh`, `mr -> eh`, `ma -> eh` (Western Sahara)

This matches the validation notes. All other listed country-to-country borders
were retained.

## Validation notes (from upstream)

- `es`: border `gi` is not in our country list.
- `dz`: border `eh` is not in our country list.
- `mr`: border `eh` is not in our country list.
- `ma`: border `eh` is not in our country list.
- Asymmetric borders: `ps -> eg` (unioned — correct); `cy -> gb` (removed as a
  data error — see below).

## Low-confidence values worth a human check

Elevation (`elevationFtMax`) is the least reliable field and should get the
closest human review. Spot-check candidates:

- **Atolls / very-low islands** where the max elevation is a handful of feet and
  easy to mis-source: `mv` (17), `tv` (15), `mh` (33), `ki` (285), `nr` (213).
- **`va` (Vatican, 249 ft)** and **`mc` (Monaco, 531 ft)** — micro-states where
  "highest point" is loosely defined.
- **Very high summits** where small sourcing differences matter and the number is
  trivia-sensitive: `np`/`cn` (29032, Everest), `pk` (28251, K2), `in` (28169),
  `kz` (22949), `ar` (22837, Aconcagua), `cl` (22615), `pe` (22205), `bo` (21463).

Other fields to sanity-check:

- **`cy -> gb` border** (RESOLVED): the source wrongly listed Cyprus as bordering
  Great Britain (no land boundary — a UK Sovereign Base Areas artifact). Removed;
  Cyprus is now a proper island.
- **Population** for fast-moving or contested figures (e.g. `sy`, `ye`, `cd`) are
  estimates and may lag current figures.

## How to regenerate

Source JSON: `country-attrs-source.json` (repo root).
Generator: `gen-country-attrs.cjs` (repo root).

```
node gen-country-attrs.cjs
```

The generator reports coverage, dropped targets, and unioned asymmetries.
