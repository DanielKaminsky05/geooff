import { useReducer } from "react";
import type { GamePhase, RejectReason, RoomState, ServerToClientEvents } from "../../lib/protocol";

/**
 * Match game state as a pure reducer over server events.
 *
 * Every server→client event the match page cares about maps to one action of
 * the same name carrying the event payload, plus a few local actions (own
 * socket connection, my rematch click). Side effects — navigation, emits,
 * flash/shake/toast FX — stay in the container; the reducer never reads the
 * clock (callers pass `now` where a deadline is computed).
 */

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

export interface GameOver {
  winnerId: string | null;
  scores: Record<string, number>;
}

export interface Prompt {
  id: string;
  label: string;
  total: number;
}

export interface RoundResult {
  counts: Record<string, number>;
  losers: string[];
  eliminated: string[];
  tie: boolean;
}

/** 3-2-1 overlay: seconds left, "ready" (in countdown but no tick seen yet), or null. */
export type Countdown = number | "ready" | null;

export interface MatchState {
  /** My seat's playerId (from the session, then from `joined`). */
  myId: string | null;
  room: RoomState | null;
  phase: GamePhase | null;
  total: number;
  endsAt: number | null;
  scores: Record<string, number>;
  /** Every player's named items (me included), keyed by playerId. */
  filled: Record<string, Set<string>>;

  // last_standing / gauntlet turn + lives.
  currentPlayerId: string | null;
  turnEndsAt: number | null;
  /** Set while the turn clock is frozen (current player disconnected): ms left. */
  turnPausedMs: number | null;
  lives: Record<string, number>;
  /** Per-player life-loss counters → replay the hearts hit FX + "−1". */
  hits: Record<string, number>;
  /** gauntlet / showdown: the active prompt (label only — never the valid set). */
  prompt: Prompt | null;

  // showdown rounds.
  roundEndsAt: number | null;
  roundNum: number;
  roundResult: RoundResult | null;

  gameOver: GameOver | null;
  myRematch: boolean;
  /** Some other player has asked for a rematch. */
  othersRematch: boolean;

  countdown: Countdown;
  /** Own socket dropped; waiting for socket.io to reconnect. */
  reconnecting: boolean;
  /** A (re)join failed unrecoverably (room gone, grace expired, …). */
  fatalError: string | null;
  /** Disconnected opponents → epoch ms their reconnect grace runs out (null =
   *  unknown, e.g. rehydrated from a snapshot after a refresh). */
  disconnected: Record<string, number | null>;

  // Answer input feedback.
  clearSignal: number;
  rejectSignal: number;
  rejectMsg: string | null;
}

export type MatchAction =
  | { type: "joined"; payload: Payload<"joined"> }
  | { type: "room_state"; payload: RoomState }
  | { type: "countdown"; payload: Payload<"countdown"> }
  | { type: "game_started"; payload: Pick<Payload<"game_started">, "total" | "endsAt"> }
  | { type: "answer_result"; payload: Payload<"answer_result"> }
  | { type: "score_update"; payload: Payload<"score_update"> }
  | { type: "opponent_progress"; payload: Payload<"opponent_progress"> }
  | { type: "turn_started"; payload: Payload<"turn_started"> }
  | { type: "life_lost"; payload: Payload<"life_lost"> }
  | { type: "prompt_changed"; payload: Payload<"prompt_changed"> }
  | { type: "round_started"; payload: Payload<"round_started"> }
  | { type: "round_result"; payload: Payload<"round_result"> }
  | { type: "game_over"; payload: Payload<"game_over"> }
  | { type: "rematch_requested"; payload: Partial<Payload<"rematch_requested">> | undefined }
  | { type: "opponent_disconnected"; payload: Payload<"opponent_disconnected">; now: number }
  | { type: "opponent_reconnected"; payload: Payload<"opponent_reconnected"> }
  | { type: "error_msg"; payload: Payload<"error_msg"> }
  | { type: "socket_disconnected" }
  | { type: "socket_connected" }
  | { type: "rematch_clicked" };

/** Banner text per answer rejection reason (unlisted reasons show nothing). */
export const REJECT_MESSAGES: Partial<Record<RejectReason, string>> = {
  duplicate: "Already named",
  wrong: "Not a match",
  not_your_turn: "Not your turn",
  off_prompt: "Doesn't match the prompt",
};

/** Join errors that mean this page can't (re)enter the game at all. */
const FATAL_JOIN_ERRORS = new Set(["room_not_found", "in_progress", "not_joinable", "room_full"]);

