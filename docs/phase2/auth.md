# Phase 2 — Identity (and later, auth)

**This phase has no login.** Identity is an **anonymous local id**; real auth is a
documented, deferred upgrade. This matches how most daily games ship: a local id
for the social stat first, accounts only when something actually needs a trusted
identity.

## Now: anonymous local id (no account)

- On first visit the client generates a random UUID (`localId`) and stores it in
  `localStorage`. This is the Phase-1 `getPlayerId()` value — nothing new.
- The daily plays **fully locally**: wallet and one-and-done live in
  `localStorage`, offline-tolerant, exactly as Phase 1.
- On finish, the client includes `localId` in the request so the server can file
  the run and return a **real percentile** from the day's distribution.
- The id is **not secret and not verified** — it only namespaces a device in the
  aggregate stats. The server still recomputes the score, so a player can't post
  a fake point total; the id just can't anchor a *trusted* ranking.

That's the entire identity story for Phase 2. No Supabase Auth, no tokens, no
sign-up.

## What local-id-only can't do

- **Cross-device** — a new device is a new `localId`, so progress doesn't follow.
- **A trusted leaderboard** — spoofable ids can't carry names/prizes.
- **Tamper-proof wallet** — fine while the wallet is cosmetic and local.

When any of those matters, add accounts (below).

---

## Later: accounts (deferred — designed, not built)

A three-tier model that layers on top of the local id without discarding it:

### 1. Guest — the local id above
No account; plays locally; contributes to the percentile. Most players can stay
here forever.

### 2. Anonymous account — no sign-up, server-backed
`supabase.auth.signInAnonymously()` (no email, no UI) mints a real `user_id`
whose session token lives in `localStorage`. Promote **lazily** — e.g. on first
finish, or when the player opts into the leaderboard — so idle visitors never
create `auth.users` rows. On promotion, the server **claims** the device's local
runs by stamping `user_id` onto them. From here the wallet/history can be
server-authoritative and cross-session.

### 3. Linked account — email/OAuth
Link a real identity (`signInWithOtp` or `signInWithOAuth`, Google being
lowest-friction) to the *same* `user_id` for cross-device sync + a display name.
Capture a display name only here; before that, "Anonymous".

### Server verification (when accounts land)
Authed requests send `Authorization: Bearer <access_token>`; the server resolves
it with `supabaseAdmin.auth.getUser(token)` (simple/correct) or local JWT verify
(faster) and trusts the resulting `user_id`. Only write-bearing calls
(`/daily/finish`) would require it; reads stay open.

### Keys
- `SUPABASE_ANON_KEY` is the only client value (public). `service_role` stays
  server-only (`server/.env` + Fly secret), never in the browser.
- Anonymous sign-ins count toward MAU and accumulate in `auth.users`; lazy
  promotion keeps that proportional to real players, and anon users with no runs
  can be swept periodically.
