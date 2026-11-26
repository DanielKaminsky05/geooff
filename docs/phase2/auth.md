# Phase 2 — Login & auth

Auth is **Supabase Auth**. The guiding principle: casual players should never hit
a login wall, but anyone who wants to keep their progress across devices (or
claim a leaderboard name) can upgrade in one tap.

## Three identity tiers (guest → anonymous → linked)

Account-less players are **first-class**. There are three tiers, and a player
moves up only when they choose to (or, at most, when they finish a run).

### 1. Guest — no account, a local id
On first visit the client generates a random UUID (`localId`) and stores it in
`localStorage`. A guest plays the daily **fully**: local wallet, local
one-and-done, works offline. This is exactly Phase 1 — **no Supabase user, no
auth, no server row.** Most casual players can live here forever.

Trade-off: a self-generated id is spoofable, so **guest scores are not trusted on
the leaderboard**. A guest still *sees* a percentile (the synthetic curve, or the
read-only real distribution), they just don't *contribute* a ranked score and
their run isn't persisted server-side.

### 2. Anonymous account — still no sign-up, now server-backed
When the player does something that needs durability, the client calls
`supabase.auth.signInAnonymously()` — no email, no UI — producing a real
`user_id` whose session token lives in `localStorage`. The guest's local
progress is **claimed** into it once (see migration below). From here the wallet
and history are server-authoritative, cross-session, and leaderboard-eligible.

**When to promote guest → anonymous?** Two options; pick one:
- **(a) Lazily at first finish (recommended).** Every *finisher* becomes an anon
  user, so the leaderboard/percentile has a rich, trusted field, while idle
  visitors and bots never create an `auth.users` row. Best balance of
  "no sign-up" and a real board.
- **(b) Only on explicit opt-in.** Maximum privacy / fewest accounts, but guests
  stay local-only and unranked, so the board is just opted-in players (thinner).

### 3. Linked account — email/OAuth
To sync across devices or claim a leaderboard name, the player links a real
identity to the *same* anon user:
- **Email magic link / OTP** (`signInWithOtp`), or
- **OAuth** (Google is lowest-friction) via `signInWithOAuth`.
Linking preserves the `user_id`, so wallet and history carry over untouched.
Prompt for a **display name** only here; until then they show as "Anonymous".

> Note on anonymous-user hygiene: Supabase anonymous sign-ins create rows in
> `auth.users` and count toward MAU. Promoting lazily (option a) keeps this
> proportional to real players, and anon users with **no** `daily_runs` can be
> swept periodically.

## Client flow

The browser talks to Supabase with the **anon key** (public, safe to ship) using
`@supabase/supabase-js`. The SDK persists and auto-refreshes the session.

```
first visit (guest)
  └─ no localId in localStorage? generate a UUID → localStorage
       └─ play the daily locally (wallet, one-and-done) — no server account

promote (on first finish, recommended — or explicit opt-in)
  └─ no Supabase session? signInAnonymously()      (no email, no UI)
       └─ claim the guest's local progress into the new user_id (one-time)
             └─ from now on every Daily Trek API call sends:
                   Authorization: Bearer <access_token>
```

- A guest with no Supabase session sends **no** bearer header; the server returns
  just the public set and the client uses its local wallet/lock.
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` are the only Supabase values the client
  needs (both public). The **service_role key never touches the browser**.
- Keep a single `supabaseBrowser` client module; expose `getAccessToken()` for
  the daily API layer to attach the bearer header once a session exists.

## Server verification

The game server receives `Authorization: Bearer <token>` and must resolve it to a
trusted `user_id` before writing anything.

- **Simple & correct (start here):** a server-side Supabase client validates the
  token and returns the user:
  ```ts
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  // data.user.id is the verified user_id; reject on error.
  ```
- **Faster (optimize later):** verify the JWT locally against the project's JWT
  secret (HS256) / JWKS and read `sub`. Avoids a network hop per request; adopt
  once call volume warrants it.

Which endpoints need auth:

| Endpoint | Auth |
|---|---|
| `GET /daily` | **optional** — if a token is present, also return the user's played-status + wallet |
| `POST /daily/answer` | optional — anonymous is fine (no write); may attribute rate-limit to the user |
| `POST /daily/finish` | **required** — it writes a run and banks gold |
| `GET /daily/leaderboard` | optional |

## Session lifecycle

- Access tokens are short-lived (~1h); `@supabase/supabase-js` refreshes them
  automatically in the browser using the refresh token.
- The server is stateless about sessions — it just validates whatever token
  arrives per request.

## Claiming guest / Phase-1 progress

When a guest promotes to an anonymous account (or a Phase-1 player first signs
in), do a **one-time, best-effort claim** of their local progress: POST the local
wallet (and today's played-state) to a server endpoint that credits it **once**,
guarded by a flag so it can't be replayed. The server then owns the truth going
forward.

The safe default if you'd rather keep it simple: don't import at all — let the
server become the source of truth from the promotion onward and treat the old
local wallet as cosmetic. Decide based on how much real gold players realistically
accrue before promoting.

## Security notes

- **anon key = public**, safe in the client bundle; **service_role = secret**,
  server-only (local `.env`, Fly secret).
- **Scores are server-authoritative.** Clients never write `daily_runs`
  directly; RLS has no insert policy for players, and the server recomputes the
  authoritative result before inserting. Auth identifies *who*, it does not let
  the client assert *what score*.
- RLS still applies as defense-in-depth for any direct client reads (a user can
  only read their own runs/profile).
