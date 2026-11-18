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
  filled: Set<string>; // iso codes
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

export function addSecondPlayer(room: Room, name: string): Seat {
  const seat: Seat = {
    id: newPlayerId(),
    slot: "p2",
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

export function roomStateOf(room: Room, total: number = totalFor(room.settings.categoryId)): RoomState {
  const filled: Record<string, string[]> = {};
  for (const seat of room.players) {
    filled[seat.id] = [...seat.filled];
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
}

export function deleteRoom(room: Room): void {
  clearRoomTimers(room);
  rooms.delete(room.code);
}
