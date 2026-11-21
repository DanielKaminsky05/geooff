import { useMemo } from "react";
import type { CategoryId, GameMode, PlayerPublic, PlayerSlot } from "../../lib/protocol";
import { slotColor } from "../../lib/colors";
import { CATEGORY_LABELS } from "../../lib/geo";
import type { MatchState } from "./matchState";

/** Stable empty set so "this player's filled" reads keep a stable ref. */
export const EMPTY: Set<string> = new Set();

/** Slot order for ranking/columns: p1 → p4. */
export const SLOT_ORDER: Record<PlayerSlot, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };

export function bySlot(a: PlayerPublic, b: PlayerPublic): number {
  return SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
}

/** "You" for the local player, otherwise their name. */
export function displayName(p: PlayerPublic, myId: string | null): string {
  return p.id === myId ? "You" : p.name;
}

/** Map-pane title: "You · Alice", or just the label when the seat is unknown. */
export function paneTitle(label: string, player: PlayerPublic | undefined): string {
  return player ? `${label} · ${player.name}` : label;
}

/** The seat a lone fallback opponent colour is drawn from when none is known. */
function otherSlot(slot: PlayerSlot | undefined): PlayerSlot {
  return slot === "p2" ? "p1" : "p2";
}

/** Everything the views derive from the reducer state, computed once per render. */
export interface MatchModel {
  state: MatchState;
  myId: string | null;
  me: PlayerPublic | undefined;
  /** Every seated player, slot order. */
  players: PlayerPublic[];
  /** Every seated player except me, slot order. */
  opponents: PlayerPublic[];
  playerCount: number;
  solo: boolean;
  mode: GameMode;
  categoryId: CategoryId;
  categoryLabel: string;
  itemsNoun: string;
  gauntlet: boolean;
  /** The Last Standing shell (last_standing and gauntlet). */
  turnBased: boolean;
  showdown: boolean;
  /** Versus race (not solo). */
  race: boolean;
  maxLives: number;
  myColor: string;
  /** Colour for "the other side" when no specific player applies. */
  opponentColor: string;
  myFilled: Set<string>;
  filledFor: (playerId: string) => Set<string>;
  /** Server scores, falling back to each seat's snapshot score. */
  effectiveScores: Record<string, number>;
  /** Game is live: playing and not over. */
  live: boolean;
  myTurn: boolean;
  currentPlayer: PlayerPublic | undefined;
  inputDisabled: boolean;
  /** Named sheet reveals every player's list (vs just mine). */
  revealAllNamed: boolean;
  namedCount: number;
}

export function sortedPlayers(players: readonly PlayerPublic[] | undefined): PlayerPublic[] {
  return [...(players ?? [])].sort(bySlot);
}

export function deriveMatchModel(
  state: MatchState,
  fallbackSlot?: PlayerSlot,
  players: PlayerPublic[] = sortedPlayers(state.room?.players),
): MatchModel {
  const { room, myId, filled, gameOver, phase, lives } = state;
  const me = players.find((p) => p.id === myId);
  const opponents = players.filter((p) => p.id !== myId);
  const filledFor = (playerId: string) => filled[playerId] ?? EMPTY;
  const myFilled = myId ? filledFor(myId) : EMPTY;

  const solo = room?.solo === true;
  const mode = room?.settings.mode ?? "race";
  const categoryId = room?.settings.categoryId ?? "countries";
  const gauntlet = mode === "gauntlet";
  // Gauntlet reuses the entire Last Standing shell (lives, per-turn timer,
  // shared colour-by-claimer map, turn gating, hit/heartbreak FX).
  const turnBased = mode === "last_standing" || gauntlet;
  const showdown = mode === "showdown";
  const maxLives = room?.settings.lives ?? 0;
  const mySlot = me?.slot ?? fallbackSlot;

  const effectiveScores = { ...state.scores };
  for (const p of players) {
    if (effectiveScores[p.id] == null) effectiveScores[p.id] = p.score ?? 0;
  }

  // In the turn-based modes it's my turn only when the server names me.
  const myTurn = !turnBased || (myId != null && state.currentPlayerId === myId);
  // The field stays usable whenever the game is live so players can pre-type
  // off-turn (submission is gated on myTurn). Showdown disables it between
  // rounds and once I'm eliminated.
  const iAmEliminated = showdown && myId != null && (lives[myId] ?? maxLives) <= 0;
  const inputDisabled =
    gameOver != null || phase !== "playing" || (showdown && (state.roundEndsAt == null || iAmEliminated));

  // A live race hides opponents' lists; shared-pool modes (and race at game
  // over) reveal everyone. Showdown never reveals opponents' answers.
  const revealAllNamed = !solo && !showdown && (gameOver != null || mode !== "race");
  const namedCount = revealAllNamed
    ? Object.values(filled).reduce((n, set) => n + set.size, 0)
    : myFilled.size;

  return {
    state,
    myId,
    me,
    players,
    opponents,
    playerCount: room?.players.length ?? 1,
    solo,
    mode,
    categoryId,
    categoryLabel: CATEGORY_LABELS[categoryId] ?? "Countries",
    // Only US states use a different noun; regions are scoped country sets.
    itemsNoun: categoryId === "us-states" ? "states" : "countries",
    gauntlet,
    turnBased,
    showdown,
    race: !solo && !turnBased && !showdown,
    maxLives,
    myColor: slotColor(mySlot),
    opponentColor: slotColor(opponents[0]?.slot ?? otherSlot(mySlot)),
    myFilled,
    filledFor,
    effectiveScores,
    live: phase === "playing" && gameOver == null,
    myTurn,
    currentPlayer: players.find((p) => p.id === state.currentPlayerId),
    inputDisabled,
    revealAllNamed,
    namedCount,
  };
}

export function useMatchModel(state: MatchState, fallbackSlot?: PlayerSlot): MatchModel {
  // Keep `players` referentially stable across events that don't touch the
  // roster, so the views' memos (claim colours, leaderboard, …) stay cached.
  const roster = state.room?.players;
  const players = useMemo(() => sortedPlayers(roster), [roster]);
  return useMemo(
    () => deriveMatchModel(state, fallbackSlot, players),
    [state, fallbackSlot, players],
  );
}
