import { describe, it, expect } from "vitest";
import type { PlayerPublic, RoomState } from "../../lib/protocol";
import { initialMatchState, matchReducer, type MatchAction, type MatchState } from "./matchState";
import { deriveMatchModel } from "./matchModel";

function player(over: Partial<PlayerPublic> & { id: string; slot: PlayerPublic["slot"] }): PlayerPublic {
  return { name: over.id.toUpperCase(), connected: true, ready: true, score: 0, ...over };
}

const A = player({ id: "a", slot: "p1", name: "Alice" });
const B = player({ id: "b", slot: "p2", name: "Bob" });
const C = player({ id: "c", slot: "p3", name: "Cara" });

function room(over: Partial<RoomState> = {}): RoomState {
  return {
    code: "ROOM01",
    phase: "playing",
    hostId: "a",
    settings: { categoryId: "countries", mode: "race", timeLimitSeconds: 300, turnSeconds: 15, lives: 3 },
    players: [A, B],
    total: 196,
    ...over,
  };
}

const showdownSettings = {
  categoryId: "countries" as const,
  mode: "showdown" as const,
  timeLimitSeconds: 300,
  turnSeconds: 30,
  lives: 3,
};

/** Fold a sequence of actions over a starting state (me = "a" by default). */
function run(actions: MatchAction[], start: MatchState = initialMatchState("a")): MatchState {
  return actions.reduce(matchReducer, start);
}

const ids = (s: MatchState, pid: string) => [...(s.filled[pid] ?? [])].sort();

