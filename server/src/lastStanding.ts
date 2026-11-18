/**
 * last_standing (turn-based lives) mode. Multiplayer-only — it always has
 * exactly two players (the solo flow is race-only; the server rejects a lone
 * host picking this mode).
 *
 * Race mode is untouched: index.ts branches on room.settings.mode and only
 * calls into here when mode === "last_standing". All turn runtime lives on the
 * Room via the additive optional fields declared in rooms.ts
 * (currentPlayerId / turnEndsAt / lives / turnTimer / claimed / pausedTurnMs).
 *
 * Rules (docs/modes-expansion-requirements.md B):
 *  - Players alternate turns with a per-turn clock (settings.turnSeconds).
 *  - A valid, not-yet-claimed item ends the turn and passes play; the item is
 *    claimed from a SHARED pool (named by either player → gone).
 *  - Wrong/duplicate burns the clock but does NOT pass the turn.
 *  - Turn timeout costs a life; at 0 lives the player is eliminated and the
 *    other player wins.
 *  - Disconnect of the CURRENT player pauses the clock (remaining ms stored);
 *    reconnect resumes it. Grace expiry still forfeits to the present player.
 */

import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./protocol.js";
import type { Room, Seat } from "./rooms.js";
import { scoresOf } from "./rooms.js";
import { scoreGuess } from "./matching.js";
import { lookupFor, canonicalFor, totalFor } from "./sets.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Dependencies the turn machinery needs from index.ts (kept small + pure). */
export interface LastStandingDeps {
  io: IO;
  /**
   * End the match (computes winner/missed, emits game_over, tidies timers).
   * `undefined` → score-based winner; explicit `null` → no winner (survival over).
   */
  endGame: (room: Room, forcedWinnerId?: string | null) => void;
  /** The current player's opponent seat, if any. */
  otherSeat: (room: Room, seat: Seat) => Seat | undefined;
  /** ms for a turn timeout; tests inject a tiny value, prod uses turnSeconds. */
  turnDurationMs: (room: Room) => number;
}

/** True when this room is playing the turn-based mode. */
export function isLastStanding(room: Room): boolean {
  return room.settings.mode === "last_standing";
}

/** The seat whose turn it currently is, if any. */
function currentSeat(room: Room): Seat | undefined {
  return room.players.find((p) => p.id === room.currentPlayerId);
}

/** Clear any live turn timer handle (leaves other runtime intact). */
function clearTurnTimer(room: Room): void {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = undefined;
  }
}

/**
 * Start turn 1 after the countdown: seed lives + the shared pool, pick the host
 * as first player, emit turn_started and arm the per-turn timeout.
 */
export function beginFirstTurn(deps: LastStandingDeps, room: Room): void {
  room.lives = {};
  for (const seat of room.players) room.lives[seat.id] = room.settings.lives;
  room.claimed = new Set<string>();
  room.pausedTurnMs = undefined;
  armTurn(deps, room, room.hostId);
}

/** Point the turn at `playerId`, set a fresh deadline, emit + arm the timer. */
function armTurn(deps: LastStandingDeps, room: Room, playerId: string): void {
  clearTurnTimer(room);
  const durationMs = deps.turnDurationMs(room);
  room.currentPlayerId = playerId;
  room.turnEndsAt = Date.now() + durationMs;
  deps.io.to(room.code).emit("turn_started", {
    playerId,
    endsAt: room.turnEndsAt,
  });
  room.turnTimer = setTimeout(() => onTurnTimeout(deps, room), durationMs);
}

/** The id of the opponent who should act next. */
function nextPlayerId(room: Room): string {
  const other = room.players.find((p) => p.id !== room.currentPlayerId);
  return other?.id ?? room.currentPlayerId ?? room.hostId;
}

/** Pass play to the other player with a fresh clock. */
function passTurn(deps: LastStandingDeps, room: Room): void {
  armTurn(deps, room, nextPlayerId(room));
}

/**
 * Turn timeout: the current player loses a life. At 0 lives they are eliminated
 * and the other player wins; otherwise play passes on with a fresh clock.
 */
