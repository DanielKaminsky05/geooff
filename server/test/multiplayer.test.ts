import { describe, it, expect, afterEach } from "vitest";
import {
  startTestServer,
  connectClient,
  awaitEvent,
  expectNoEvent,
  type TestServer,
  type Socket,
} from "./fixtures/serverHarness.js";
import type { CreateServerOptions } from "../src/index.js";
import { rooms, type Room } from "../src/rooms.js";
import { promptById, validIdsFor } from "../src/prompts.js";
import { countries } from "../src/data/countries.js";
import type { GameMode } from "../src/protocol.js";

/**
 * 3–4 player integration coverage across every mode: voluntary leaves (turn
 * holder and non-holder), disconnect + reconnect inside grace (rehydrate),
 * grace expiry, a game ending while a seat is away (sweep + rematch), lobby
 * host/slot handling, room capacity, and turns handed to an absent player.
 *
 * Every timer is pinned via createServer overrides, so nothing waits on
 * real-world clocks longer than a few hundred ms. Answers are derived from the
 * live room (shared pool / active prompt / own board) so they're always valid.
 */

const CATEGORY = "countries";
const isoToName = new Map(countries.map((c) => [c.iso, c.name]));
const NAMES = ["Alice", "Bob", "Cara", "Dan", "Eve"];

/** Defaults: fast countdown, long clocks, long grace, no rate limiting. */
const BASE: CreateServerOptions = {
  countdownTickMs: 5,
  graceMs: 60_000,
  turnMsOverride: 60_000,
  roundMsOverride: 60_000,
  raceMsOverride: 60_000,
  interRoundMsOverride: 30,
  rateLimits: { answer: false, events: false },
};

let server: TestServer | undefined;
const openSockets: Socket[] = [];

async function boot(opts: CreateServerOptions = {}): Promise<void> {
  server = await startTestServer({ ...BASE, ...opts });
}

function client(): Socket {
  const s = connectClient(server!.url);
  openSockets.push(s);
  return s;
}