describe("matchReducer: single events", () => {
  it("joined adopts the server's playerId, clears reconnecting, applies the snapshot", () => {
    const s = run([
      { type: "socket_disconnected" },
      {
        type: "joined",
        payload: { playerId: "a", slot: "p1", reconnectToken: "t", state: room({ filled: { a: ["fr"], b: ["jp"] } }) },
      },
    ], initialMatchState(null));
    expect(s.myId).toBe("a");
    expect(s.reconnecting).toBe(false);
    expect(s.room?.code).toBe("ROOM01");
    expect(ids(s, "a")).toEqual(["fr"]);
    expect(ids(s, "b")).toEqual(["jp"]);
  });

  it("joined with a lobby snapshot records identity but leaves the board alone", () => {
    const s = run([
      { type: "joined", payload: { playerId: "a", slot: "p1", reconnectToken: "t", state: room({ phase: "lobby" }) } },
    ]);
    expect(s.myId).toBe("a");
    expect(s.room).toBeNull();
  });

  it("room_state(countdown) shows 'ready' until a tick, and keeps a seen tick", () => {
    let s = run([{ type: "room_state", payload: room({ phase: "countdown" }) }]);
    expect(s.countdown).toBe("ready");
    s = run([{ type: "countdown", payload: { seconds: 2 } }, { type: "room_state", payload: room({ phase: "countdown" }) }], s);
    expect(s.countdown).toBe(2);
    s = run([{ type: "room_state", payload: room() }], s);
    expect(s.countdown).toBeNull();
  });

  it("answer_result: accepted fills my set + bumps accept (not clear); rejected maps the reason", () => {
    let s = run([{ type: "answer_result", payload: { accepted: true, isoCode: "fr" } }]);
    expect(ids(s, "a")).toEqual(["fr"]);
    expect(s.acceptSignal).toBe(1);
    // An accept must not hard-clear the field (that would wipe type-ahead).
    expect(s.clearSignal).toBe(0);

    const reasons = [
      ["duplicate", "Already named"],
      ["wrong", "Not a match"],
      ["not_your_turn", "Not your turn"],
      ["off_prompt", "Doesn't match the prompt"],
      ["empty", null],
      ["not_playing", null],
    ] as const;
    for (const [reason, msg] of reasons) {
      s = matchReducer(s, { type: "answer_result", payload: { accepted: false, reason } });
      expect(s.rejectMsg).toBe(msg);
    }
    expect(s.rejectSignal).toBe(reasons.length);

    s = matchReducer(s, { type: "answer_result", payload: { accepted: true, isoCode: "de" } });
    expect(s.rejectMsg).toBeNull();
    expect(ids(s, "a")).toEqual(["de", "fr"]);
  });

  it("opponent_progress replaces from a full set, appends without one, ignores my own echo", () => {
    const s = run([
      { type: "opponent_progress", payload: { playerId: "b", isoCode: "us", filled: ["us"] } },
      { type: "opponent_progress", payload: { playerId: "b", isoCode: "br", filled: ["us", "jp", "br"] } },
      { type: "opponent_progress", payload: { playerId: "c", isoCode: "at" } },
      { type: "opponent_progress", payload: { playerId: "c", isoCode: "ch" } },
      { type: "opponent_progress", payload: { playerId: "a", isoCode: "zz" } },
    ]);
    expect(ids(s, "b")).toEqual(["br", "jp", "us"]);
    expect(ids(s, "c")).toEqual(["at", "ch"]);
    expect(s.filled.a).toBeUndefined();
  });

  it("turn_started / life_lost track the turn, lives, and per-player hit counters", () => {
    const s = run([
      { type: "room_state", payload: room({ turn: { currentPlayerId: "b", endsAt: 1, pausedMs: 7000 } }) },
      { type: "answer_result", payload: { accepted: false, reason: "not_your_turn" } },
      { type: "turn_started", payload: { playerId: "a", endsAt: 99 } },
      { type: "life_lost", payload: { playerId: "b", livesLeft: 2 } },
      { type: "life_lost", payload: { playerId: "b", livesLeft: 1 } },
    ]);
    expect(s.currentPlayerId).toBe("a");
    expect(s.turnEndsAt).toBe(99);
    expect(s.turnPausedMs).toBeNull();
    expect(s.rejectMsg).toBeNull();
    expect(s.lives).toEqual({ b: 1 });
    expect(s.hits).toEqual({ b: 2 });
  });

  it("prompt_changed wipes every player's claims", () => {
    const s = run([
      { type: "answer_result", payload: { accepted: true, isoCode: "fr" } },
      { type: "opponent_progress", payload: { playerId: "b", isoCode: "jp" } },
      { type: "prompt_changed", payload: { id: "island", label: "Island nations", total: 46 } },
    ]);
    expect(s.prompt).toEqual({ id: "island", label: "Island nations", total: 46 });
    expect(s.filled).toEqual({});
  });

  it("round_started clears my board + scores; round_result stops the clock", () => {
    let s = run([
      { type: "answer_result", payload: { accepted: true, isoCode: "fr" } },
      { type: "score_update", payload: { scores: { a: 1 } } },
      { type: "round_started", payload: { endsAt: 500, round: 2 } },
    ]);
    expect(ids(s, "a")).toEqual([]);
    expect(s.scores).toEqual({});
    expect(s.roundNum).toBe(2);
    expect(s.roundEndsAt).toBe(500);
    s = matchReducer(s, {
      type: "round_result",
      payload: { counts: { a: 3, b: 1 }, losers: ["b"], eliminated: [], tie: false, nextInMs: 3000 },
    });
    expect(s.roundEndsAt).toBeNull();
    expect(s.scores).toEqual({ a: 3, b: 1 });
    expect(s.roundResult).toEqual({ counts: { a: 3, b: 1 }, losers: ["b"], eliminated: [], tie: false });
  });

  it("game_over ends the game and drops round + away state", () => {
    const s = run([
      { type: "room_state", payload: room() },
      { type: "opponent_disconnected", payload: { playerId: "b", graceSeconds: 30 }, now: 0 },
      { type: "round_result", payload: { counts: {}, losers: [], eliminated: [], tie: true, nextInMs: 0 } },
      { type: "game_over", payload: { winnerId: "a", scores: { a: 4, b: 2 } } },
    ]);
    expect(s.phase).toBe("ended");
    expect(s.gameOver).toEqual({ winnerId: "a", scores: { a: 4, b: 2 } });
    expect(s.scores).toEqual({ a: 4, b: 2 });
    expect(s.roundResult).toBeNull();
    expect(s.disconnected).toEqual({});
    expect(s.endsAt).toBeNull();
  });

  it("a reject banner never outlives its game (game_over, countdown, game_started)", () => {
    const rejected = run([
      { type: "room_state", payload: room() },
      { type: "answer_result", payload: { accepted: false, reason: "duplicate" } },
    ]);
    expect(rejected.rejectMsg).toBe("Already named");
    expect(matchReducer(rejected, { type: "game_over", payload: { winnerId: null, scores: {} } }).rejectMsg).toBeNull();
    expect(matchReducer(rejected, { type: "countdown", payload: { seconds: 3 } }).rejectMsg).toBeNull();
    const limited = matchReducer(rejected, { type: "error_msg", payload: { code: "rate_limited", message: "" } });
    const started = matchReducer(limited, { type: "game_started", payload: { total: 196, endsAt: 9 } });
    expect(started.rejectMsg).toBeNull();
    expect(started.clearSignal).toBe(limited.clearSignal + 1);
  });

  it("rematch_requested distinguishes my echo from someone else's request", () => {
    expect(run([{ type: "rematch_requested", payload: { playerId: "b" } }])).toMatchObject({
      othersRematch: true,
      myRematch: false,
    });
    expect(run([{ type: "rematch_requested", payload: { playerId: "a" } }]).myRematch).toBe(true);
    expect(run([{ type: "rematch_requested", payload: undefined }]).myRematch).toBe(true);
    expect(run([{ type: "rematch_clicked" }]).myRematch).toBe(true);
  });

  it("opponent_disconnected stores the grace deadline from `now`; reconnected clears it", () => {
    let s = run([
      { type: "opponent_disconnected", payload: { playerId: "b", graceSeconds: 30 }, now: 1000 },
      { type: "opponent_disconnected", payload: { playerId: "a", graceSeconds: 30 }, now: 1000 },
    ]);
    expect(s.disconnected).toEqual({ b: 31_000 });
    s = matchReducer(s, { type: "opponent_reconnected", payload: { playerId: "b" } });
    expect(s.disconnected).toEqual({});
    // Unknown player: no-op, same reference.
    expect(matchReducer(s, { type: "opponent_reconnected", payload: { playerId: "z" } })).toBe(s);
  });

  it("room_state rehydrates away players, keeping a known deadline", () => {
    const s = run([
      { type: "opponent_disconnected", payload: { playerId: "b", graceSeconds: 10 }, now: 0 },
      { type: "room_state", payload: room({ players: [A, { ...B, connected: false }, { ...C, connected: false }] }) },
    ]);
    expect(s.disconnected).toEqual({ b: 10_000, c: null });
  });

  it("error_msg rate_limited: a transient reject ('Slow down!'), never fatal", () => {
    const base = run([{ type: "room_state", payload: room() }]);
    const s = matchReducer(base, {
      type: "error_msg",
      payload: { code: "rate_limited", message: "Slow down: too many requests." },
    });
    expect(s.fatalError).toBeNull();
    expect(s.phase).toBe("playing");
    expect(s.rejectMsg).toBe("Slow down!");
    expect(s.rejectSignal).toBe(base.rejectSignal + 1);
    expect(s.acceptSignal).toBe(base.acceptSignal);
    expect(s.clearSignal).toBe(base.clearSignal);
    // The next accepted answer clears the banner.
    const ok = matchReducer(s, { type: "answer_result", payload: { accepted: true, isoCode: "fr" } });
    expect(ok.rejectMsg).toBeNull();
  });

  it("error_msg: join failures are fatal, unknown codes are ignored", () => {
    const base = run([{ type: "socket_disconnected" }]);
    expect(matchReducer(base, { type: "error_msg", payload: { code: "bad_payload", message: "Bad" } })).toBe(base);
    expect(
      matchReducer(base, { type: "error_msg", payload: { code: "room_not_found", message: "No room." } }),
    ).toMatchObject({ fatalError: "No room.", reconnecting: false });
    expect(
      matchReducer(base, { type: "error_msg", payload: { code: "in_progress", message: "already in progress" } })
        .fatalError,
    ).toBe("This game has ended or is no longer available.");
    expect(
      matchReducer(base, { type: "error_msg", payload: { code: "room_full", message: "" } }).fatalError,
    ).toBe("This game is no longer available.");
  });
});

