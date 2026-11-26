# Phase 2 — Accounts, persistence & real ranking

Phase 1 shipped the Daily Trek as a **stateless** feature: the server validates
answers and reconciles the finish, but nothing is persisted or ranked. The
wallet and the one-attempt-per-day lock live in the browser's `localStorage`,
`playerId` is an anonymous device id, and the "you beat ~N% of players"
percentile is a **hardcoded difficulty curve** (`server/src/daily/percentile.ts`).

Phase 2 makes it real, backed by **Supabase** (the same project Phase 3 uses for
authored content):

- **Accounts & login** via Supabase Auth, with account-less players fully
  supported: a **guest tier** (a local id in `localStorage`, plays entirely
  locally like Phase 1), promoted to a no-sign-up **anonymous account** only when
  it matters (e.g. at first finish), and optionally **linked** to email/OAuth to
  sync across devices. See [`auth.md`](./auth.md).
- **Server-side persistence** of finished runs and the gold wallet, so progress
  survives a cleared browser and can't be tampered with.
- **One-and-done enforced by the database** (a unique constraint), not by
  `localStorage`.
- **A real percentile / leaderboard** computed from actual player scores,
  replacing the synthetic curve (with a small-sample fallback).
- **(Stretch) Hardened timing** — a signed run token so the client clock can't
  be forged.

The Phase 1 types were deliberately shaped for this: `DailyRunResult` is
DB-ready, and persistence already hides behind the `DailyStore` seam, so Phase 2
swaps the implementation without changing callers.

## Goals

- A player's wallet and daily history are durable and device-independent.
- Scores are **server-authoritative** — the client cannot forge points or gold.
- The percentile reflects the real field once enough players exist.
- Login is frictionless for casual players, with an opt-in upgrade for identity.

## Non-goals (Phase 2)

- The content-authoring tool and its tables — that's **Phase 3** (Trek Builder).
  Phase 2 only adds *player* tables; they coexist in the same Supabase project.
- A shop / gold sink — gold accrues; spending comes later.
- Versus-mode accounts — Phase 2 targets the Daily Trek. The auth primitives are
  reusable for versus later.

## How it relates to the other phases

| | Phase 1 (live) | Phase 2 (this doc) | Phase 3 (Trek Builder) |
|---|---|---|---|
| Storage | `localStorage` | Supabase: *player* tables | Supabase: *content* tables |
| Identity | device id | Supabase Auth user | (reuses Phase 2 auth, optional) |
| Percentile | synthetic curve | real, from scores | — |
| One-and-done | browser lock | DB unique constraint | — |

## Documents

- [`data-model.md`](./data-model.md) — Supabase tables, RLS, wallet & percentile SQL.
- [`auth.md`](./auth.md) — login/auth design: anonymous-first, upgrade path, JWT verification.
- [`api-and-server.md`](./api-and-server.md) — endpoint changes, authoritative finish, the `DailyStore` swap.
- [`rollout.md`](./rollout.md) — ordered implementation slices, migration from Phase 1, risks, testing.
