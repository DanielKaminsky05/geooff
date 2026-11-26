/**
 * geofight — shared wire protocol (canonical source of truth).
 *
 * Both the frontend (web/) and the backend (server/) build against THIS file.
 * It is mirrored into each package so they can build independently:
 *   - web/src/lib/protocol.ts
 *   - server/src/protocol.ts
 * If you change this file, update both mirrors.
 *
 * Design notes (see docs/plan-and-requirements.md):
 *  - The SERVER is authoritative. The client never receives the answer list or
 *    unguessed country names for a LIVE prompt/round — only ISO codes for
 *    countries already filled. (The one exception: `prompt_revealed` lists the
 *    names left on the board AFTER a gauntlet prompt is retired, when they can
 *    no longer be scored.)
 *  - `isoCode` is ISO 3166-1 alpha-2, LOWERCASE (e.g. "us", "fr", "br").
 *    This matches the SVG world map keys (@svg-maps/world) on the frontend.
 *  - The timer is server-authoritative via `endsAt` (epoch ms). Clients count
 *    down to that timestamp so both players end together.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const ROOM_CODE_LENGTH = 6;
export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_GRACE_SECONDS = 60;
/** Max seats in a room. Race supports up to this; turn-based modes cap at 2. */
export const MAX_PLAYERS = 4;

/** Host-configurable time limit, clamped server-side to this range. */
export const TIME_LIMIT_MIN_SECONDS = 60; // 1 min
export const TIME_LIMIT_MAX_SECONDS = 900; // 15 min
export const TIME_LIMIT_DEFAULT_SECONDS = 300; // 5 min

/** Clamp any requested time limit to the allowed range (server enforces this). */
export function clampTimeLimit(seconds: number): number {
  if (!Number.isFinite(seconds)) return TIME_LIMIT_DEFAULT_SECONDS;
  return Math.min(TIME_LIMIT_MAX_SECONDS, Math.max(TIME_LIMIT_MIN_SECONDS, Math.round(seconds)));
}

/** Per-turn clock for last_standing, clamped server-side to this range. */
export const TURN_SECONDS_MIN = 5;
export const TURN_SECONDS_MAX = 60;
export const TURN_SECONDS_DEFAULT = 15;

/** Clamp any requested per-turn time to the allowed range (server enforces this). */
export function clampTurnSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return TURN_SECONDS_DEFAULT;
  return Math.min(TURN_SECONDS_MAX, Math.max(TURN_SECONDS_MIN, Math.round(seconds)));
}

/** Lives for last_standing, clamped server-side to this range. */
export const LIVES_MIN = 1;
export const LIVES_MAX = 10;
export const LIVES_DEFAULT = 5;

/** Clamp any requested lives count to the allowed range (server enforces this). */
export function clampLives(n: number): number {
  if (!Number.isFinite(n)) return LIVES_DEFAULT;
  return Math.min(LIVES_MAX, Math.max(LIVES_MIN, Math.round(n)));
}

/**
 * Normalize a guessed answer for matching: lowercase, trim, collapse spaces,
 * strip diacritics and punctuation. Backend and tests share this so the
 * matching rule is defined in exactly one place.
 *   normalizeAnswer("  Côte d'Ivoire! ") === "cote divoire"
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Core types                                                          */
/* ------------------------------------------------------------------ */

export type GameMode = "race" | "last_standing" | "gauntlet" | "showdown";

export type CategoryId =
  | "countries"
  | "us-states"
  | "europe"
  | "africa"
  | "asia"
  | "middle-east"
  | "americas"; // more categories later (capitals…)

export type PlayerSlot = "p1" | "p2" | "p3" | "p4";

export type GamePhase = "lobby" | "countdown" | "playing" | "ended";

export type RejectReason =
  | "wrong"
  | "duplicate"
  | "empty"
  | "not_playing"
  | "not_your_turn"
  | "off_prompt";

/** A player as seen by everyone (no secrets). */
export interface PlayerPublic {
  id: string; // stable per-seat id
  slot: PlayerSlot; // p1 emerald, p2 amber, p3 sky, p4 violet (theme)
  name: string;
  connected: boolean;
  ready: boolean;
  score: number;
}

export interface RoomSettings {
  categoryId: CategoryId;
  mode: GameMode;
  timeLimitSeconds: number; // always within [MIN, MAX]; used by race
  // NOTE: the server resets `mode` to "race" when a category change leaves the
  // current mode unavailable (gauntlet/showdown need a prompt pool).
  turnSeconds: number; // always within [TURN_SECONDS_MIN, MAX]; used by last_standing
  lives: number; // always within [LIVES_MIN, MAX]; used by last_standing
}

