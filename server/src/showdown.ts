/**
 * showdown mode — simultaneous timed rounds with lives.
 *
 * Each round a prompt appears and EVERY living player races a shared clock to
 * name as many matching countries as they can on their OWN board (not a shared
 * pool — players may name the same countries). When the clock expires the
 * player(s) tied for the FEWEST lose a heart; if everyone is equal it's a tie
 * and nobody loses. Hit 0 hearts → eliminated. Last one standing wins.
 *
 * Only live COUNTS are broadcast (never opponents' ISO codes) so you can't copy
 * another player's answers to climb out of last place.
 */

import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./protocol.js";
import { normalizeAnswer } from "./protocol.js";
import type { Room, Seat } from "./rooms.js";
import { matchAnswer } from "./matching.js";
import { lookupFor, canonicalFor } from "./sets.js";
import { promptById, validIdsFor, missedAnswersFor, labelAnswers } from "./prompts.js";
import { pickPrompt } from "./lastStanding.js";
import { beginReveal } from "./reveal.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Dependencies the round machinery needs from index.ts. */
export interface ShowdownDeps {
  io: IO;
  endGame: (room: Room, forcedWinnerId?: string | null) => void;
  /** ms for a round (tests inject a tiny value, prod uses turnSeconds). */
  roundDurationMs: (room: Room) => number;
  /** ms the between-round reveal pause holds before auto-advancing. */
  revealMs: number;
}

export function isShowdown(room: Room): boolean {
  return room.settings.mode === "showdown";
}

/** Each player's tally for the current round (0 for anyone who's eliminated). */
function roundCounts(room: Room): Record<string, number> {
  const c: Record<string, number> = {};
  for (const seat of room.players) c[seat.id] = seat.filledThisPrompt?.size ?? 0;
  return c;
}

/** Players still in the game (lives > 0). */
function aliveSeats(room: Room): Seat[] {
  return room.players.filter((p) => (room.lives?.[p.id] ?? 0) > 0);
}

function clearRoundTimer(room: Room): void {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = undefined;
  }
}

/** Seed lives + start round 1 after the countdown. */
export function beginShowdown(deps: ShowdownDeps, room: Room): void {
  room.lives = {};
  for (const seat of room.players) room.lives[seat.id] = room.settings.lives;
  room.usedPromptIds = new Set<string>();
  room.round = 0;
  startRound(deps, room);
}

/** Pick a fresh prompt, reset every board, start the round clock. */
function startRound(deps: ShowdownDeps, room: Room): void {
  clearRoundTimer(room);
  const prompt = pickPrompt(room, room.currentPromptId);
  if (!prompt) {
    deps.endGame(room, null); // empty pool — shouldn't happen (start_game guards)
    return;
  }
  room.currentPromptId = prompt.id;
  room.round = (room.round ?? 0) + 1;
  for (const seat of room.players) seat.filledThisPrompt = new Set<string>();

  const total = validIdsFor(prompt, room.settings.categoryId).size;
  deps.io.to(room.code).emit("prompt_changed", { id: prompt.id, label: prompt.label, total });
  const durationMs = deps.roundDurationMs(room);
  room.endsAt = Date.now() + durationMs;
  deps.io.to(room.code).emit("round_started", { endsAt: room.endsAt, round: room.round });
  deps.io.to(room.code).emit("score_update", { scores: roundCounts(room) });

  room.roundTimer = setTimeout(() => {
    try {
      endRound(deps, room);
    } catch (err) {
      console.error("showdown round error:", err);
    }
  }, durationMs);
}

