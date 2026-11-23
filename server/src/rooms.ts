/**
 * In-memory room store and seat/room types, plus small pure helpers used by
 * the socket layer (room code generation, snapshot building).
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  ROOM_CODE_LENGTH,
  TIME_LIMIT_DEFAULT_SECONDS,
  TURN_SECONDS_DEFAULT,
  LIVES_DEFAULT,
  type GamePhase,
  type PlayerPublic,
  type PlayerSlot,
  type RoomSettings,
  type RoomState,
} from "./protocol.js";
// sets.ts has no dependency on rooms.ts, so this import is cycle-free.
import { totalFor } from "./sets.js";
// prompts.ts does not depend on rooms.ts either, so this is cycle-free.
import { promptById, validIdsFor } from "./prompts.js";

export interface Seat {
  id: string; // stable per-seat id (playerId)
  slot: PlayerSlot;
  name: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  score: number;
  filled: Set<string>; // iso codes claimed (all-time; gauntlet accumulates across prompts)
  /**
   * gauntlet only: isos this seat claimed under the CURRENT prompt. The board
   * clears each prompt, so this (not the all-time `filled`) is what the map
   * shows and what reconnect snapshots restore. Reset on every prompt change.
   */
  filledThisPrompt?: Set<string>;
  reconnectToken: string;
  rematchRequested: boolean;
}

export interface Room {
  code: string;
  hostId: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: Seat[];
  endsAt?: number;
  /** true when the current/last round was started with a single player. */
  solo?: boolean;
  /** false for private solo sessions, which can never be joined by a second player. */
  joinable: boolean;
  /** handle for the round-end timer. */
  roundTimer?: ReturnType<typeof setTimeout>;
  /** handle for the countdown sequence. */
  countdownTimer?: ReturnType<typeof setInterval>;
  /** per-seat disconnect grace timers, keyed by playerId. */
  graceTimers: Map<string, ReturnType<typeof setTimeout>>;

  /* ---- last_standing runtime (additive; unused in race mode) ---- */
  /** whose turn it is right now. */
  currentPlayerId?: string;
  /** epoch ms when the current turn's clock expires. */
  turnEndsAt?: number;
  /** remaining lives by playerId. */
  lives?: Record<string, number>;
  /** handle for the active per-turn timeout. */
  turnTimer?: ReturnType<typeof setTimeout>;
  /** shared claimed-item pool: an id named by either player is gone. */
  claimed?: Set<string>;
  /** paused turn's remaining ms, stored when the current player disconnects. */
  pausedTurnMs?: number;

  /* ---- gauntlet runtime (additive; unused in race / last_standing) ---- */
  /** id of the active prompt (resolve its label/validIds via prompts.ts). */
  currentPromptId?: string;
  /** isos already claimed under the CURRENT prompt (reset on each cycle). */
  claimedThisPrompt?: Set<string>;
  /** prompt ids already shown this game — no repeats until the pool is exhausted. */
  usedPromptIds?: Set<string>;

  /* ---- showdown runtime (additive) ---- */
  /** current round number (1-based) in showdown. */
  round?: number;
}

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const rooms = new Map<string, Room>();

export function generateRoomCode(): string {
  let code: string;
  do {
    const bytes = randomBytes(ROOM_CODE_LENGTH);
    code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
  } while (rooms.has(code));
  return code;
}

export function newReconnectToken(): string {
  return randomUUID();
}

export function newPlayerId(): string {
  return randomUUID();
}

export function createRoom(hostName: string): { room: Room; seat: Seat } {
  const code = generateRoomCode();
  const seat: Seat = {
    id: newPlayerId(),
    slot: "p1",
    name: hostName,
    socketId: null,
    connected: true,
    ready: false,
    score: 0,
    filled: new Set(),
    reconnectToken: newReconnectToken(),
    rematchRequested: false,
  };
  const room: Room = {
    code,
    hostId: seat.id,
    phase: "lobby",
    settings: {
      categoryId: "countries",
      mode: "race",
      timeLimitSeconds: TIME_LIMIT_DEFAULT_SECONDS,
      turnSeconds: TURN_SECONDS_DEFAULT,
      lives: LIVES_DEFAULT,
    },
    players: [seat],
    joinable: true,
    graceTimers: new Map(),
  };
  rooms.set(code, room);
  return { room, seat };
}

/** Seat order → theme color. Slots are assigned lowest-free so colors are stable. */
const SLOTS: PlayerSlot[] = ["p1", "p2", "p3", "p4"];