/** Full room snapshot — sent on join and whenever anything changes. */
export interface RoomState {
  code: string;
  phase: GamePhase;
  hostId: string;
  settings: RoomSettings;
  players: PlayerPublic[];
  /** epoch ms when the current round ends; present during countdown/playing. */
  endsAt?: number;
  /** gauntlet/showdown: epoch ms when the reveal pause auto-advances, while the
   *  game is held on the end-of-prompt reveal (for rehydrate). */
  revealEndsAt?: number;
  /** total number of answers in the active category (e.g. 196). */
  total?: number;
  /** ISO codes each player has already filled, by playerId (for rehydrate).
   *  showdown: only the RECEIVING player's own entry is present, so opponents'
   *  answers never reach the client (use `roundCounts` for their tallies). */
  filled?: Record<string, string[]>;
  /** showdown: each player's tally for the current round (for rehydrate). */
  roundCounts?: Record<string, number>;
  /** showdown: the current round number (1-based, for rehydrate). */
  round?: number;
  /** true when the current/last round was started by a lone player (solo mode). */
  solo?: boolean;
  /** last_standing: whose turn it is and when their per-turn clock expires.
   *  `pausedMs` is set while the clock is frozen (the current player is
   *  disconnected); `endsAt` is then meaningless until a fresh turn_started. */
  turn?: { currentPlayerId: string; endsAt: number; pausedMs?: number };
  /** last_standing: remaining lives by playerId (for rehydrate). */
  lives?: Record<string, number>;
  /** gauntlet: the active prompt — label + how many answers it has in the set
   *  (for the "named / total" progress). The valid set itself is never sent. */
  prompt?: { id: string; label: string; total: number };
}

/* ------------------------------------------------------------------ */
/* Socket.IO event maps (typed on BOTH sides)                          */
/*                                                                     */
/*   const io = new Server<ClientToServerEvents, ServerToClientEvents>()*/
/*   const socket: Socket<ServerToClientEvents, ClientToServerEvents>   */
/* ------------------------------------------------------------------ */

export interface ClientToServerEvents {
  create_room: (payload: { playerName: string; solo?: boolean }) => void;
  join_room: (payload: { code: string; playerName: string; reconnectToken?: string }) => void;
  set_ready: (payload: { ready: boolean }) => void;
  /** Host only; server clamps timeLimitSeconds to the allowed range. */
  update_settings: (payload: {
    timeLimitSeconds?: number;
    categoryId?: CategoryId;
    mode?: GameMode;
    turnSeconds?: number;
    lives?: number;
  }) => void;
  start_game: () => void;
  submit_answer: (payload: { text: string }) => void;
  give_up: () => void;
  /** gauntlet/showdown: vote to skip the end-of-prompt reveal pause. The server
   *  advances early once every connected, in-game player has voted. */
  skip_reveal: () => void;
  request_rematch: () => void;
  leave_room: () => void;
  /** Clock sync: the server acks with its current epoch ms, so clients can
   *  correct for device clock skew when counting down to `endsAt` values. */
  time_sync: (ack: (serverNow: number) => void) => void;
}

