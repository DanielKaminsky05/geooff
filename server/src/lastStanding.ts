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
import { scoreGuess, matchAnswer } from "./matching.js";
import { normalizeAnswer } from "./protocol.js";
import { lookupFor, canonicalFor, totalFor } from "./sets.js";
import {
  buildPromptPool,
  promptById,
  validIdsFor,
  type Prompt,
} from "./prompts.js";

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

/** True when this room is playing plain last_standing (no prompt layer). */
export function isLastStanding(room: Room): boolean {
  return room.settings.mode === "last_standing";
}

/** True when this room is playing gauntlet (last_standing + a prompt layer). */
export function isGauntlet(room: Room): boolean {
  return room.settings.mode === "gauntlet";
}

/**
 * True for any turn-based mode (last_standing OR gauntlet). The shared turn /
 * lives / per-turn-clock machinery (arm/pass/timeout/pause/resume) applies to
 * both; only submit scoring and the timeout follow-up differ.
 */
export function isTurnBased(room: Room): boolean {
  return isLastStanding(room) || isGauntlet(room);
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
 * Arm the per-turn timeout so a throw inside onTurnTimeout can't escape to the
 * top level and crash the process (dropping every connected player at once).
 */
function scheduleTurnTimeout(deps: LastStandingDeps, room: Room, ms: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    try {
      onTurnTimeout(deps, room);
    } catch (err) {
      console.error("turn timeout error:", err);
    }
  }, ms);
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
  // Gauntlet: seed the opening prompt (resets claimedThisPrompt + announces it)
  // BEFORE arming turn 1, so the banner is up when the first clock starts.
  if (isGauntlet(room)) {
    room.currentPromptId = undefined;
    room.claimedThisPrompt = undefined;
    room.usedPromptIds = new Set<string>();
    const first = pickPrompt(room);
    if (first) setPrompt(deps, room, first);
  }
  armTurn(deps, room, room.hostId);
}

/* ------------------------------------------------------------------ */
/* Gauntlet: prompt selection + cycling                                */
/* ------------------------------------------------------------------ */

/**
 * Pick a prompt at random, never repeating one until the whole pool has been
 * shown (a shuffle-bag): track used ids on the room and draw only from the
 * unused remainder. When the bag empties we reset it, keeping the just-finished
 * prompt (excludeId) out of the first draw so it can't immediately repeat across
 * the reshuffle boundary. Returns undefined only for an empty pool.
 */
export function pickPrompt(room: Room, excludeId?: string): Prompt | undefined {
  const pool = buildPromptPool(room.settings.categoryId);
  if (pool.length === 0) return undefined;
  const used = (room.usedPromptIds ??= new Set<string>());

  let candidates = pool.filter((p) => !used.has(p.id));
  if (candidates.length === 0) {
    // Whole pool seen — reshuffle. Avoid repeating excludeId first if we can.
    used.clear();
    candidates = pool.filter((p) => p.id !== excludeId);
    if (candidates.length === 0) candidates = pool; // pool of one
  }

  const choice = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
  used.add(choice.id);
  return choice;
}

/**
 * Make `prompt` the room's active prompt: store its id, reset the per-prompt
 * claimed pool, and announce it to both players (label only — never validIds).
 */
function setPrompt(deps: LastStandingDeps, room: Room, prompt: Prompt): void {
  room.currentPromptId = prompt.id;
  room.claimedThisPrompt = new Set<string>();
  const total = validIdsFor(prompt, room.settings.categoryId).size;
  deps.io.to(room.code).emit("prompt_changed", { id: prompt.id, label: prompt.label, total });
}

/** Cycle to a fresh prompt (different id when possible), resetting its pool. */
function cyclePrompt(deps: LastStandingDeps, room: Room): void {
  const next = pickPrompt(room, room.currentPromptId);
  if (next) setPrompt(deps, room, next);
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
  room.turnTimer = scheduleTurnTimeout(deps, room, durationMs);
}

/** Players still in the game (lives > 0), in stable seat order (p1..p4). */
function aliveSeats(room: Room): Seat[] {
  return [...room.players]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .filter((p) => (room.lives?.[p.id] ?? 0) > 0);
}

/**
 * The id of the next player to act: the next LIVING seat after the current one
 * in seat order (wrapping). Skips eliminated players. Works for 2-4 players and
 * for a lone solo player (returns themselves).
 */
function nextPlayerId(room: Room): string {
  const order = [...room.players].sort((a, b) => a.slot.localeCompare(b.slot));
  const n = order.length;
  const curIdx = order.findIndex((p) => p.id === room.currentPlayerId);
  for (let step = 1; step <= n; step++) {
    const cand = order[(curIdx + step) % n];
    if (cand && (room.lives?.[cand.id] ?? 0) > 0) return cand.id;
  }
  // No other living seat → the current player keeps the turn (solo survival).
  return room.currentPlayerId ?? room.hostId;
}