describe("matchReducer: event-ordering sequences", () => {
  it("room_state(lobby) before rematch_start leaves the game-over board untouched", () => {
    const over = run([
      { type: "room_state", payload: room() },
      { type: "game_over", payload: { winnerId: "a", scores: { a: 3, b: 1 } } },
      { type: "rematch_requested", payload: { playerId: "a" } },
    ]);
    // The lobby snapshot is a no-op for the reducer (the container navigates),
    // so the overlay doesn't clear and flash the dead board first.
    const after = matchReducer(over, { type: "room_state", payload: room({ phase: "lobby" }) });
    expect(after).toBe(over);
    expect(after.gameOver).not.toBeNull();
  });

  it("solo Play again: countdown + game_started restart in place with a clean slate", () => {
    const s = run([
      { type: "room_state", payload: room({ solo: true, players: [A] }) },
      { type: "answer_result", payload: { accepted: false, reason: "wrong" } },
      { type: "answer_result", payload: { accepted: true, isoCode: "fr" } },
      { type: "life_lost", payload: { playerId: "a", livesLeft: 2 } },
      { type: "game_over", payload: { winnerId: "a", scores: { a: 1 } } },
      { type: "rematch_clicked" },
      { type: "countdown", payload: { seconds: 3 } },
    ]);
    expect(s.gameOver).toBeNull();
    expect(s.myRematch).toBe(false);
    expect(s.countdown).toBe(3);
    const started = matchReducer(s, { type: "game_started", payload: { total: 196, endsAt: 9 } });
    expect(started).toMatchObject({
      phase: "playing",
      countdown: null,
      filled: {},
      scores: {},
      hits: {},
      lives: {},
      rejectMsg: null,
      endsAt: 9,
    });
    expect(started.clearSignal).toBe(s.clearSignal + 1);
  });

  it("game_started then prompt_changed: the opening prompt sticks", () => {
    const s = run([
      { type: "room_state", payload: room({ phase: "countdown", settings: { ...showdownSettings, mode: "gauntlet" } }) },
      { type: "game_started", payload: { total: 196, endsAt: 9 } },
      { type: "prompt_changed", payload: { id: "landlocked", label: "Landlocked countries", total: 44 } },
    ]);
    expect(s.prompt?.label).toBe("Landlocked countries");
    expect(s.phase).toBe("playing");
  });

  it("prompt_changed then game_started: game_started clears it, the follow-up snapshot restores it", () => {
    const prompt = { id: "landlocked", label: "Landlocked countries", total: 44 };
    let s = run([
      { type: "room_state", payload: room({ phase: "countdown", settings: { ...showdownSettings, mode: "gauntlet" } }) },
      { type: "prompt_changed", payload: prompt },
      { type: "game_started", payload: { total: 196, endsAt: 9 } },
    ]);
    expect(s.prompt).toBeNull();
    // The server always follows game start with a room_state carrying the prompt.
    s = matchReducer(s, {
      type: "room_state",
      payload: room({ settings: { ...showdownSettings, mode: "gauntlet" }, prompt }),
    });
    expect(s.prompt).toEqual(prompt);
  });

  it("reconnect snapshot mid-showdown restores round, tallies, my board and clock", () => {
    const before = run([
      { type: "room_state", payload: room({ settings: showdownSettings, players: [A, B, C] }) },
      { type: "round_started", payload: { endsAt: 100, round: 1 } },
      { type: "answer_result", payload: { accepted: true, isoCode: "fr" } },
      { type: "socket_disconnected" },
    ]);
    expect(before.reconnecting).toBe(true);

    const snapshot = room({
      settings: showdownSettings,
      players: [A, B, C],
      endsAt: 5000,
      round: 3,
      roundCounts: { a: 2, b: 4, c: 1 },
      lives: { a: 3, b: 2, c: 1 },
      // Showdown withholds opponents' answers: only my own entry is sent.
      filled: { a: ["jp", "gb"] },
      prompt: { id: "island", label: "Island nations", total: 46 },
    });
    const s = run(
      [
        { type: "socket_connected" },
        { type: "joined", payload: { playerId: "a", slot: "p1", reconnectToken: "t2", state: snapshot } },
      ],
      before,
    );
    expect(s.reconnecting).toBe(false);
    expect(s.roundNum).toBe(3);
    expect(s.roundEndsAt).toBe(5000);
    expect(s.endsAt).toBe(5000);
    expect(s.scores).toEqual({ a: 2, b: 4, c: 1 });
    expect(s.lives).toEqual({ a: 3, b: 2, c: 1 });
    expect(ids(s, "a")).toEqual(["gb", "jp"]);
    expect(Object.keys(s.filled)).toEqual(["a"]);
    expect(s.prompt?.label).toBe("Island nations");

    // A snapshot taken in the between-round pause has no deadline → input off.
    const paused = matchReducer(s, {
      type: "room_state",
      payload: { ...snapshot, endsAt: undefined },
    });
    expect(paused.roundEndsAt).toBeNull();
    expect(deriveMatchModel(paused).inputDisabled).toBe(true);
    expect(deriveMatchModel(s).inputDisabled).toBe(false);
  });

  it("3-player race where one leaves: the roster, boards and away list follow the snapshot", () => {
    let s = run([
      { type: "room_state", payload: room({ players: [A, B, C] }) },
      { type: "answer_result", payload: { accepted: true, isoCode: "fr" } },
      { type: "opponent_progress", payload: { playerId: "b", isoCode: "us", filled: ["us"] } },
      { type: "opponent_progress", payload: { playerId: "c", isoCode: "jp", filled: ["jp"] } },
      { type: "score_update", payload: { scores: { a: 1, b: 1, c: 1 } } },
      { type: "opponent_disconnected", payload: { playerId: "c", graceSeconds: 30 }, now: 0 },
    ]);
    let m = deriveMatchModel(s);
    expect(m.opponents.map((p) => p.id)).toEqual(["b", "c"]);
    expect(m.playerCount).toBe(3);

    // Cara's grace runs out: the server drops her seat and re-broadcasts.
    s = matchReducer(s, {
      type: "room_state",
      payload: room({ players: [A, B], filled: { a: ["fr"], b: ["us"] } }),
    });
    m = deriveMatchModel(s);
    expect(m.opponents.map((p) => p.id)).toEqual(["b"]);
    expect(m.playerCount).toBe(2);
    expect(s.disconnected).toEqual({});
    expect(s.filled.c).toBeUndefined();
    expect(ids(s, "a")).toEqual(["fr"]);
    expect(m.filledFor("b")).toEqual(new Set(["us"]));
    // Still a versus race: the duel layout now applies.
    expect(m.race).toBe(true);
  });
});

