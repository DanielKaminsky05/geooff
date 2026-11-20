import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startTestServer,
  connectClient,
  awaitEvent,
  expectNoEvent,
  type TestServer,
  type Socket,
} from "./fixtures/serverHarness.js";
import { rooms } from "../src/rooms.js";

/**
 * last_standing (turn-based lives) + solo survival.
 *
 * Timing is deterministic: countdownTickMs is tiny and turnMsOverride pins the
 * per-turn clock. Tests that must NOT time out use a long turn; the timeout
 * tests use a short one and race-free event awaits.
 */

// Stable members of the live countries set, each a distinct iso.
const FR = { text: "France", iso: "fr" };
const DE = { text: "Germany", iso: "de" };
const ES = { text: "Spain", iso: "es" };

let server: TestServer;
const openSockets: Socket[] = [];

function client(): Socket {
  const s = connectClient(server.url);
  openSockets.push(s);
  return s;
}

afterEach(async () => {
  for (const s of openSockets.splice(0)) {
    s.removeAllListeners();
    s.disconnect();
  }
  await server.close();
  vi.useRealTimers();
});

/** Create a 2-player room and switch it to last_standing (host sets the mode). */
async function makeLsRoom() {
  const a = client();
  await awaitEvent(a, "connect");
  a.emit("create_room", { playerName: "Alice" });
  const joinedA = await awaitEvent<any>(a, "joined");
  const code = joinedA.state.code as string;

  // Host selects last_standing before a second player readies up.
  const stateModed = awaitEvent<any>(a, "room_state");
  a.emit("update_settings", { mode: "last_standing", lives: 3 });
  await stateModed;

  const b = client();
  await awaitEvent(b, "connect");
  const playerJoinedA = awaitEvent<any>(a, "player_joined");
  b.emit("join_room", { code, playerName: "Bob" });
  const joinedB = await awaitEvent<any>(b, "joined");
  await playerJoinedA;

  return {
    a,
    b,
    code,
    aId: joinedA.playerId as string,
    bId: joinedB.playerId as string,
    tokenA: joinedA.reconnectToken as string,
  };
}

/** Ready both, start, and resolve once the first turn_started lands. */
async function startLs(ctx: Awaited<ReturnType<typeof makeLsRoom>>) {
  const { a, b, aId } = ctx;
  a.emit("set_ready", { ready: true });
  b.emit("set_ready", { ready: true });
  await awaitEvent(a, "player_ready");

  const turnA = awaitEvent<any>(a, "turn_started", 8000);
  a.emit("start_game");
  const t = await turnA;
  // Host (p1 = Alice) takes turn 1.
  expect(t.playerId).toBe(aId);
  return t;
}

describe("last standing — turns", () => {
  beforeEach(async () => {
    // Long turn so nothing times out mid-assertion.
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  it("a valid answer passes the turn to the opponent with a fresh clock", async () => {
    const ctx = await makeLsRoom();
    await startLs(ctx);
    const { a, aId, bId } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    const turn2 = awaitEvent<any>(a, "turn_started");
    a.emit("submit_answer", { text: FR.text });

    const r = await resA;
    expect(r.accepted).toBe(true);
    expect(r.isoCode).toBe(FR.iso);

    const t2 = await turn2;
    expect(t2.playerId).toBe(bId);
    expect(t2.endsAt).toBeGreaterThan(Date.now());
    // Turn runtime reflects the flip.
    expect(rooms.get(ctx.code)!.currentPlayerId).toBe(bId);
    // aId did not lose a life on a correct answer (sudden death → 1 life).
    expect(rooms.get(ctx.code)!.lives![aId]).toBe(1);
  });

  it("the non-current player is rejected with not_your_turn (no turn change)", async () => {
    const ctx = await makeLsRoom();
    await startLs(ctx);
    const { a, b, aId } = ctx;

    const resB = awaitEvent<any>(b, "answer_result");
    const noTurn = expectNoEvent(a, "turn_started", 300);
    b.emit("submit_answer", { text: DE.text });

    const r = await resB;
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("not_your_turn");
    await noTurn;
    expect(rooms.get(ctx.code)!.currentPlayerId).toBe(aId);
  });

  it("a wrong guess burns the clock but does NOT pass the turn", async () => {
    const ctx = await makeLsRoom();
    await startLs(ctx);
    const { a, aId } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    const noTurn = expectNoEvent(a, "turn_started", 300);
    a.emit("submit_answer", { text: "atlantis" });
    expect((await resA).reason).toBe("wrong");
    await noTurn;
    expect(rooms.get(ctx.code)!.currentPlayerId).toBe(aId);
  });

  it("an item claimed by one player is gone for the other (shared pool)", async () => {
    const ctx = await makeLsRoom();
    await startLs(ctx);
    const { a, b } = ctx;

    // A claims France, turn flips to B.
    const turnB = awaitEvent<any>(a, "turn_started");
    a.emit("submit_answer", { text: FR.text });
    await turnB;

    // B tries the same country → duplicate from the shared pool.
    const resB = awaitEvent<any>(b, "answer_result");
    b.emit("submit_answer", { text: FR.text });
    expect((await resB).reason).toBe("duplicate");
  });
});

describe("last standing — lives + elimination", () => {
  it("a turn timeout eliminates the current player (sudden death)", async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 80 });
    const ctx = await makeLsRoom();

    const { a, b, aId, bId } = ctx;
    a.emit("set_ready", { ready: true });
    b.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");

    const firstTurn = awaitEvent<any>(a, "turn_started", 8000);
    const lifeLost = awaitEvent<any>(a, "life_lost", 8000);
    const over = awaitEvent<any>(b, "game_over", 8000);
    a.emit("start_game");
    await firstTurn;

    // A never answers → A's clock runs out → A eliminated (one life) → B wins.
    const ll = await lifeLost;
    expect(ll.playerId).toBe(aId);
    expect(ll.livesLeft).toBe(0);
    expect((await over).winnerId).toBe(bId);
  }, 10000);

  it("reaching 0 lives ends the game with the OTHER player as winner", async () => {
    // lives:1 so the first timeout eliminates the current player.
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60 });
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice" });
    const joinedA = await awaitEvent<any>(a, "joined");
    const code = joinedA.state.code as string;
    const aId = joinedA.playerId as string;
    const stateModed = awaitEvent<any>(a, "room_state");
    a.emit("update_settings", { mode: "last_standing", lives: 1 });
    await stateModed;

    const b = client();
    await awaitEvent(b, "connect");
    const pj = awaitEvent<any>(a, "player_joined");
    b.emit("join_room", { code, playerName: "Bob" });
    const joinedB = await awaitEvent<any>(b, "joined");
    const bId = joinedB.playerId as string;
    await pj;

    a.emit("set_ready", { ready: true });
    b.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");

    const over = awaitEvent<any>(b, "game_over", 8000);
    a.emit("start_game");
    // A lets the only turn run out → A eliminated → B wins.
    const go = await over;
    expect(go.winnerId).toBe(bId);
    expect(rooms.get(code)!.phase).toBe("ended");
    // No turn timer leaked.
    expect(rooms.get(code)!.turnTimer).toBeUndefined();
    expect(rooms.get(code)!.currentPlayerId).toBeUndefined();
  }, 10000);
});

