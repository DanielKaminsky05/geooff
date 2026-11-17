/**
 * In-memory room store and seat/room types, plus small pure helpers used by
 * the socket layer (room code generation, snapshot building).
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  ROOM_CODE_LENGTH,
  TIME_LIMIT_DEFAULT_SECONDS,
  type GamePhase,
  type PlayerPublic,
  type PlayerSlot,
  type RoomSettings,
  type RoomState,
} from "./protocol.js";

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
  /** handle for the round-end timer. */
  roundTimer?: ReturnType<typeof setTimeout>;
  /** handle for the countdown sequence. */
  countdownTimer?: ReturnType<typeof setInterval>;
  /** per-seat disconnect grace timers, keyed by playerId. */
  graceTimers: Map<string, ReturnType<typeof setTimeout>>;
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
      timeLimitSeconds: TIME_LIMIT_DEFAULT_SECONDS,
    },
    players: [seat],
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

export function roomStateOf(room: Room): RoomState {
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
  };
  if (room.endsAt !== undefined) state.endsAt = room.endsAt;
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
  for (const t of room.graceTimers.values()) clearTimeout(t);
  room.graceTimers.clear();
  room.roundTimer = undefined;
  room.countdownTimer = undefined;
}

export function deleteRoom(room: Room): void {
  clearRoomTimers(room);
  rooms.delete(room.code);
}
