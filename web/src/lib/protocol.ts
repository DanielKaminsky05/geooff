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
 *    unguessed country names — only ISO codes for countries already filled.
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
export const RECONNECT_GRACE_SECONDS = 30;

/** Host-configurable time limit, clamped server-side to this range. */
export const TIME_LIMIT_MIN_SECONDS = 60; // 1 min
export const TIME_LIMIT_MAX_SECONDS = 900; // 15 min
export const TIME_LIMIT_DEFAULT_SECONDS = 300; // 5 min

/** Clamp any requested time limit to the allowed range (server enforces this). */
export function clampTimeLimit(seconds: number): number {
  if (!Number.isFinite(seconds)) return TIME_LIMIT_DEFAULT_SECONDS;
  return Math.min(TIME_LIMIT_MAX_SECONDS, Math.max(TIME_LIMIT_MIN_SECONDS, Math.round(seconds)));
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

export type CategoryId = "countries"; // more categories later (capitals, states…)

export type PlayerSlot = "p1" | "p2";

export type GamePhase = "lobby" | "countdown" | "playing" | "ended";

export type RejectReason = "wrong" | "duplicate" | "empty" | "not_playing";

/** A player as seen by everyone (no secrets). */
export interface PlayerPublic {
  id: string; // stable per-seat id
  slot: PlayerSlot; // p1 = emerald, p2 = amber (theme)
  name: string;
  connected: boolean;
  ready: boolean;
  score: number;
}

export interface RoomSettings {
  categoryId: CategoryId;
  timeLimitSeconds: number; // always within [MIN, MAX]
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
  /** total number of answers in the active category (e.g. 196). */
  total?: number;
  /** ISO codes each player has already filled, by playerId (for rehydrate). */
  filled?: Record<string, string[]>;
  /** true when the current/last round was started by a lone player (solo mode). */
  solo?: boolean;
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
  update_settings: (payload: { timeLimitSeconds?: number; categoryId?: CategoryId }) => void;
  start_game: () => void;
  submit_answer: (payload: { text: string }) => void;
  give_up: () => void;
  request_rematch: () => void;
  leave_room: () => void;
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
  game_started: (payload: { categoryId: CategoryId; total: number; endsAt: number }) => void;
  /** Result of YOUR guess only. canonical/isoCode present when accepted. */
  answer_result: (payload: {
    accepted: boolean;
    canonical?: string;
    isoCode?: string;
    reason?: RejectReason;
  }) => void;
  /** Both players' counts after any correct answer, keyed by playerId. */
  score_update: (payload: { scores: Record<string, number> }) => void;
  /** An ISO code the opponent just filled — enough to color their map. */
  opponent_progress: (payload: { playerId: string; isoCode: string }) => void;
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