describe("deriveMatchModel", () => {
  it("lists opponents by slot, never assuming a single one", () => {
    const s = run([
      { type: "room_state", payload: room({ players: [C, A, player({ id: "d", slot: "p4" }), B] }) },
    ]);
    const m = deriveMatchModel(s);
    expect(m.players.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(m.opponents.map((p) => p.id)).toEqual(["b", "c", "d"]);
    expect(m.me?.id).toBe("a");
  });

  it("gates my turn in the turn-based modes only", () => {
    const ls = { ...showdownSettings, mode: "last_standing" as const };
    let s = run([{ type: "room_state", payload: room({ settings: ls, turn: { currentPlayerId: "b", endsAt: 1 } }) }]);
    expect(deriveMatchModel(s).myTurn).toBe(false);
    s = matchReducer(s, { type: "turn_started", payload: { playerId: "a", endsAt: 2 } });
    expect(deriveMatchModel(s).myTurn).toBe(true);
    expect(deriveMatchModel(run([{ type: "room_state", payload: room() }])).myTurn).toBe(true);
  });

  it("disables input once I'm eliminated from a showdown", () => {
    const s = run([
      { type: "room_state", payload: room({ settings: showdownSettings, endsAt: 100, lives: { a: 0, b: 2 } }) },
    ]);
    expect(deriveMatchModel(s).inputDisabled).toBe(true);
  });

  it("counts every player's named items only when the list is revealed", () => {
    const s = run([
      { type: "room_state", payload: room() },
      { type: "answer_result", payload: { accepted: true, isoCode: "fr" } },
      { type: "opponent_progress", payload: { playerId: "b", isoCode: "jp", filled: ["jp", "us"] } },
    ]);
    expect(deriveMatchModel(s).namedCount).toBe(1); // live race: mine only
    const over = matchReducer(s, { type: "game_over", payload: { winnerId: null, scores: {} } });
    expect(deriveMatchModel(over).namedCount).toBe(3);
  });
});
