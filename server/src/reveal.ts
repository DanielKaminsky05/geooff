/**
 * Reveal pause (gauntlet + showdown).
 *
 * When a prompt/round is retired and the game continues, we hold play for a few
 * seconds on the end-of-prompt reveal so everyone can study what was missed.
 * The pause ends when its timer fires OR every eligible (alive + connected)
 * player votes to skip — then `advance` runs (cycle the next prompt / start the
 * next round). All reveal runtime lives on the Room (see rooms.ts).
 */

import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol.js";
import type { Room } from "./rooms.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Default reveal-pause duration (ms). Overridable per-server for tests. */
export const REVEAL_MS_DEFAULT = 10_000;

export function clearRevealTimer(room: Room): void {
  if (room.revealTimer) {
    clearTimeout(room.revealTimer);
    room.revealTimer = undefined;
  }
}

/**
 * Begin a reveal pause: hold the game for `revealMs` (or until everyone skips),
 * then run `advance`. The caller emits the reveal event (prompt_revealed /
 * round_result) reading `room.revealEndsAt` for the shared countdown.
 */
export function beginReveal(room: Room, revealMs: number, advance: () => void): void {
  clearRevealTimer(room);
  room.revealEndsAt = Date.now() + revealMs;
  room.revealSkips = new Set();
  room.revealAdvance = advance;
  room.revealTimer = setTimeout(() => {
    try {
      endReveal(room);
    } catch (err) {
      console.error("reveal pause error:", err);
    }
  }, revealMs);
}

/** End the reveal pause now and advance the game. No-op if not paused. */
export function endReveal(room: Room): void {
  if (room.revealEndsAt === undefined) return;
  clearRevealTimer(room);
  const advance = room.revealAdvance;
  room.revealEndsAt = undefined;
  room.revealSkips = undefined;
  room.revealAdvance = undefined;
  advance?.();
}

/**
 * Record a player's skip vote. When every eligible (alive + connected) player
 * has voted, end the pause early. Broadcasts progress so clients show "N/M".
 * No-op outside a reveal pause.
 */
export function voteSkipReveal(io: IO, room: Room, playerId: string, eligibleIds: string[]): void {
  if (room.revealEndsAt === undefined) return;
  const skips = (room.revealSkips ??= new Set());
  skips.add(playerId);
  const needed = eligibleIds.length;
  const count = eligibleIds.filter((id) => skips.has(id)).length;
  io.to(room.code).emit("reveal_skip", { count, needed });
  if (needed > 0 && count >= needed) endReveal(room);
}