export interface ServerToClientEvents {
  /** Sent to the joining/creating player with their identity + token. */
  joined: (payload: {
    playerId: string;
    slot: PlayerSlot;
    reconnectToken: string;
    state: RoomState;
  }) => void;
  room_state: (state: RoomState) => void;
  player_joined: (payload: { player: PlayerPublic }) => void;
  player_left: (payload: { playerId: string }) => void;
  player_ready: (payload: { playerId: string; ready: boolean }) => void;
  opponent_disconnected: (payload: { playerId: string; graceSeconds: number }) => void;
  opponent_reconnected: (payload: { playerId: string }) => void;
  countdown: (payload: { seconds: number }) => void;
  game_started: (payload: {
    categoryId: CategoryId;
    mode: GameMode;
    total: number;
    endsAt: number;
  }) => void;
  /** last_standing: a new turn began for `playerId`, ending at `endsAt` (epoch ms). */
  turn_started: (payload: { playerId: string; endsAt: number }) => void;
  /** last_standing: `playerId` lost a life (timeout); `livesLeft` remain. */
  life_lost: (payload: { playerId: string; livesLeft: number }) => void;
  /** gauntlet: a new prompt cycled in — label + answer count (never the set). */
  prompt_changed: (p: { id: string; label: string; total: number }) => void;
  /** gauntlet/showdown: a prompt was retired — `missed` are the valid answers
   *  nobody named (`iso` lights up the map, `name` fills the list); `swept` when
   *  every answer was named. Sent ONLY once the prompt is no longer active, so
   *  it can't help answer the live prompt. */
  prompt_revealed: (p: {
    id: string;
    label: string;
    missed: { iso: string; name: string }[];
    swept: boolean;
    /** epoch ms when the reveal pause auto-advances to the next prompt. */
    endsAt: number;
  }) => void;
  /** gauntlet/showdown: skip-vote progress for the active reveal pause —
   *  `count` players (of `needed` connected, in-game) have voted to skip. */
  reveal_skip: (p: { count: number; needed: number }) => void;
  /** showdown: a new simultaneous round began, ending at `endsAt` (epoch ms). */
  round_started: (payload: { endsAt: number; round: number }) => void;
  /**
   * showdown: a round ended. `counts` is each player's tally; `losers` are the
   * players who tied for the fewest and lost a heart (empty on a tie);
   * `eliminated` hit 0 hearts; `tie` = everyone equal (nobody lost). `nextInMs`
   * is the pause before the next round (0 if the game is over). `missed` are the
   * valid answers NO player named (the end-of-round reveal) — safe to send now
   * the round's clock has expired; empty when every answer was found.
   */
  round_result: (payload: {
    counts: Record<string, number>;
    losers: string[];
    eliminated: string[];
    tie: boolean;
    nextInMs: number;
    missed: { iso: string; name: string }[];
    /** Each player's answers this round, by playerId — for the "what did they
     *  name" view on the reveal. Safe now the round's clock has expired. */
    named: Record<string, { iso: string; name: string }[]>;
    /** epoch ms when the reveal pause auto-advances to the next round (0 when
     *  the game is over, so there's no pause). */
    endsAt: number;
  }) => void;
  /** Result of YOUR guess only. canonical/isoCode present when accepted. */
  answer_result: (payload: {
    accepted: boolean;
    canonical?: string;
    isoCode?: string;
    reason?: RejectReason;
  }) => void;
  /** Both players' counts after any correct answer, keyed by playerId. */
  score_update: (payload: { scores: Record<string, number> }) => void;
  /** An ISO code the opponent just filled — enough to color their map.
   *  `filled` (when present) is the guesser's FULL named set, so a client that
   *  missed an earlier event self-heals by replacing rather than appending. */
  opponent_progress: (payload: { playerId: string; isoCode: string; filled?: string[] }) => void;
  game_over: (payload: {
    winnerId: string | null; // null = tie
    scores: Record<string, number>;
    /** ISO codes each player missed, by playerId (end-of-game reveal). */
    missedByPlayer?: Record<string, string[]>;
  }) => void;
  rematch_requested: (payload: { playerId: string }) => void;
  rematch_start: () => void;
  error_msg: (payload: { code: string; message: string }) => void;
}

/* ------------------------------------------------------------------ */
/* Daily Dive (stateless REST — see docs/daily-dive-requirements.md)   */
/*                                                                     */
/* A single-player daily mode served over REST, NOT Socket.IO:         */
/*   GET  /daily         -> DailySet       (labels only; validIds stay  */
/*                                           server-side as ever)        */
/*   POST /daily/answer   -> DailyAnswerRes (validates ONE guess; this   */
/*                                           is the only call that reads  */
/*                                           the secret set — rate-limit) */
/*   POST /daily/finish    -> DailyFinishRes (totals + synthetic %ile)    */
/*                                                                     */
/* The feed-the-clock timer is CLIENT-run in phase 1 (nothing persisted  */
/* or ranked yet). Types here are DB-ready so phase 2 adds accounts +    */
/* persistence without reshaping the wire.                               */
/* ------------------------------------------------------------------ */

/** Prompts in a daily set. */
export const DAILY_PROMPT_COUNT = 5;
/** Feed-the-clock: base seconds per prompt. */
export const DAILY_BASE_SECONDS = 20;
/** Feed-the-clock: seconds added per newly-named correct answer. */
export const DAILY_TIME_BONUS_SECONDS = 2;
/** Fraction used by the pool-bonus helpers (promptFullPoints/completionBonus).
 *  Run scoring no longer applies a sweep multiplier — see DAILY_NAME_BONUS. */
export const DAILY_COMPLETION_BONUS = 0.5;
/** Per-prompt CAPTURE ceiling: fully capturing a prompt's rarity-weighted pool is
 *  worth this, scaled by your captured share — so a huge-pool prompt ("a European
 *  country") and a tiny-pool one ("ends in -stan") have the SAME skill ceiling. */
export const DAILY_PROMPT_MAX = 150;
/** Flat points for EACH correct country named, added ON TOP of the capture score.
 *  Makes naming always pay off. This is what PLAYERS earn per name. */