/**
 * Seat a new player in the lowest free slot (p1..p4). Caller must ensure the
 * room isn't already full (MAX_PLAYERS).
 */
export function addPlayer(room: Room, name: string): Seat {
  const taken = new Set(room.players.map((p) => p.slot));
  const slot = SLOTS.find((s) => !taken.has(s)) ?? "p2";
  const seat: Seat = {
    id: newPlayerId(),
    slot,
    name,
    socketId: null,
    connected: true,
    ready: false,
    score: 0,
    filled: new Set(),
    reconnectToken: newReconnectToken(),
    rematchRequested: false,
  };
  room.players.push(seat);
  return seat;
}

export function seatToPublic(seat: Seat): PlayerPublic {
  return {
    id: seat.id,
    slot: seat.slot,
    name: seat.name,
    connected: seat.connected,
    ready: seat.ready,
    score: seat.score,
  };
}

/** Options for building a room snapshot. */
export interface RoomStateOptions {
  /** total answers in the category (defaults to the live count). */
  total?: number;
  /**
   * showdown: the player this snapshot is for. Only their own `filled` entry is
   * included (opponents' answers must never reach a client). Without a viewer,
   * a showdown snapshot carries no `filled` entries at all.
   */
  viewerId?: string;
}

export function roomStateOf(room: Room, opts: number | RoomStateOptions = {}): RoomState {
  const { total = totalFor(room.settings.categoryId), viewerId } =
    typeof opts === "number" ? { total: opts, viewerId: undefined } : opts;
  const showdown = room.settings.mode === "showdown";
  // Gauntlet and showdown show a per-prompt/per-round board, so restore the
  // current set (not the all-time one) to keep a reconnecting map in sync.
  const perPrompt = room.settings.mode === "gauntlet" || showdown;
  const filled: Record<string, string[]> = {};
  for (const seat of room.players) {
    // Showdown: only the viewer's own board — never an opponent's answers.
    if (showdown && seat.id !== viewerId) continue;
    filled[seat.id] = [...(perPrompt ? seat.filledThisPrompt ?? [] : seat.filled)];
  }
  const state: RoomState = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players: room.players.map(seatToPublic),
    filled,
    total,
  };
  if (room.endsAt !== undefined) state.endsAt = room.endsAt;
  if (room.solo) state.solo = true;
  // last_standing: surface turn + lives so a reconnecting client rehydrates.
  if (room.currentPlayerId !== undefined && room.turnEndsAt !== undefined) {
    state.turn = { currentPlayerId: room.currentPlayerId, endsAt: room.turnEndsAt };
    // Clock frozen (current player away): surface the remaining ms.
    if (room.pausedTurnMs !== undefined) state.turn.pausedMs = room.pausedTurnMs;
  }
  // showdown: everyone's tally (counts only) + the round number for rehydrate.
  if (showdown && room.round !== undefined) {
    const roundCounts: Record<string, number> = {};
    for (const seat of room.players) roundCounts[seat.id] = seat.filledThisPrompt?.size ?? 0;
    state.roundCounts = roundCounts;
    state.round = room.round;
  }
  if (room.lives !== undefined) state.lives = { ...room.lives };
  // gauntlet: surface the active prompt (label only — the valid set is never
  // sent) so a reconnecting client rehydrates the banner.
  if (room.currentPromptId !== undefined) {
    const prompt = promptById(room.currentPromptId);
    if (prompt) {
      state.prompt = {
        id: prompt.id,
        label: prompt.label,
        total: validIdsFor(prompt, room.settings.categoryId).size,
      };
    }
  }
  return state;
}

export function scoresOf(room: Room): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const seat of room.players) scores[seat.id] = seat.score;
  return scores;
}

export function clearRoomTimers(room: Room): void {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  if (room.turnTimer) clearTimeout(room.turnTimer);
  for (const t of room.graceTimers.values()) clearTimeout(t);
  room.graceTimers.clear();
  room.roundTimer = undefined;
  room.countdownTimer = undefined;
  room.turnTimer = undefined;
}

/** Wipe last_standing turn/lives runtime so no state leaks between rounds. */
export function clearTurnRuntime(room: Room): void {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = undefined;
  room.currentPlayerId = undefined;
  room.turnEndsAt = undefined;
  room.lives = undefined;
  room.claimed = undefined;
  room.pausedTurnMs = undefined;
  room.currentPromptId = undefined;
  room.claimedThisPrompt = undefined;
  room.usedPromptIds = undefined;
  room.round = undefined;
}

export function deleteRoom(room: Room): void {
  clearRoomTimers(room);
  rooms.delete(room.code);
}