/** Score the round: fewest-named lose a heart, eliminate at 0, then continue. */
function endRound(deps: ShowdownDeps, room: Room): void {
  if (room.phase !== "playing") return;
  clearRoundTimer(room);
  room.endsAt = undefined;

  const alive = aliveSeats(room);
  const counts = roundCounts(room);
  const aliveCounts = alive.map((s) => counts[s.id] ?? 0);
  const min = Math.min(...aliveCounts);
  const max = Math.max(...aliveCounts);
  // Everyone equal (including all-filled) → tie, nobody loses.
  const tie = min === max;
  const losers = tie ? [] : alive.filter((s) => (counts[s.id] ?? 0) === min);

  const eliminated: string[] = [];
  for (const seat of losers) {
    const livesLeft = Math.max(0, (room.lives?.[seat.id] ?? 0) - 1);
    room.lives![seat.id] = livesLeft;
    deps.io.to(room.code).emit("life_lost", { playerId: seat.id, livesLeft });
    if (livesLeft === 0) eliminated.push(seat.id);
  }

  const survivors = aliveSeats(room);
  const over = survivors.length <= 1;
  // The answers nobody got — shown on the between-round board. Safe now the
  // round's clock has expired (they can't be copied into a score).
  const missed = missedThisRound(room);
  // What each player named this round — the round's over, so it's safe to
  // reveal every board (click a player on the reveal screen to see their picks).
  const named: Record<string, { iso: string; name: string }[]> = {};
  for (const seat of room.players) named[seat.id] = labelAnswers(seat.filledThisPrompt ?? []);

  if (over) {
    deps.io.to(room.code).emit("round_result", {
      counts,
      losers: losers.map((s) => s.id),
      eliminated,
      tie,
      nextInMs: 0,
      missed,
      named,
      endsAt: 0,
    });
    deps.endGame(room, survivors[0]?.id ?? null);
    return;
  }

  // Hold on the reveal (next round starts when the pause ends or all skip).
  beginReveal(room, deps.revealMs, () => startRound(deps, room));
  deps.io.to(room.code).emit("round_result", {
    counts,
    losers: losers.map((s) => s.id),
    eliminated,
    tie,
    nextInMs: deps.revealMs,
    missed,
    named,
    endsAt: room.revealEndsAt!,
  });
}

/**
 * The valid answers no living player named this round. Boards are per-player in
 * showdown, so "missed" is the valid set minus the UNION of everyone's claims.
 */
function missedThisRound(room: Room): { iso: string; name: string }[] {
  const prompt =
    room.currentPromptId !== undefined ? promptById(room.currentPromptId) : undefined;
  if (!prompt) return [];
  const claimed = new Set<string>();
  for (const seat of room.players) {
    for (const iso of seat.filledThisPrompt ?? []) claimed.add(iso);
  }
  return missedAnswersFor(prompt, room.settings.categoryId, claimed);
}

/**
 * Handle a submit_answer in showdown: prompt-filtered, scored against the
 * player's OWN per-round board (duplicates are per-player, not shared).
 */
export function handleShowdownSubmit(
  deps: ShowdownDeps,
  room: Room,
  seat: Seat,
  socket: { emit: (ev: "answer_result", payload: any) => void },
  text: string,
): void {
  // Only during a live round, and only if you're still in the game.
  if (room.phase !== "playing" || room.endsAt === undefined) {
    socket.emit("answer_result", { accepted: false, reason: "not_playing" });
    return;
  }
  if ((room.lives?.[seat.id] ?? 0) <= 0) {
    socket.emit("answer_result", { accepted: false, reason: "not_playing" });
    return;
  }

  const categoryId = room.settings.categoryId;
  const prompt =
    room.currentPromptId !== undefined ? promptById(room.currentPromptId) : undefined;
  const validIds = prompt ? validIdsFor(prompt, categoryId) : new Set<string>();
  const mine = (seat.filledThisPrompt ??= new Set<string>());

  const match = matchAnswer(text, lookupFor(categoryId), canonicalFor(categoryId));
  if (!match.found || !match.iso) {
    socket.emit("answer_result", {
      accepted: false,
      reason: normalizeAnswer(text) === "" ? "empty" : "wrong",
    });
    return;
  }
  const iso = match.iso;
  if (!validIds.has(iso)) {
    socket.emit("answer_result", { accepted: false, reason: "off_prompt" });
    return;
  }
  if (mine.has(iso)) {
    socket.emit("answer_result", { accepted: false, reason: "duplicate" });
    return;
  }

  mine.add(iso);
  seat.filled.add(iso);
  seat.score += 1;
  socket.emit("answer_result", { accepted: true, canonical: match.canonical ?? iso, isoCode: iso });
  // Broadcast COUNTS only — never opponents' ISO codes.
  deps.io.to(room.code).emit("score_update", { scores: roundCounts(room) });
}

/**
 * A player left a live showdown mid-game (voluntary leave or grace expiry). If
 * one or fewer players remain, end the match (last survivor wins). Otherwise the
 * round simply continues (it's simultaneous — no turn to advance). Call AFTER the
 * seat is removed from room.players.
 */
export function resolveShowdownAfterLeave(deps: ShowdownDeps, room: Room): void {
  if (!isShowdown(room) || room.phase !== "playing") return;
  const alive = aliveSeats(room);
  if (alive.length <= 1) deps.endGame(room, alive[0]?.id ?? null);
}