export function initialMatchState(myId: string | null): MatchState {
  return {
    myId,
    room: null,
    phase: null,
    total: 0,
    endsAt: null,
    scores: {},
    filled: {},
    currentPlayerId: null,
    turnEndsAt: null,
    turnPausedMs: null,
    lives: {},
    hits: {},
    prompt: null,
    roundEndsAt: null,
    roundNum: 0,
    roundResult: null,
    gameOver: null,
    myRematch: false,
    othersRematch: false,
    countdown: null,
    reconnecting: false,
    fatalError: null,
    disconnected: {},
    clearSignal: 0,
    rejectSignal: 0,
    rejectMsg: null,
  };
}

/**
 * Apply a full room snapshot. A `lobby` snapshot is a no-op: it means a
 * rematch reset the room, and the container navigates to the lobby instead of
 * clearing the game-over overlay (which would flash the dead board).
 */
function applyRoomState(s: MatchState, room: RoomState): MatchState {
  if (room.phase === "lobby") return s;
  const next: MatchState = {
    ...s,
    room,
    phase: room.phase,
    countdown: room.phase === "countdown" ? (s.countdown ?? "ready") : null,
  };
  if (room.phase !== "ended") next.gameOver = null;
  if (room.total != null) next.total = room.total;
  if (room.endsAt != null && room.phase === "playing") next.endsAt = room.endsAt;
  if (room.settings?.mode === "showdown") {
    // The round deadline rides on endsAt (null during the between-round pause).
    next.roundEndsAt = room.phase === "playing" ? (room.endsAt ?? null) : null;
    // Opponents' filled sets are withheld in showdown; tallies come from roundCounts.
    if (room.round != null) next.roundNum = room.round;
    if (room.roundCounts) next.scores = { ...room.roundCounts };
  }
  // Rehydrate filled maps. Opponents are replaced wholesale; my own set is only
  // replaced when the snapshot carries it.
  if (room.filled && s.myId) {
    const filled: Record<string, Set<string>> = {};
    for (const [pid, isos] of Object.entries(room.filled)) {
      if (pid !== s.myId) filled[pid] = new Set(isos);
    }
    const mine = room.filled[s.myId];
    if (mine) filled[s.myId] = new Set(mine);
    else if (s.filled[s.myId]) filled[s.myId] = s.filled[s.myId];
    next.filled = filled;
  }
  if (room.turn) {
    next.currentPlayerId = room.turn.currentPlayerId;
    next.turnEndsAt = room.turn.endsAt;
    next.turnPausedMs = room.turn.pausedMs ?? null;
  }
  // Who's away: keep a known grace deadline, otherwise unknown (null). Anyone
  // connected or no longer seated is dropped.
  const disconnected: Record<string, number | null> = {};
  for (const pl of room.players) {
    if (pl.id === s.myId || pl.connected) continue;
    disconnected[pl.id] = s.disconnected[pl.id] ?? null;
  }
  next.disconnected = disconnected;
  if (room.lives) next.lives = room.lives;
  if (room.prompt) next.prompt = room.prompt;
  return next;
}

function withMyFilled(s: MatchState, mine: Set<string>): Record<string, Set<string>> {
  return s.myId ? { ...s.filled, [s.myId]: mine } : s.filled;
}