describe("last standing — disconnect pause / resume", () => {
  const GRACE_MS = 2000;

  beforeEach(async () => {
    server = await startTestServer({
      countdownTickMs: 10,
      turnMsOverride: 120,
      graceMs: GRACE_MS,
    });
  });

  it("the current player's disconnect pauses the clock (no life lost) and reconnect resumes it", async () => {
    const ctx = await makeLsRoom();
    await startLs(ctx);
    const { a, b, aId, code, tokenA } = ctx;

    // It's A's turn (turnMsOverride=120). Disconnect A immediately and wait
    // well past a full turn: the clock is paused, so A must NOT lose a life.
    const noLife = expectNoEvent(b, "life_lost", 350);
    a.disconnect();
    await noLife;
    // Still A's turn, paused.
    const room = rooms.get(code)!;
    expect(room.currentPlayerId).toBe(aId);
    expect(room.turnTimer).toBeUndefined();
    expect(room.pausedTurnMs).toBeGreaterThan(0);
    expect(room.lives![aId]).toBe(1);

    // Reconnect within grace → turn resumes for A.
    const a2 = client();
    await awaitEvent(a2, "connect");
    const resumed = awaitEvent<any>(a2, "turn_started", 4000);
    a2.emit("join_room", { code, playerName: "Alice", reconnectToken: tokenA });
    await awaitEvent(a2, "joined");
    const t = await resumed;
    expect(t.playerId).toBe(aId);
    expect(rooms.get(code)!.turnTimer).toBeTruthy();
    expect(rooms.get(code)!.pausedTurnMs).toBeUndefined();

    // Snapshot rehydrates turn + lives.
    const snap = rooms.get(code)!;
    expect(snap.currentPlayerId).toBe(aId);
    expect(snap.lives![aId]).toBe(1);
  }, 10000);
});

describe("last standing — multiplayer only", () => {
  beforeEach(async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  it("a private solo room is refused last_standing (needs_two)", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Solo", solo: true });
    const joined = await awaitEvent<any>(a, "joined");
    const code = joined.state.code as string;

    const err = awaitEvent<any>(a, "error_msg", 4000);
    a.emit("update_settings", { mode: "last_standing" });
    expect((await err).code).toBe("needs_two");
    // The mode never changed.
    expect(rooms.get(code)!.settings.mode).toBe("race");
  });

  it("a one-player room cannot start last_standing (needs_two)", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice" });
    const joined = await awaitEvent<any>(a, "joined");
    const code = joined.state.code as string;

    // A versus room with a single player may select the mode, but not start it.
    const moded = awaitEvent<any>(a, "room_state");
    a.emit("update_settings", { mode: "last_standing" });
    await moded;

    const err = awaitEvent<any>(a, "error_msg", 4000);
    a.emit("start_game");
    expect((await err).code).toBe("needs_two");
    expect(rooms.get(code)!.phase).toBe("lobby");
  });
});
