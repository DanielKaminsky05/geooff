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
export function displayName(p: Pick<PlayerPublic, "id" | "name">, myId: string | null): string {
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

/**
 * The identity part of a seat (who sits where), without the volatile fields
 * (ready, connected, score). Derived maps that only care about who holds which
 * colour key off this so a ready toggle or a reconnect doesn't rebuild them.
 */
export interface RosterEntry {
  id: string;
  slot: PlayerSlot;
  name: string;
  color: string;
}

/** Everything the views derive from the reducer state, computed once per render. */
export interface MatchModel {
  state: MatchState;
  myId: string | null;
  me: PlayerPublic | undefined;
  /** Every seated player, slot order. */
  players: PlayerPublic[];
  /**
   * Every seated player's id/slot/name/colour, slot order. Referentially
   * stable while the seating is unchanged (see RosterEntry).
   */
  roster: RosterEntry[];
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

export function toRoster(players: readonly PlayerPublic[]): RosterEntry[] {
  return players.map((p) => ({ id: p.id, slot: p.slot, name: p.name, color: slotColor(p.slot) }));
}

/** Content key for the roster: changes only when a seat's id/slot/name does. */
function rosterKey(players: readonly PlayerPublic[]): string {
  return JSON.stringify(players.map((p) => [p.id, p.slot, p.name]));
}

/** Content key for the full player list (every field the views read). */
function playersKey(players: readonly PlayerPublic[] | undefined): string {
  return JSON.stringify(players ?? []);
}

/** Server scores, falling back to each seat's snapshot score. */
export function computeEffectiveScores(
  scores: Record<string, number>,
  players: readonly PlayerPublic[],
): Record<string, number> {
  const out = { ...scores };
  for (const p of players) {
    if (out[p.id] == null) out[p.id] = p.score ?? 0;
  }
  return out;
}

// One `filledFor` per `filled` record, so it is a stable memo dependency for
// as long as the filled sets themselves are unchanged.
const filledForCache = new WeakMap<Record<string, Set<string>>, (playerId: string) => Set<string>>();
function filledForOf(filled: Record<string, Set<string>>): (playerId: string) => Set<string> {
  let fn = filledForCache.get(filled);
  if (!fn) {
    fn = (playerId: string) => filled[playerId] ?? EMPTY;
    filledForCache.set(filled, fn);
  }
  return fn;
}

/** Pre-memoized pieces `useMatchModel` keeps stable across renders. */
export interface MatchModelMemo {
  players?: PlayerPublic[];
  roster?: RosterEntry[];
  effectiveScores?: Record<string, number>;
}

export function deriveMatchModel(
  state: MatchState,
  fallbackSlot?: PlayerSlot,
  memo: MatchModelMemo = {},
): MatchModel {
  const { room, myId, filled, gameOver, phase, lives } = state;
  const players = memo.players ?? sortedPlayers(room?.players);
  const roster = memo.roster ?? toRoster(players);
  const me = players.find((p) => p.id === myId);
  const opponents = players.filter((p) => p.id !== myId);
  const filledFor = filledForOf(filled);
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

  const effectiveScores = memo.effectiveScores ?? computeEffectiveScores(state.scores, players);

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
    roster,
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
  // Keep `players` referentially stable across events that don't change the
  // roster's content (a room_state always carries a fresh array), and
  // `roster` stable across ready/connected/score changes too, so the views'
  // memos (claim colours, lives bars, leaderboard, …) stay cached.
  const roomPlayers = state.room?.players;
  const pKey = playersKey(roomPlayers);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content
  const players = useMemo(() => sortedPlayers(roomPlayers), [pKey]);
  const rKey = rosterKey(players);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content
  const roster = useMemo(() => toRoster(players), [rKey]);
  const effectiveScores = useMemo(
    () => computeEffectiveScores(state.scores, players),
    [state.scores, players],
  );
  return useMemo(
    () => deriveMatchModel(state, fallbackSlot, { players, roster, effectiveScores }),
    [state, fallbackSlot, players, roster, effectiveScores],
  );
}