export const DAILY_NAME_BONUS = 10;
/** The per-name bonus COUNTED when resolving journey distances (see
 *  scoring.distanceScoreMax) — lower than DAILY_NAME_BONUS, so a tier's fraction
 *  is measured against a smaller max than players can actually earn. Net effect:
 *  the roads are more lenient to reach even though naming still pays full value. */
export const DAILY_DISTANCE_NAME_BONUS = 5;

export type JourneyId = "short" | "medium" | "long";
export type DailyOutcome = "arrived" | "died";

/** A geographic point in degrees (projected on the client via lonToX/latToY). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** One landmark on a journey: sits at `atFraction` of the route (0..1), banks `gold`. */
export interface DailyLandmark {
  atFraction: number;
  gold: number;
}

/** One of the three routes to the day's destination — a risk/reward dial, not a
 *  content difficulty. `distance` is the run-points needed to arrive, resolved
 *  per day as a fraction of that day's score max (capture ceilings + per-name
 *  bonuses) — so each tier is the same share of the day's challenge every day. */
export interface DailyJourney {
  id: JourneyId;
  distance: number;
  landmarks: DailyLandmark[];
}

/** A prompt as shown to the player: label only. The valid set stays server-side. */
export interface DailyPrompt {
  id: string;
  label: string;
}

/** The day's destination city. */
export interface DailyDestination {
  name: string;
  at: GeoPoint;
}

/** A journey's drawn path: ordered waypoints from the start to the destination. */
export interface DailyRoute {
  journeyId: JourneyId;
  points: GeoPoint[];
}

/** Today's full set — identical for every player on `dailyDate` (UTC "YYYY-MM-DD"). */
export interface DailySet {
  dailyDate: string;
  prompts: DailyPrompt[];
  journeys: DailyJourney[];
  destination: DailyDestination;
  routes: DailyRoute[];
}

/** POST /daily/answer request: one guess against one prompt of the day. */
export interface DailyAnswerReq {
  dailyDate: string;
  promptId: string;
  answer: string;
}

/** POST /daily/answer response: validity and — when valid — what it scored. */
export interface DailyAnswerRes {
  valid: boolean;
  /** matched country (present when valid). */
  iso?: string;
  name?: string;
  /** rarity-weighted points this answer earned (present when valid). The client
   *  sums these and divides by `promptMax` to get its normalized 0..100 score. */
  points?: number;
  /** seconds to add to the prompt clock (present when valid). */
  timeBonusSec?: number;
  /** total valid answers for this prompt — lets the client show "N of total"
   *  and detect completion. Not the set itself. */
  promptTotal?: number;
  /** the prompt's FULL rarity-weighted pool (sum of every valid answer's points)
   *  — the denominator the client normalizes against so each prompt tops out at
   *  DAILY_PROMPT_MAX. A scalar aggregate; reveals no answers. (present when valid) */
  promptMax?: number;
  /** why a guess was rejected. */
  reason?: "wrong" | "duplicate" | "empty";
}

/** How a single prompt went — part of the finish payload + recap. */
export interface DailyPromptResult {
  promptId: string;
  named: number;
  total: number;
  /** normalized score for this prompt, 0..DAILY_PROMPT_MAX = share of its
   *  rarity-weighted pool captured. The server re-applies the sweep bonus at
   *  finish (×1.5 when named === total), so this is the pre-sweep base. */
  points: number;
  /** lowercase ISO codes the player named for this prompt — lets the recap
   *  highlight which valid answers were got (green) vs missed (red). */
  namedIsos?: string[];
}

/**
 * A completed run. DB-ready: phase 1 stores this in localStorage; phase 2 writes
 * the same shape to the DB. `playerId` is an anonymous device id in phase 1, a
 * real account id once accounts land.
 */
export interface DailyRunResult {
  runId: string;
  dailyDate: string;
  journey: JourneyId;
  points: number;
  perPrompt: DailyPromptResult[];
  gold: number;
  outcome: DailyOutcome;
  playerId: string | null;
}

/** POST /daily/finish request: the client's completed run. */
export interface DailyFinishReq {
  result: DailyRunResult;
}

/** POST /daily/finish response: a synthetic percentile + the server-reconciled
 *  result (completion bonuses applied, outcome recomputed against the journey). */
export interface DailyFinishRes {
  /** 0..100, "you beat ~N% of players" — hardcoded curve in phase 1. */
  percentile: number;
  result: DailyRunResult;
  /** promptId → every valid answer ({iso, name}), alphabetised — revealed only
   *  AFTER the run so the player can review (and see got/missed) per prompt. */
  answers?: Record<string, { iso: string; name: string }[]>;
  /** gold the player collected en route but FORFEITED by dying (0 if arrived) —
   *  shown as "Gold lost" in red. Banked gold is on result.gold. */
  goldLost?: number;
}
