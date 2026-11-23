import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlayerPublic, RoomState } from "../../lib/protocol";
import { useMatchModel } from "./matchModel";
import type { MatchState } from "./matchState";

function player(over: Partial<PlayerPublic> & { id: string; slot: PlayerPublic["slot"] }): PlayerPublic {
  return { name: "P", connected: true, ready: true, score: 0, ...over };
}

const NO_SCORES: Record<string, number> = {};

function stateWith(players: PlayerPublic[], filled: Record<string, Set<string>> = {}): MatchState {
  const room = {
    code: "ROOM01",
    phase: "playing",
    hostId: "a",
    settings: { categoryId: "countries", mode: "last_standing", timeLimitSeconds: 300, turnSeconds: 15, lives: 3 },
    players,
  } as unknown as RoomState;
  return { room, myId: "a", filled, scores: NO_SCORES, lives: {} } as unknown as MatchState;
}

describe("useMatchModel memoization", () => {
  const base = () => [player({ id: "b", slot: "p2", name: "Bob" }), player({ id: "a", slot: "p1", name: "Alice" })];

  it("keeps roster/players stable across a content-identical room_state", () => {
    const filled = { a: new Set(["fr"]) };
    const { result, rerender } = renderHook(({ s }) => useMatchModel(s), {
      initialProps: { s: stateWith(base(), filled) },
    });
    const first = result.current;
    expect(first.roster.map((r) => r.id)).toEqual(["a", "b"]);

    rerender({ s: stateWith(base(), filled) }); // fresh arrays, same content
    expect(result.current.players).toBe(first.players);
    expect(result.current.roster).toBe(first.roster);
    expect(result.current.filledFor).toBe(first.filledFor);
    expect(result.current.effectiveScores).toBe(first.effectiveScores);
  });

  it("keeps the roster stable across a ready/connected toggle, but not a rename", () => {
    const { result, rerender } = renderHook(({ s }) => useMatchModel(s), {
      initialProps: { s: stateWith(base()) },
    });
    const first = result.current;

    const toggled = base().map((p) => (p.id === "b" ? { ...p, ready: false, connected: false } : p));
    rerender({ s: stateWith(toggled) });
    expect(result.current.players).not.toBe(first.players);
    expect(result.current.roster).toBe(first.roster);

    const renamed = base().map((p) => (p.id === "b" ? { ...p, name: "Robert" } : p));
    rerender({ s: stateWith(renamed) });
    expect(result.current.roster).not.toBe(first.roster);
    expect(result.current.roster[1].name).toBe("Robert");
  });
});