export function matchReducer(s: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case "joined": {
      const joined = { ...s, myId: action.payload.playerId, reconnecting: false };
      return action.payload.state ? applyRoomState(joined, action.payload.state) : joined;
    }
    case "room_state":
      return applyRoomState(s, action.payload);
    case "countdown":
      return {
        ...s,
        phase: "countdown",
        countdown: action.payload.seconds,
        gameOver: null,
        myRematch: false,
      };
    case "game_started":
      // A fresh game (also solo "Play again", which restarts in place).
      return {
        ...s,
        phase: "playing",
        countdown: null,
        total: action.payload.total,
        endsAt: action.payload.endsAt,
        gameOver: null,
        filled: {},
        scores: {},
        myRematch: false,
        othersRematch: false,
        currentPlayerId: null,
        turnEndsAt: null,
        turnPausedMs: null,
        lives: {},
        prompt: null,
        rejectMsg: null,
        hits: {},
        roundEndsAt: null,
        roundNum: 0,
        roundResult: null,
        clearSignal: s.clearSignal + 1,
      };
    case "answer_result": {
      const p = action.payload;
      if (!p.accepted) {
        return {
          ...s,
          rejectSignal: s.rejectSignal + 1,
          rejectMsg: (p.reason && REJECT_MESSAGES[p.reason]) || null,
        };
      }
      let filled = s.filled;
      // answer_result only reaches a seated socket, i.e. after `joined`.
      if (p.isoCode && s.myId) {
        const mine = new Set(s.filled[s.myId]);
        mine.add(p.isoCode);
        filled = withMyFilled(s, mine);
      }
      return { ...s, filled, clearSignal: s.clearSignal + 1, rejectMsg: null };
    }
    case "score_update":
      return { ...s, scores: action.payload.scores };
    case "opponent_progress": {
      const p = action.payload;
      if (p.playerId === s.myId) return s;
      // Self-healing: a FULL set replaces that player's set, so one dropped
      // event can't strand a country; otherwise (gauntlet) append the one iso.
      let set: Set<string>;
      if (p.filled) {
        set = new Set(p.filled);
      } else {
        set = new Set(s.filled[p.playerId]);
        set.add(p.isoCode);
      }
      return { ...s, filled: { ...s.filled, [p.playerId]: set } };
    }
    case "turn_started":
      return {
        ...s,
        currentPlayerId: action.payload.playerId,
        turnEndsAt: action.payload.endsAt,
        turnPausedMs: null,
        rejectMsg: null,
      };
    case "life_lost": {
      const { playerId, livesLeft } = action.payload;
      return {
        ...s,
        lives: { ...s.lives, [playerId]: livesLeft },
        hits: { ...s.hits, [playerId]: (s.hits[playerId] ?? 0) + 1 },
      };
    }
    case "prompt_changed": {
      const { id, label, total } = action.payload;
      // A fresh prompt is a clean slate: every player's claims + stale reject.
      return { ...s, prompt: { id, label, total }, filled: {}, rejectMsg: null };
    }
    case "round_started":
      // A new showdown round: clean board + input, start the round clock.
      return {
        ...s,
        roundEndsAt: action.payload.endsAt,
        roundNum: action.payload.round,
        roundResult: null,
        filled: withMyFilled(s, new Set()),
        scores: {},
        rejectMsg: null,
        clearSignal: s.clearSignal + 1,
      };
    case "round_result": {
      const { counts, losers, eliminated, tie } = action.payload;
      return {
        ...s,
        scores: counts,
        roundEndsAt: null, // round's over → input off during the pause
        roundResult: { counts, losers, eliminated, tie },
      };
    }
    case "game_over":
      return {
        ...s,
        phase: "ended",
        countdown: null,
        gameOver: { winnerId: action.payload.winnerId, scores: action.payload.scores },
        scores: action.payload.scores,
        endsAt: null,
        roundEndsAt: null,
        roundResult: null,
        disconnected: {},
      };
    case "rematch_requested": {
      // Broadcast to the whole room: distinguish my request from theirs.
      const pid = action.payload?.playerId;
      return pid != null && pid !== s.myId ? { ...s, othersRematch: true } : { ...s, myRematch: true };
    }
    case "rematch_clicked":
      return { ...s, myRematch: true };
    case "opponent_disconnected": {
      const { playerId, graceSeconds } = action.payload;
      if (playerId === s.myId) return s;
      return {
        ...s,
        disconnected: { ...s.disconnected, [playerId]: action.now + graceSeconds * 1000 },
      };
    }
    case "opponent_reconnected": {
      const { playerId } = action.payload;
      if (playerId === s.myId || !(playerId in s.disconnected)) return s;
      const disconnected = { ...s.disconnected };
      delete disconnected[playerId];
      return { ...s, disconnected };
    }
    case "socket_disconnected":
      return { ...s, reconnecting: true };
    case "socket_connected":
      return { ...s, reconnecting: false };
    case "error_msg": {
      const { code, message } = action.payload;
      if (!FATAL_JOIN_ERRORS.has(code)) return s;
      // in_progress / not_joinable on a rejoin mean our seat is gone (e.g. the
      // game ended and the server dropped it) — the server's "already in
      // progress" wording would be misleading here.
      const fatalError =
        code === "room_not_found" || code === "room_full"
          ? message || "This game is no longer available."
          : "This game has ended or is no longer available.";
      return { ...s, reconnecting: false, fatalError };
    }
  }
}

export function useMatchState(myId: string | null) {
  return useReducer(matchReducer, myId, initialMatchState);
}