afterEach(async () => {
  for (const s of openSockets.splice(0)) {
    s.removeAllListeners();
    s.disconnect();
  }
  if (server) await server.close();
  server = undefined;
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface Player {
  s: Socket;
  id: string;
  slot: string;
  token: string;
  name: string;
}

interface Ctx {
  code: string;
  mode: GameMode;
  players: Player[];
}

/** Resolve on the first `event` whose payload satisfies `pred`. */
function waitFor<T = any>(
  socket: Socket,
  event: string,
  pred: (p: T) => boolean = () => true,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for matching "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (!pred(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

const room = (code: string): Room => rooms.get(code)!;
const seatIds = (code: string) => room(code).players.map((p) => p.id);

/** Join `code` as a fresh socket; resolves with the seat. */
async function joinAs(code: string, name: string): Promise<Player> {
  const s = client();
  await awaitEvent(s, "connect");
  const joined = awaitEvent<any>(s, "joined");
  s.emit("join_room", { code, playerName: name });
  const j = await joined;
  return { s, id: j.playerId, slot: j.slot, token: j.reconnectToken, name };
}

/** Host + (n-1) guests in `mode`; extra settings are applied by the host. */
async function makeRoom(
  n: number,
  mode: GameMode,
  extra: Record<string, unknown> = {},
): Promise<Ctx> {
  const s = client();
  await awaitEvent(s, "connect");
  const joined = awaitEvent<any>(s, "joined");
  s.emit("create_room", { playerName: NAMES[0] });
  const j = await joined;
  const code = j.state.code as string;
  const host: Player = { s, id: j.playerId, slot: j.slot, token: j.reconnectToken, name: NAMES[0] };

  const moded = awaitEvent<any>(s, "room_state");
  s.emit("update_settings", { mode, ...extra });
  await moded;

  const players = [host];
  for (let i = 1; i < n; i++) players.push(await joinAs(code, NAMES[i]));
  expect(room(code).players).toHaveLength(n);
  return { code, mode, players };
}

/**
 * Everyone readies, the host starts. Resolves once play has begun everywhere
 * (game_started on all sockets, plus turn 1 / round 1 for the round-based modes).
 */
async function startGame(ctx: Ctx): Promise<void> {
  const host = ctx.players.find((p) => p.id === room(ctx.code).hostId)!;
  const allReady = waitFor<any>(host.s, "room_state", (st) =>
    st.players.every((p: any) => p.ready),
  );
  for (const p of ctx.players) p.s.emit("set_ready", { ready: true });
  await allReady;

  const started = ctx.players.map((p) => awaitEvent(p.s, "game_started", 3000));
  const first =
    ctx.mode === "showdown"
      ? awaitEvent(host.s, "round_started", 3000)
      : ctx.mode === "race"
        ? Promise.resolve()
        : awaitEvent(host.s, "turn_started", 3000);
  host.s.emit("start_game");
  await Promise.all([...started, first]);
  expect(room(ctx.code).phase).toBe("playing");
}

/** An unclaimed, valid answer for whoever acts next in this room. */
function freshAnswer(code: string, forPlayerId?: string): string {
  const r = room(code);
  if (r.settings.mode === "gauntlet" || r.settings.mode === "showdown") {
    const valid = [...validIdsFor(promptById(r.currentPromptId!)!, CATEGORY)];
    const taken =
      r.settings.mode === "gauntlet"
        ? r.claimedThisPrompt ?? new Set<string>()
        : r.players.find((p) => p.id === forPlayerId)?.filledThisPrompt ?? new Set<string>();
    return isoToName.get(valid.find((iso) => !taken.has(iso))!)!;
  }
  const taken =
    r.settings.mode === "last_standing"
      ? r.claimed ?? new Set<string>()
      : r.players.find((p) => p.id === forPlayerId)!.filled;
  return countries.find((c) => !taken.has(c.iso))!.name;
}

/** Submit a fresh valid answer as `p` and assert it was accepted. */
async function answer(code: string, p: Player): Promise<void> {
  const res = awaitEvent<any>(p.s, "answer_result");
  p.s.emit("submit_answer", { text: freshAnswer(code, p.id) });
  const r = await res;
  expect(r.accepted).toBe(true);
}

/** Answer correctly as the turn holder and await the next turn_started. */
async function answerAndPass(ctx: Ctx, p: Player, observer: Player): Promise<any> {
  const next = awaitEvent<any>(observer.s, "turn_started");
  await answer(ctx.code, p);
  return next;
}

/** Drop `p`'s socket; resolves once `observer` hears about it. */
async function drop(p: Player, observer: Player): Promise<void> {
  const heard = waitFor<any>(observer.s, "opponent_disconnected", (e) => e.playerId === p.id);
  p.s.disconnect();
  await heard;
}

/** Reconnect `p` on a fresh socket with its token; resolves with `joined`. */
async function reconnect(ctx: Ctx, p: Player): Promise<any> {
  const s = client();
  await awaitEvent(s, "connect");
  const joined = awaitEvent<any>(s, "joined");
  s.emit("join_room", { code: ctx.code, playerName: p.name, reconnectToken: p.token });
  p.s = s;
  return joined;
}

/** Voluntary leave; resolves once `observer` sees player_left. */
async function leave(p: Player, observer: Player): Promise<void> {
  const left = waitFor<any>(observer.s, "player_left", (e) => e.playerId === p.id);
  p.s.emit("leave_room");
  await left;
}

/** Everyone in `ps` requests a rematch; resolves on rematch_start. */
async function rematch(ps: Player[]): Promise<void> {
  const startedAll = ps.map((p) => awaitEvent(p.s, "rematch_start"));
  for (const p of ps) p.s.emit("request_rematch");
  await Promise.all(startedAll);
}

/** Server-side assertions that a room is back to a clean lobby. */
function expectCleanLobby(code: string): void {
  const r = room(code);
  expect(r.phase).toBe("lobby");
  expect(r.lives).toBeUndefined();
  expect(r.currentPlayerId).toBeUndefined();
  expect(r.turnEndsAt).toBeUndefined();
  expect(r.pausedTurnMs).toBeUndefined();
  expect(r.currentPromptId).toBeUndefined();
  expect(r.round).toBeUndefined();
  expect(r.endsAt).toBeUndefined();
  for (const seat of r.players) {
    expect(seat.score).toBe(0);
    expect(seat.ready).toBe(false);
    expect(seat.filled.size).toBe(0);
  }
}

/* ------------------------------------------------------------------ */
/* Lobby: host handoff, slot holes, capacity                           */
/* ------------------------------------------------------------------ */

describe("lobby with 3–4 seats", () => {
  it("host leaving reassigns the host; the new host can change settings and start", async () => {
    await boot();
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;

    const st = waitFor<any>(b.s, "room_state", (s) => s.hostId !== a.id);
    await leave(a, b);
    expect((await st).hostId).toBe(b.id);
    expect(room(ctx.code).hostId).toBe(b.id);

    // The old host's privileges moved with it.
    const moded = waitFor<any>(c.s, "room_state", (s) => s.settings.mode === "last_standing");
    b.s.emit("update_settings", { mode: "last_standing" });
    await moded;
    ctx.players = [b, c];
    ctx.mode = "last_standing";
    await startGame(ctx);
    expect(room(ctx.code).currentPlayerId).toBe(b.id); // new host takes turn 1
  });

  it("a host that DISCONNECTS in the lobby is removed and the host reassigned", async () => {
    await boot();
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    const left = waitFor<any>(c.s, "player_left", (e) => e.playerId === a.id);
    const st = waitFor<any>(c.s, "room_state", (s) => s.players.length === 2);
    a.s.disconnect();
    await left;
    expect((await st).hostId).toBe(b.id);
  });

  it("slot holes: a leaver's slot is refilled lowest-first; p1/p3 rooms play in slot order", async () => {
    await boot();
    const ctx = await makeRoom(4, "last_standing");
    const [a, b, c, d] = ctx.players;
    expect([a.slot, b.slot, c.slot, d.slot]).toEqual(["p1", "p2", "p3", "p4"]);

    // p2 and p4 leave → p1, p3 remain.
    await leave(b, a);
    await leave(d, a);
    expect(room(ctx.code).players.map((p) => p.slot)).toEqual(["p1", "p3"]);

    // A newcomer takes the LOWEST free slot (p2), not p4.
    const e = await joinAs(ctx.code, "Eve");
    expect(e.slot).toBe("p2");
    // And the next one takes p4.
    const f = await joinAs(ctx.code, "Fay");
    expect(f.slot).toBe("p4");

    // Play follows slot order p1 → p2 → p3 → p4 regardless of join order.
    ctx.players = [a, c, e, f];
    await startGame(ctx);
    expect((await answerAndPass(ctx, a, c)).playerId).toBe(e.id);
    expect((await answerAndPass(ctx, e, c)).playerId).toBe(c.id);
    expect((await answerAndPass(ctx, c, a)).playerId).toBe(f.id);
    expect((await answerAndPass(ctx, f, a)).playerId).toBe(a.id);
  });

  it("host p1 leaving a p1/p3 room hands host to p3; a newcomer then gets p1", async () => {
    await boot();
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await leave(b, a);
    await leave(a, c);
    expect(room(ctx.code).hostId).toBe(c.id);
    const e = await joinAs(ctx.code, "Eve");
    expect(e.slot).toBe("p1");
    expect(room(ctx.code).hostId).toBe(c.id); // joining doesn't steal host
  });

  it("room is full at 4: a 5th join gets room_full; once a seat frees up it can join", async () => {
    await boot();
    const ctx = await makeRoom(4, "race");
    const [a, b] = ctx.players;

    const fifth = client();
    await awaitEvent(fifth, "connect");
    const err = awaitEvent<any>(fifth, "error_msg");
    fifth.emit("join_room", { code: ctx.code, playerName: "Eve" });
    expect((await err).code).toBe("room_full");
    expect(room(ctx.code).players).toHaveLength(4);

    await leave(b, a);
    const joined = awaitEvent<any>(fifth, "joined");
    fifth.emit("join_room", { code: ctx.code, playerName: "Eve" });
    expect((await joined).slot).toBe("p2");
  });

  it("a full room mid-game still answers room_full (not in_progress) to a 5th player", async () => {
    await boot();
    const ctx = await makeRoom(4, "race");
    await startGame(ctx);
    const fifth = client();
    await awaitEvent(fifth, "connect");
    const err = awaitEvent<any>(fifth, "error_msg");
    fifth.emit("join_room", { code: ctx.code, playerName: "Eve" });
    expect((await err).code).toBe("room_full");
  });
});

/* ------------------------------------------------------------------ */
/* Race                                                                */
/* ------------------------------------------------------------------ */

describe("race with 3–4 players", () => {
  it("a leaver mid-game doesn't end a 3-player race; the second leaver forfeits to the last", async () => {
    await boot();
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, b);

    const noOver = expectNoEvent(a.s, "game_over", 200);
    await leave(b, a);
    await noOver;
    expect(room(ctx.code).phase).toBe("playing");
    expect(seatIds(ctx.code)).toEqual([a.id, c.id]);

    // Remaining players keep scoring; score_update no longer lists the leaver.
    const scores = awaitEvent<any>(a.s, "score_update");
    await answer(ctx.code, c);
    expect(Object.keys((await scores).scores).sort()).toEqual([a.id, c.id].sort());

    const over = awaitEvent<any>(a.s, "game_over");
    c.s.emit("leave_room");
    expect((await over).winnerId).toBe(a.id);
  });

  it("the host leaving a 4-player race mid-game reassigns host and play continues", async () => {
    await boot();
    const ctx = await makeRoom(4, "race");
    const [a, b, , d] = ctx.players;
    await startGame(ctx);
    const st = waitFor<any>(b.s, "room_state", (s) => s.players.length === 3);
    await leave(a, b);
    const snap = await st;
    expect(snap.hostId).toBe(b.id);
    expect(snap.phase).toBe("playing");
    await answer(ctx.code, d);
    expect(room(ctx.code).players.find((p) => p.id === d.id)!.score).toBe(1);
  });

  it("disconnect + reconnect within grace rehydrates the racer's filled set and clock", async () => {
    await boot();
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, b);
    await answer(ctx.code, b);
    await answer(ctx.code, c);
    const bFilled = [...room(ctx.code).players.find((p) => p.id === b.id)!.filled].sort();

    const cHeard = waitFor<any>(c.s, "opponent_disconnected", (e) => e.playerId === b.id);
    const disconnectedState = waitFor<any>(a.s, "room_state", (s) =>
      s.players.some((p: any) => p.id === b.id && !p.connected),
    );
    await drop(b, a);
    await cHeard; // every other racer is told, not just one
    await disconnectedState;

    const back = waitFor<any>(a.s, "opponent_reconnected", (e) => e.playerId === b.id);
    const j = await reconnect(ctx, b);
    await back;
    expect(j.playerId).toBe(b.id);
    expect(j.slot).toBe("p2");
    expect(j.state.phase).toBe("playing");
    expect(j.state.endsAt).toBe(room(ctx.code).endsAt);
    expect([...j.state.filled[b.id]].sort()).toEqual(bFilled);
    expect(j.state.filled[c.id]).toHaveLength(1);
    expect(j.state.players.find((p: any) => p.id === b.id).score).toBe(2);
    expect(j.state.players.every((p: any) => p.connected)).toBe(true);

    // The reattached seat keeps playing on the new socket.
    await answer(ctx.code, b);
    expect(room(ctx.code).players.find((p) => p.id === b.id)!.score).toBe(3);
  });

  it("grace expiry drops a no-show from a 3-player race and play continues; a second expiry ends it", async () => {
    await boot({ graceMs: 150 });
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await startGame(ctx);

    const leftB = waitFor<any>(a.s, "player_left", (e) => e.playerId === b.id, 2000);
    const noOver = expectNoEvent(a.s, "game_over", 400);
    b.s.disconnect();
    await leftB;
    await noOver;
    expect(room(ctx.code).phase).toBe("playing");
    expect(seatIds(ctx.code)).toEqual([a.id, c.id]);

    // Now a duel: C's grace expiry hands A the win even with fewer points.
    await answer(ctx.code, c);
    const over = awaitEvent<any>(a.s, "game_over", 2000);
    c.s.disconnect();
    const go = await over;
    expect(go.winnerId).toBe(a.id);
  });

  it("game ends while the HOST is away: host seat swept + reassigned, rematch resets, game 2 plays", async () => {
    await boot({ raceMsOverride: 400 });
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, b);
    await answer(ctx.code, c);
    await drop(a, b);

    const leftA = waitFor<any>(b.s, "player_left", (e) => e.playerId === a.id);
    const st = waitFor<any>(b.s, "room_state", (s) => s.phase === "ended" && s.players.length === 2);
    await awaitEvent(b.s, "game_over", 2000);
    await leftA;
    expect((await st).hostId).toBe(b.id);
    // A's old token is now useless.
    const stale = client();
    await awaitEvent(stale, "connect");
    const err = awaitEvent<any>(stale, "error_msg");
    stale.emit("join_room", { code: ctx.code, playerName: "Alice", reconnectToken: a.token });
    expect((await err).code).toBe("in_progress");

    await rematch([b, c]);
    expectCleanLobby(ctx.code);

    ctx.players = [b, c];
    await startGame(ctx);
    await answer(ctx.code, c);
    const go = await awaitEvent<any>(b.s, "game_over", 2000);
    expect(go.winnerId).toBe(c.id);
    expect(go.scores).toEqual({ [b.id]: 0, [c.id]: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Last Standing                                                       */
/* ------------------------------------------------------------------ */

describe("last_standing with 3–4 players", () => {
  it("4p: holder leave passes play to the next slot (wrapping p4→p1); non-holder leave changes nothing", async () => {
    await boot();
    const ctx = await makeRoom(4, "last_standing");
    const [a, b, c, d] = ctx.players;
    await startGame(ctx);
    // A → B.
    expect((await answerAndPass(ctx, a, c)).playerId).toBe(b.id);

    // Non-holder C leaves during B's turn: no turn change.
    const noTurn = expectNoEvent(a.s, "turn_started", 200);
    await leave(c, a);
    await noTurn;
    expect(room(ctx.code).currentPlayerId).toBe(b.id);

    // B answers → skips the removed p3 → D (p4).
    expect((await answerAndPass(ctx, b, a)).playerId).toBe(d.id);

    // Holder D (p4) leaves → wraps around to A (p1).
    const next = awaitEvent<any>(a.s, "turn_started");
    await leave(d, a);
    expect((await next).playerId).toBe(a.id);
    expect(room(ctx.code).phase).toBe("playing");

    // B leaves → A is the last one standing.
    const over = awaitEvent<any>(a.s, "game_over");
    b.s.emit("leave_room");
    expect((await over).winnerId).toBe(a.id);
  });

  it("3p: the holder leaving mid-turn hands the next slot a FRESH clock", async () => {
    await boot();
    const ctx = await makeRoom(3, "last_standing");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    const before = room(ctx.code).turnEndsAt!;
    const next = awaitEvent<any>(c.s, "turn_started");
    await leave(a, b);
    const t = await next;
    expect(t.playerId).toBe(b.id);
    expect(t.endsAt).toBeGreaterThanOrEqual(before);
    expect(room(ctx.code).hostId).toBe(b.id);
    expect(room(ctx.code).lives).toEqual({ [a.id]: 1, [b.id]: 1, [c.id]: 1 });
  });

  it("holder disconnect pauses the clock; reconnect rehydrates turn/pausedMs/lives/filled and resumes", async () => {
    await boot({ turnMsOverride: 5_000 });
    const ctx = await makeRoom(3, "last_standing");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answerAndPass(ctx, a, b); // → B
    const aFilled = [...room(ctx.code).players.find((p) => p.id === a.id)!.filled];

    const paused = waitFor<any>(c.s, "room_state", (s) => s.turn?.pausedMs !== undefined);
    await drop(b, a);
    const ps = await paused;
    expect(ps.turn.currentPlayerId).toBe(b.id);
    expect(ps.turn.pausedMs).toBeGreaterThan(0);
    expect(ps.turn.pausedMs).toBeLessThanOrEqual(5_000);
    expect(room(ctx.code).turnTimer).toBeUndefined();

    const resumed = waitFor<any>(a.s, "turn_started", (t) => t.playerId === b.id);
    const j = await reconnect(ctx, b);
    // The joined snapshot is taken before the clock resumes: it still shows paused.
    expect(j.state.turn.currentPlayerId).toBe(b.id);
    expect(j.state.turn.pausedMs).toBe(ps.turn.pausedMs);
    expect(j.state.lives).toEqual({ [a.id]: 1, [b.id]: 1, [c.id]: 1 });
    expect(j.state.filled[a.id]).toEqual(aFilled);
    await resumed;
    expect(room(ctx.code).pausedTurnMs).toBeUndefined();
    expect(room(ctx.code).turnTimer).toBeDefined();

    // B can act on its turn from the new socket; play moves on to C.
    expect((await answerAndPass(ctx, b, a)).playerId).toBe(c.id);
  });

  it("non-holder disconnect + reconnect doesn't touch the running turn", async () => {
    await boot();
    const ctx = await makeRoom(3, "last_standing");
    const [a, , c] = ctx.players;
    await startGame(ctx);
    const endsAt = room(ctx.code).turnEndsAt;
    const noTurn = expectNoEvent(a.s, "turn_started", 300);
    await drop(c, a);
    expect(room(ctx.code).pausedTurnMs).toBeUndefined();
    const j = await reconnect(ctx, c);
    await noTurn;
    expect(j.state.turn).toEqual({ currentPlayerId: a.id, endsAt });
    expect(room(ctx.code).turnEndsAt).toBe(endsAt);
  });

  it("a turn passed to a disconnected player starts paused and costs no life; it runs again on reconnect", async () => {
    await boot({ turnMsOverride: 250 });
    const ctx = await makeRoom(3, "last_standing");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await drop(b, a); // B away during A's turn

    const pausedSnap = waitFor<any>(a.s, "room_state", (s) => s.turn?.currentPlayerId === b.id);
    const noLife = expectNoEvent(a.s, "life_lost", 600);
    expect((await answerAndPass(ctx, a, c)).playerId).toBe(b.id);
    expect((await pausedSnap).turn.pausedMs).toBe(250);
    await noLife; // well past the 250ms turn clock
    expect(room(ctx.code).lives![b.id]).toBe(1);

    // B returns: the full turn now runs and its timeout eliminates B; C plays on.
    const lost = waitFor<any>(a.s, "life_lost", (e) => e.playerId === b.id, 2000);
    const toC = waitFor<any>(a.s, "turn_started", (t) => t.playerId === c.id, 2000);
    const j = await reconnect(ctx, b);
    expect(j.state.turn.pausedMs).toBe(250);
    expect((await lost).livesLeft).toBe(0);
    await toC;
    expect(room(ctx.code).phase).toBe("playing");
  });

  it("grace expiry of the paused holder removes the seat and play passes on", async () => {
    await boot({ graceMs: 200 });
    const ctx = await makeRoom(3, "last_standing");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answerAndPass(ctx, a, c); // → B
    const left = waitFor<any>(a.s, "player_left", (e) => e.playerId === b.id, 2000);
    const toC = waitFor<any>(a.s, "turn_started", (t) => t.playerId === c.id, 2000);
    b.s.disconnect();
    await left;
    await toC;
    expect(seatIds(ctx.code)).toEqual([a.id, c.id]);
    expect(room(ctx.code).pausedTurnMs).toBeUndefined();

    // Then a 2-seat game: C's grace expiry forfeits to A.
    const over = awaitEvent<any>(a.s, "game_over", 2000);
    c.s.disconnect();
    expect((await over).winnerId).toBe(a.id);
  });

  it("grace expiry of a NON-holder leaves the turn alone", async () => {
    await boot({ graceMs: 150 });
    const ctx = await makeRoom(4, "last_standing");
    const [a, b, , d] = ctx.players;
    await startGame(ctx);
    const left = waitFor<any>(a.s, "player_left", (e) => e.playerId === d.id, 2000);
    const noTurn = expectNoEvent(a.s, "turn_started", 400);
    d.s.disconnect();
    await left;
    await noTurn;
    expect(room(ctx.code).currentPlayerId).toBe(a.id);
    expect(room(ctx.code).lives![d.id]).toBe(1); // lives map keeps the key, harmlessly
    expect((await answerAndPass(ctx, a, b)).playerId).toBe(b.id);
  });

  it("game ends while a player is away: seat swept, rematch resets turn/lives, game 2 plays", async () => {
    // Short turns: A then B time out (sudden death) while C is disconnected, so
    // absent C is the last one standing and the match ends with C still away.
    await boot({ turnMsOverride: 300 });
    const ctx = await makeRoom(3, "last_standing");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await drop(c, a);

    const swept = waitFor<any>(a.s, "room_state", (s) => s.phase === "ended" && s.players.length === 2, 3000);
    const go = await awaitEvent<any>(a.s, "game_over", 3000);
    expect(go.winnerId).toBe(c.id);
    expect((await swept).turn).toBeUndefined();
    expect(seatIds(ctx.code)).toEqual([a.id, b.id]);

    const lobby = waitFor<any>(a.s, "room_state", (s) => s.phase === "lobby");
    await rematch([a, b]);
    expectCleanLobby(ctx.code);
    const snap = await lobby;
    expect(snap.turn).toBeUndefined();
    expect(snap.lives).toBeUndefined();
    expect(snap.filled).toEqual({ [a.id]: [], [b.id]: [] });
    expect(snap.players.map((p: any) => p.score)).toEqual([0, 0]);

    // Game 2: fresh lives, host takes turn 1, normal play.
    ctx.players = [a, b];
    await startGame(ctx);
    expect(room(ctx.code).lives).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(room(ctx.code).currentPlayerId).toBe(a.id);
    expect((await answerAndPass(ctx, a, b)).playerId).toBe(b.id);
    expect(room(ctx.code).players.find((p) => p.id === a.id)!.score).toBe(1);
  });
});


/* ------------------------------------------------------------------ */
/* Gauntlet                                                            */
/* ------------------------------------------------------------------ */

describe("gauntlet with 3–4 players", () => {
  it("4p: non-holder leave keeps turn + prompt; holder leave cycles the prompt and wraps to p1", async () => {
    await boot();
    const ctx = await makeRoom(4, "gauntlet", { lives: 3 });
    const [a, b, c, d] = ctx.players;
    await startGame(ctx);
    expect((await answerAndPass(ctx, a, b)).playerId).toBe(b.id);
    expect((await answerAndPass(ctx, b, a)).playerId).toBe(c.id);

    // Non-holder B leaves: prompt and turn unchanged.
    const promptBefore = room(ctx.code).currentPromptId;
    const noPrompt = expectNoEvent(a.s, "prompt_changed", 200);
    await leave(b, a);
    await noPrompt;
    expect(room(ctx.code).currentPromptId).toBe(promptBefore);
    expect(room(ctx.code).currentPlayerId).toBe(c.id);

    expect((await answerAndPass(ctx, c, a)).playerId).toBe(d.id);

    // Holder D (p4) leaves: a fresh prompt, then A (p1) gets the turn.
    const pc = awaitEvent<any>(a.s, "prompt_changed");
    const next = awaitEvent<any>(a.s, "turn_started");
    await leave(d, a);
    const p = await pc;
    expect(p.id).not.toBe(promptBefore);
    expect((await next).playerId).toBe(a.id);
    expect(room(ctx.code).claimedThisPrompt!.size).toBe(0);

    // C leaves → A wins.
    const over = awaitEvent<any>(a.s, "game_over");
    c.s.emit("leave_room");
    expect((await over).winnerId).toBe(a.id);
  });

  it("4p reconnect rehydrates prompt, per-prompt filled, lives and turn", async () => {
    await boot();
    const ctx = await makeRoom(4, "gauntlet", { lives: 4 });
    const [a, b, c, d] = ctx.players;
    await startGame(ctx);
    await answerAndPass(ctx, a, b);
    await answerAndPass(ctx, b, a);
    await answerAndPass(ctx, c, a); // → D
    const r = room(ctx.code);
    const cThisPrompt = [...r.players.find((p) => p.id === c.id)!.filledThisPrompt!];
    expect(cThisPrompt).toHaveLength(1);

    await drop(c, a);
    const j = await reconnect(ctx, c);
    expect(j.state.prompt.id).toBe(r.currentPromptId);
    expect(j.state.prompt.total).toBe(validIdsFor(promptById(r.currentPromptId!)!, CATEGORY).size);
    expect(j.state.filled[c.id]).toEqual(cThisPrompt);
    expect(j.state.filled[a.id]).toHaveLength(1);
    expect(j.state.lives).toEqual({ [a.id]: 4, [b.id]: 4, [c.id]: 4, [d.id]: 4 });
    expect(j.state.turn.currentPlayerId).toBe(d.id);
    expect(j.state.turn.pausedMs).toBeUndefined();
    // Never the valid set.
    expect(JSON.stringify(j.state)).not.toContain("validIds");
  });

  it("a turn passed to an absent p4 starts paused (no life lost); grace expiry wraps to p1 with a new prompt", async () => {
    await boot({ turnMsOverride: 200, graceMs: 700 });
    const ctx = await makeRoom(4, "gauntlet", { lives: 2 });
    const [a, b, c, d] = ctx.players;
    await startGame(ctx);
    await drop(d, a);
    await answerAndPass(ctx, a, b);
    await answerAndPass(ctx, b, a);

    const noLife = expectNoEvent(a.s, "life_lost", 300);
    expect((await answerAndPass(ctx, c, a)).playerId).toBe(d.id);
    expect(room(ctx.code).pausedTurnMs).toBe(200);
    const promptAtD = room(ctx.code).currentPromptId;
    await noLife;
    expect(room(ctx.code).lives![d.id]).toBe(2);

    const left = waitFor<any>(a.s, "player_left", (e) => e.playerId === d.id, 2000);
    const pc = awaitEvent<any>(a.s, "prompt_changed", 2000);
    const toA = waitFor<any>(a.s, "turn_started", (t) => t.playerId === a.id, 2000);
    await left;
    expect((await pc).id).not.toBe(promptAtD);
    await toA;
    expect(seatIds(ctx.code)).toEqual([a.id, b.id, c.id]);
  });

  it("game ends while a player is away: seat swept, rematch clears prompt/lives, game 2 plays", async () => {
    // lives 1 + short turns: A then B time out while C is away → C survives.
    await boot({ turnMsOverride: 300 });
    const ctx = await makeRoom(3, "gauntlet", { lives: 1 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await drop(c, a);

    const swept = waitFor<any>(a.s, "room_state", (s) => s.phase === "ended" && s.players.length === 2, 3000);
    const go = await awaitEvent<any>(a.s, "game_over", 3000);
    expect(go.winnerId).toBe(c.id);
    await swept;
    expect(seatIds(ctx.code)).toEqual([a.id, b.id]);

    const lobby = waitFor<any>(a.s, "room_state", (s) => s.phase === "lobby");
    await rematch([a, b]);
    expectCleanLobby(ctx.code);
    const snap = await lobby;
    expect(snap.prompt).toBeUndefined();
    expect(snap.lives).toBeUndefined();
    expect(snap.turn).toBeUndefined();

    ctx.players = [a, b];
    const pc = awaitEvent<any>(b.s, "prompt_changed", 3000);
    await startGame(ctx);
    expect((await pc).id).toBe(room(ctx.code).currentPromptId);
    expect(room(ctx.code).lives).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect((await answerAndPass(ctx, a, b)).playerId).toBe(b.id);
  });

  // Regression: roomStateOf serves gauntlet/showdown `filled` from
  // filledThisPrompt, so resetForRematch must clear it or the rematch lobby
  // snapshot would carry the previous game's per-prompt board.
  it("rematch lobby snapshot has empty filled boards in gauntlet (filledThisPrompt leak)", async () => {
    await boot({ turnMsOverride: 300 });
    const ctx = await makeRoom(3, "gauntlet", { lives: 1 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    // A times out (out) → B's turn; B answers → C's turn; C (holder) leaves →
    // B is the sole survivor, and the game ends with B's claim still on the board.
    await waitFor<any>(a.s, "turn_started", (t) => t.playerId === b.id, 2000);
    await answerAndPass(ctx, b, a);
    const over = awaitEvent<any>(a.s, "game_over");
    c.s.emit("leave_room");
    expect((await over).winnerId).toBe(b.id);

    const lobby = waitFor<any>(a.s, "room_state", (s) => s.phase === "lobby");
    await rematch([a, b]);
    expect((await lobby).filled).toEqual({ [a.id]: [], [b.id]: [] });
  });
});

/* ------------------------------------------------------------------ */
/* Showdown                                                            */
/* ------------------------------------------------------------------ */

describe("showdown with 3–4 players", () => {
  it("3p: a leaver mid-round doesn't end the round; it's excluded from the result; next leaver ends it", async () => {
    await boot({ roundMsOverride: 400 });
    const ctx = await makeRoom(3, "showdown", { lives: 3 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, a);
    await answer(ctx.code, b);

    const noOver = expectNoEvent(a.s, "game_over", 150);
    await leave(c, a);
    await noOver;
    expect(room(ctx.code).phase).toBe("playing");
    expect(room(ctx.code).endsAt).toBeDefined(); // round still running

    const result = await awaitEvent<any>(a.s, "round_result", 2000);
    expect(Object.keys(result.counts).sort()).toEqual([a.id, b.id].sort());
    expect(result.tie).toBe(true);

    const over = awaitEvent<any>(a.s, "game_over");
    b.s.emit("leave_room");
    expect((await over).winnerId).toBe(a.id);
  });

  it("4p: the host leaving reassigns host; the next round runs with the 3 remaining", async () => {
    await boot({ roundMsOverride: 300 });
    const ctx = await makeRoom(4, "showdown", { lives: 3 });
    const [a, b, c, d] = ctx.players;
    await startGame(ctx);
    await leave(a, b);
    expect(room(ctx.code).hostId).toBe(b.id);
    await answer(ctx.code, b);
    await answer(ctx.code, c);
    const r1 = await awaitEvent<any>(b.s, "round_result", 2000);
    expect(r1.losers).toEqual([d.id]);
    const r2 = await awaitEvent<any>(b.s, "round_started", 2000);
    expect(r2.round).toBe(2);
    expect(room(ctx.code).lives).toMatchObject({ [b.id]: 3, [c.id]: 3, [d.id]: 2 });
  });

  it("reconnect rehydrates the viewer's OWN filled, everyone's roundCounts, round, prompt and lives", async () => {
    await boot();
    const ctx = await makeRoom(3, "showdown", { lives: 2 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, a);
    await answer(ctx.code, b);
    await answer(ctx.code, b);
    const r = room(ctx.code);
    const bMine = [...r.players.find((p) => p.id === b.id)!.filledThisPrompt!];

    // While B is away, A and C's snapshots carry only their own boards.
    const aSnap = waitFor<any>(a.s, "room_state", (s) =>
      s.players.some((p: any) => p.id === b.id && !p.connected),
    );
    const cSnap = waitFor<any>(c.s, "room_state", (s) =>
      s.players.some((p: any) => p.id === b.id && !p.connected),
    );
    await drop(b, a);
    expect(Object.keys((await aSnap).filled)).toEqual([a.id]);
    expect((await cSnap).filled).toEqual({ [c.id]: [] });

    const back = waitFor<any>(c.s, "room_state", (s) => s.players.every((p: any) => p.connected));
    const j = await reconnect(ctx, b);
    expect(j.state.filled).toEqual({ [b.id]: bMine });
    expect(j.state.roundCounts).toEqual({ [a.id]: 1, [b.id]: 2, [c.id]: 0 });
    expect(j.state.round).toBe(1);
    expect(j.state.prompt.id).toBe(r.currentPromptId);
    expect(j.state.lives).toEqual({ [a.id]: 2, [b.id]: 2, [c.id]: 2 });
    expect(j.state.endsAt).toBe(r.endsAt);
    // The rebroadcast after the reconnect is still per-viewer.
    expect((await back).filled).toEqual({ [c.id]: [] });

    // B's own duplicates are still remembered on the new socket.
    const dup = awaitEvent<any>(b.s, "answer_result");
    b.s.emit("submit_answer", { text: isoToName.get(bMine[0])! });
    expect((await dup).reason).toBe("duplicate");
  });

  it("an absent player keeps losing hearts; grace expiry removes them; next expiry forfeits to the present", async () => {
    await boot({ roundMsOverride: 250, graceMs: 450 });
    const ctx = await makeRoom(3, "showdown", { lives: 5 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await drop(c, a);
    await answer(ctx.code, a);
    await answer(ctx.code, b);
    const r1 = await awaitEvent<any>(a.s, "round_result", 2000);
    expect(r1.losers).toEqual([c.id]);

    await waitFor<any>(a.s, "player_left", (e) => e.playerId === c.id, 2000);
    expect(room(ctx.code).phase).toBe("playing");
    expect(seatIds(ctx.code)).toEqual([a.id, b.id]);

    const over = awaitEvent<any>(a.s, "game_over", 2000);
    b.s.disconnect();
    expect((await over).winnerId).toBe(a.id);
  });

  it("game ends while a player is away: seat swept, rematch resets round/lives/prompt, game 2 plays", async () => {
    await boot({ roundMsOverride: 250 });
    const ctx = await makeRoom(3, "showdown", { lives: 1 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await drop(c, a);
    // Round 1: A and B name one each, absent C names none → C eliminated.
    await answer(ctx.code, a);
    await answer(ctx.code, b);
    const r1 = await awaitEvent<any>(a.s, "round_result", 2000);
    expect(r1.eliminated).toEqual([c.id]);
    // Round 2: A out-names B → B eliminated → A wins; C is still "away".
    await awaitEvent<any>(a.s, "round_started", 2000);
    await answer(ctx.code, a);
    const swept = waitFor<any>(a.s, "room_state", (s) => s.phase === "ended" && s.players.length === 2, 2000);
    const go = await awaitEvent<any>(a.s, "game_over", 2000);
    expect(go.winnerId).toBe(a.id);
    await swept;
    expect(seatIds(ctx.code)).toEqual([a.id, b.id]);

    await rematch([a, b]);
    expectCleanLobby(ctx.code);

    ctx.players = [a, b];
    const pc = awaitEvent<any>(b.s, "prompt_changed", 3000);
    await startGame(ctx);
    await pc;
    expect(room(ctx.code).round).toBe(1);
    expect(room(ctx.code).lives).toEqual({ [a.id]: 1, [b.id]: 1 });
    await answer(ctx.code, b);
    const go2 = await awaitEvent<any>(a.s, "game_over", 2000);
    expect(go2.winnerId).toBe(b.id);
  });

  // Regression: resetForRematch must clear filledThisPrompt (showdown's board).
  it("rematch lobby snapshot has empty filled boards in showdown (filledThisPrompt leak)", async () => {
    await boot({ roundMsOverride: 200 });
    const ctx = await makeRoom(3, "showdown", { lives: 1 });
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, a);
    await answer(ctx.code, a);
    await answer(ctx.code, b);
    await awaitEvent<any>(a.s, "round_result", 2000); // C eliminated
    await awaitEvent<any>(a.s, "round_started", 2000);
    await answer(ctx.code, a);
    await awaitEvent<any>(a.s, "game_over", 2000);

    const lobbySnap = waitFor<any>(a.s, "room_state", (s) => s.phase === "lobby");
    await rematch([a, b, c]);
    expect((await lobbySnap).filled).toEqual({ [a.id]: [] });
  });
});

/* ------------------------------------------------------------------ */
/* Rematch edge cases                                                  */
/* ------------------------------------------------------------------ */

describe("rematch with 3+ players", () => {
  // Regression: a holdout leaving the ended room must re-run the "everyone
  // requested" check, or the remaining players wait forever.
  it("the remaining players rematch when the only holdout leaves the ended room", async () => {
    await boot({ raceMsOverride: 200 });
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await awaitEvent(a.s, "game_over", 2000);

    const reqB = waitFor<any>(a.s, "rematch_requested", (e) => e.playerId === b.id);
    a.s.emit("request_rematch");
    b.s.emit("request_rematch");
    await reqB;

    const started = awaitEvent(a.s, "rematch_start", 1000);
    c.s.emit("leave_room");
    await started;
    expect(room(ctx.code).phase).toBe("lobby");
  });

  it("3 players can all rematch and play a second race normally", async () => {
    await boot({ raceMsOverride: 250 });
    const ctx = await makeRoom(3, "race");
    const [a, b, c] = ctx.players;
    await startGame(ctx);
    await answer(ctx.code, b);
    await awaitEvent(a.s, "game_over", 2000);
    await rematch([a, b, c]);
    expectCleanLobby(ctx.code);
    await startGame(ctx);
    await answer(ctx.code, c);
    await answer(ctx.code, c);
    await answer(ctx.code, a);
    const go = await awaitEvent<any>(a.s, "game_over", 2000);
    expect(go.winnerId).toBe(c.id);
    expect(go.scores).toEqual({ [a.id]: 1, [b.id]: 0, [c.id]: 2 });
  });
});