/** Pass play to the next living player with a fresh clock. */
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
    // This player is out. Last one standing wins; if nobody's left (solo), the
    // run just ends with no winner (score = items named).
    const alive = aliveSeats(room);
    if (alive.length <= 1) {
      deps.endGame(room, alive[0]?.id ?? null);
      return;
    }
    // 3+ players: eliminated, but the game goes on with the survivors.
  }
  // Gauntlet: a timeout means "can't answer" — cycle in a fresh prompt (new id,
  // reset claimed pool) before the next (living) player's turn begins.
  if (isGauntlet(room)) cyclePrompt(deps, room);
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
      // Broadcast to everyone (shared pool): each client colors the claim by its
      // claimer. Full filled set is self-healing against a dropped event.
      deps.io.to(room.code).emit("opponent_progress", {
        playerId: seat.id,
        isoCode: outcome.iso,
        filled: [...seat.filled],
      });
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
 * Handle a submit_answer in gauntlet mode. Like last_standing, but answers are
 * filtered through the active prompt:
 *  - not the current player → not_your_turn.
 *  - resolves to a set item, in the prompt's valid set, not yet claimed THIS
 *    prompt → accept (score, claim from the per-prompt pool), then pass the turn
 *    (cycling a fresh prompt first if this answer exhausted the prompt's pool).
 *  - resolves to a set item but NOT in the prompt's valid set → off_prompt
 *    (burns the clock, no turn pass).
 *  - already claimed this prompt → duplicate.
 *  - not a set item at all → wrong. Empty → empty.
 */
export function handleGauntletSubmit(
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
  const prompt =
    room.currentPromptId !== undefined ? promptById(room.currentPromptId) : undefined;
  const validIds = prompt ? validIdsFor(prompt, categoryId) : new Set<string>();
  const claimedThisPrompt =
    room.claimedThisPrompt ?? (room.claimedThisPrompt = new Set<string>());

  // Resolve the raw text to a set item (iso) — distinguishes wrong vs off_prompt.
  const match = matchAnswer(text, lookupFor(categoryId), canonicalFor(categoryId));
  if (!match.found || !match.iso) {
    const reason = outcomeReasonFor(text);
    socket.emit("answer_result", { accepted: false, reason });
    return;
  }
  const iso = match.iso;

  // In the set, but not satisfying the prompt → off_prompt (clock burns, no pass).
  if (!validIds.has(iso)) {
    socket.emit("answer_result", { accepted: false, reason: "off_prompt" });
    return;
  }
  // Already named for THIS prompt → duplicate (clock burns, no pass).
  if (claimedThisPrompt.has(iso)) {
    socket.emit("answer_result", { accepted: false, reason: "duplicate" });
    return;
  }

  // Accept: score + record in the player's filled set and the per-prompt pool.
  claimedThisPrompt.add(iso);
  seat.filled.add(iso);
  seat.score += 1;
  socket.emit("answer_result", {
    accepted: true,
    canonical: match.canonical ?? iso,
    isoCode: iso,
  });
  deps.io.to(room.code).emit("score_update", { scores: scoresOf(room) });
  deps.io.to(room.code).emit("opponent_progress", {
    playerId: seat.id,
    isoCode: iso,
    filled: [...seat.filled],
  });

  // Prompt exhausted (every valid answer named) → cycle a fresh prompt, NO life
  // lost, then pass the turn.
  if (claimedThisPrompt.size >= validIds.size) {
    cyclePrompt(deps, room);
  }
  passTurn(deps, room);
}

/** Reason for an answer that didn't resolve to any set item (empty vs wrong). */
function outcomeReasonFor(text: string): "empty" | "wrong" {
  return normalizeAnswer(text) === "" ? "empty" : "wrong";
}

/**
 * The current player disconnected mid-turn: pause the clock (store remaining
 * ms, clear the timeout) so no life bleeds while they are away. The 30s grace
 * runs independently in index.ts. No-op if it was not their turn.
 */
export function pauseTurnForDisconnect(room: Room, seat: Seat): void {
  if (!isTurnBased(room) || room.phase !== "playing") return;
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
  if (!isTurnBased(room) || room.phase !== "playing") return;
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
  room.turnTimer = scheduleTurnTimeout(deps, room, remaining);
}

/**
 * A player left / was removed from a turn-based game mid-match (voluntary leave
 * or grace expiry). If 1 or fewer players remain, end the match (last survivor
 * wins). Otherwise, if the leaver held the turn, advance play to the next living
 * player with a fresh clock. Call AFTER the seat has been removed from
 * room.players. No-op outside a live turn-based match.
 */
export function resolveAfterLeave(deps: LastStandingDeps, room: Room, leftId: string): void {
  if (!isTurnBased(room) || room.phase !== "playing") return;
  const alive = aliveSeats(room);
  if (alive.length <= 1) {
    deps.endGame(room, alive[0]?.id ?? null);
    return;
  }
  if (room.currentPlayerId === leftId) {
    if (isGauntlet(room)) cyclePrompt(deps, room);
    armTurn(deps, room, nextPlayerId(room));
  }
}