function onTurnTimeout(deps: LastStandingDeps, room: Room): void {
  if (room.phase !== "playing") return;
  const current = currentSeat(room);
  if (!current || !room.lives) return;

  room.turnTimer = undefined;
  const livesLeft = Math.max(0, (room.lives[current.id] ?? 0) - 1);
  room.lives[current.id] = livesLeft;
  deps.io.to(room.code).emit("life_lost", { playerId: current.id, livesLeft });

  if (livesLeft === 0) {
    // Eliminated → the OTHER player wins.
    const other = deps.otherSeat(room, current);
    deps.endGame(room, other?.id);
    return;
  }
  passTurn(deps, room);
}

/**
 * Handle a submit_answer in last_standing mode. Mirrors race scoring but:
 *  - rejects guesses from the non-current player (not_your_turn),
 *  - uses the SHARED claimed pool, and
 *  - ends the turn (passes play) on a valid answer.
 * Wrong/duplicate reply exactly as race does (burns clock, turn stays).
 */
export function handleSubmit(
  deps: LastStandingDeps,
  room: Room,
  seat: Seat,
  socket: { emit: (ev: "answer_result", payload: any) => void },
  text: string,
): void {
  if (room.currentPlayerId !== seat.id) {
    socket.emit("answer_result", { accepted: false, reason: "not_your_turn" });
    return;
  }

  const categoryId = room.settings.categoryId;
  // Guess against the SHARED pool so either player claiming an item locks it.
  const pool = room.claimed ?? (room.claimed = new Set<string>());
  const outcome = scoreGuess(
    text,
    pool,
    lookupFor(categoryId),
    canonicalFor(categoryId),
  );

  switch (outcome.kind) {
    case "accepted": {
      seat.filled.add(outcome.iso);
      seat.score += 1;
      socket.emit("answer_result", {
        accepted: true,
        canonical: outcome.canonical,
        isoCode: outcome.iso,
      });
      deps.io.to(room.code).emit("score_update", { scores: scoresOf(room) });
      const other = deps.otherSeat(room, seat);
      if (other?.socketId) {
        deps.io.to(other.socketId).emit("opponent_progress", {
          playerId: seat.id,
          isoCode: outcome.iso,
        });
      }
      // Pool exhausted → end the game (decided by score, as elsewhere).
      if (pool.size >= totalFor(categoryId)) {
        deps.endGame(room);
        return;
      }
      // Valid answer ends the turn and passes play to the opponent.
      passTurn(deps, room);
      break;
    }
    case "duplicate":
      socket.emit("answer_result", { accepted: false, reason: "duplicate" });
      break;
    case "empty":
      socket.emit("answer_result", { accepted: false, reason: "empty" });
      break;
    default:
      socket.emit("answer_result", { accepted: false, reason: "wrong" });
  }
}

/**
 * The current player disconnected mid-turn: pause the clock (store remaining
 * ms, clear the timeout) so no life bleeds while they are away. The 30s grace
 * runs independently in index.ts. No-op if it was not their turn.
 */
export function pauseTurnForDisconnect(room: Room, seat: Seat): void {
  if (!isLastStanding(room) || room.phase !== "playing") return;
  if (room.currentPlayerId !== seat.id) return;
  if (room.turnEndsAt === undefined) return;
  clearTurnTimer(room);
  room.pausedTurnMs = Math.max(0, room.turnEndsAt - Date.now());
}

/**
 * The current player reconnected: resume their turn with the stored remaining
 * ms, re-emit turn_started and re-arm the timeout. No-op if not paused.
 */
export function resumeTurnOnReconnect(deps: LastStandingDeps, room: Room, seat: Seat): void {
  if (!isLastStanding(room) || room.phase !== "playing") return;
  if (room.currentPlayerId !== seat.id) return;
  if (room.pausedTurnMs === undefined) return;
  const remaining = room.pausedTurnMs;
  room.pausedTurnMs = undefined;
  clearTurnTimer(room);
  room.turnEndsAt = Date.now() + remaining;
  deps.io.to(room.code).emit("turn_started", {
    playerId: seat.id,
    endsAt: room.turnEndsAt,
  });
  room.turnTimer = setTimeout(() => onTurnTimeout(deps, room), remaining);
}
