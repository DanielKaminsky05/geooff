# Phase 2 — Real ranking via anonymous local ids

Phase 1 shipped the Daily Trek as a **stateless** feature: the server validates
answers and reconciles the finish, but nothing is persisted or ranked. The
wallet and one-and-done lock live in `localStorage`, `playerId` is an anonymous
device id, and "you beat ~N% of players" is a **hardcoded synthetic curve**
(`server/src/daily/percentile.ts`).

**Phase 2 does one focused thing: make that percentile real — with no login.**
It follows the pattern most daily games use (Wordle/Globle-style): the client
keeps an **anonymous local id** in `localStorage` and posts its finished run to
the server, which stores the day's runs in **Supabase** and computes the
percentile from the real distribution. That's it.

Deliberately staying **local** (unchanged from Phase 1):

- The **gold wallet** and **one-and-done** lock remain in `localStorage`.
- No accounts, no login, no auth on the hot path.

Deliberately **deferred** to a later phase (designed here, not built yet):

- Accounts (anonymous → email/OAuth), a **server-side wallet**, cross-device
  sync, and a **trusted** leaderboard. See the "Later: accounts" sections in
  [`data-model.md`](./data-model.md) and [`auth.md`](./auth.md).

## Why local-id-only is enough for the percentile

A client-generated id is **spoofable**, so it can't anchor a competitive
leaderboard — but the percentile is a **statistical** feature, and a few bad
actors don't move a distribution. Crucially, the server still **recomputes every
score authoritatively** (as it does today), so an individual can't post a fake
point total; the worst someone can do is stuff junk ids to nudge the aggregate,
which is fine for a casual "you beat N%" stat.

The moment you want a **trusted** leaderboard (names, prizes, cosmetics) or
**cross-device** wallets, you add identity — that's the deferred accounts
upgrade, not this phase.

## Goals

- Replace the synthetic percentile with a real one from actual same-day scores.
- Keep the player experience **login-free** and offline-tolerant.
- Lay the schema/seams so accounts can be added later **without** a rewrite.

## Non-goals (this phase)

- Login / accounts / server wallet / cross-device — documented as "Later," built
  later.
- The content-authoring tool and its tables — that's **Phase 3** (Trek Builder),
  which shares the same Supabase project.

## How it relates to the other phases

| | Phase 1 (live) | Phase 2 (this phase) | Later: accounts | Phase 3 (Builder) |
|---|---|---|---|---|
| Identity | device id | anonymous `localId` | Supabase Auth user | (reuses accounts) |
| Percentile | synthetic | **real, from scores** | real | — |
| Wallet / one-and-done | localStorage | localStorage | server | — |
| Storage | — | Supabase: `daily_runs` | + player tables | Supabase: content tables |

## Documents

- [`data-model.md`](./data-model.md) — the `daily_runs` table (local-id keyed), the percentile RPC, and the deferred accounts schema.
- [`auth.md`](./auth.md) — identity now (anonymous local id, no auth) and the later three-tier account upgrade.
- [`api-and-server.md`](./api-and-server.md) — the finish endpoint posts the local id and returns a real percentile; wallet/lock stay local.
- [`rollout.md`](./rollout.md) — ordered slices, risks, testing.
