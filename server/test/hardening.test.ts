import { describe, it, expect, afterEach } from "vitest";
import {
  startTestServer,
  connectClient,
  awaitEvent,
  expectNoEvent,
  type TestServer,
  type Socket,
} from "./fixtures/serverHarness.js";
import { rooms } from "../src/rooms.js";
import { MAX_HTTP_BUFFER_SIZE, type CreateServerOptions } from "../src/index.js";
import {
  MAX_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  parseAck,
  parseCreateRoom,
  parseJoinRoom,
  parseSetReady,
  parseSubmitAnswer,
  parseUpdateSettings,
  sanitizeName,
} from "../src/validate.js";
import { TokenBucket } from "../src/rateLimit.js";

let server: TestServer | undefined;
const openSockets: Socket[] = [];

async function boot(options?: CreateServerOptions): Promise<TestServer> {
  server = await startTestServer(options);
  return server;
}

async function client(): Promise<Socket> {
  const s = connectClient(server!.url);
  openSockets.push(s);
  await awaitEvent(s, "connect");
  return s;
}

afterEach(async () => {
  for (const s of openSockets.splice(0)) {
    s.removeAllListeners();
    s.disconnect();
  }
  await server?.close();
  server = undefined;
});

/** Collect every `event` payload received on a socket. */
function collect<T = any>(socket: Socket, event: string): T[] {
  const out: T[] = [];
  socket.on(event, (p: T) => out.push(p));
  return out;
}

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** A solo host in a "playing" race room. */
async function soloPlaying() {
  const a = await client();
  a.emit("create_room", { playerName: "Alice", solo: true });
  const joined = await awaitEvent<any>(a, "joined");
  const started = awaitEvent<any>(a, "game_started", 5000);
  a.emit("start_game");
  await started;
  return { a, code: joined.state.code as string, id: joined.playerId as string };
}

/* ------------------------------------------------------------------ */
/* Pure units                                                          */
/* ------------------------------------------------------------------ */

describe("TokenBucket", () => {
  it("allows a burst, then refills over time from the injected clock", () => {
    let t = 0;
    const b = new TokenBucket({ burst: 3, refillPerSec: 2 }, () => t);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    t += 499; // 0.998 tokens — not yet one
    expect(b.take()).toBe(false);
    t += 2; // crosses one token
    expect(b.take()).toBe(true);
    t += 60_000; // refill caps at burst
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });
});

describe("validate", () => {
  it("sanitizeName trims, caps at MAX_NAME_LENGTH, and falls back when empty", () => {
    expect(sanitizeName("  Alice  ", "P")).toBe("Alice");
    expect(sanitizeName("   ", "P")).toBe("P");
    expect(sanitizeName(undefined, "P")).toBe("P");
    expect(sanitizeName("x".repeat(100), "P")).toHaveLength(MAX_NAME_LENGTH);
    // Never splits a surrogate pair.
    expect(Array.from(sanitizeName("😀".repeat(50), "P"))).toHaveLength(MAX_NAME_LENGTH);
  });

  it("parseCreateRoom tolerates a missing payload but rejects wrong types", () => {
    expect(parseCreateRoom(undefined)).toEqual({ playerName: "Player 1", solo: false });
    expect(parseCreateRoom(null)).toEqual({ playerName: "Player 1", solo: false });
    expect(parseCreateRoom({ playerName: "Al", solo: true })).toEqual({ playerName: "Al", solo: true });
    expect(parseCreateRoom(42)).toBeNull();
    expect(parseCreateRoom({ playerName: { evil: 1 } })).toBeNull();
    expect(parseCreateRoom({ playerName: "Al", solo: "yes" })).toBeNull();
  });

  it("parseJoinRoom requires a string code", () => {
    expect(parseJoinRoom({ code: "abc123", playerName: "Bo" })).toEqual({
      code: "ABC123",
      playerName: "Bo",
    });
    expect(parseJoinRoom({ code: "ABC123", playerName: "Bo", reconnectToken: null })).toEqual({
      code: "ABC123",
      playerName: "Bo",
    });
    expect(parseJoinRoom(undefined)).toBeNull();
    expect(parseJoinRoom({ code: {} })).toBeNull();
    expect(parseJoinRoom({ code: ["ABC123"] })).toBeNull();
    expect(parseJoinRoom({ code: "ABC123", reconnectToken: 5 })).toBeNull();
    expect(parseJoinRoom({ code: "A".repeat(1000) })).toBeNull();
  });

  it("parseSetReady / parseSubmitAnswer / parseUpdateSettings type-check fields", () => {
    expect(parseSetReady({ ready: true })).toEqual({ ready: true });
    expect(parseSetReady({ ready: "yes" })).toBeNull();
    expect(parseSetReady(undefined)).toBeNull();
    expect(parseSubmitAnswer({ text: "France" })).toEqual({ text: "France" });
    expect(parseSubmitAnswer(undefined)).toBeNull();
    expect(parseSubmitAnswer({ text: 12 })).toBeNull();
    expect(parseUpdateSettings({ lives: 3, mode: "race" })).toEqual({ lives: 3, mode: "race" });
    expect(parseUpdateSettings({ lives: "abc" })).toBeNull();
    expect(parseUpdateSettings({ timeLimitSeconds: "300" })).toBeNull();
    expect(parseUpdateSettings({ categoryId: 7 })).toBeNull();
    expect(parseUpdateSettings([])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Rate limiting (over the wire)                                       */
/* ------------------------------------------------------------------ */

describe("rate limiting", () => {
  it("drops over-limit answers without scoring them, and refills with the clock", async () => {
    let clock = 1_000_000;
    await boot({
      countdownTickMs: 10,
      now: () => clock,
      rateLimits: { answer: { burst: 3, refillPerSec: 1 } },
    });
    const { a, code, id } = await soloPlaying();
    const results = collect<any>(a, "answer_result");
    const errors = collect<any>(a, "error_msg");

    a.emit("submit_answer", { text: "zzz" });
    a.emit("submit_answer", { text: "zzz" });
    a.emit("submit_answer", { text: "zzz" });
    a.emit("submit_answer", { text: "France" }); // over the limit → dropped
    await tick();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.reason === "wrong")).toBe(true);
    expect(errors.map((e) => e.code)).toEqual(["rate_limited"]);
    expect(rooms.get(code)!.players.find((p) => p.id === id)!.score).toBe(0);

    // One second later one token is back: the same answer now scores.
    clock += 1000;
    const res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "France" });
    expect(await res).toMatchObject({ accepted: true, isoCode: "fr" });
    expect(rooms.get(code)!.players.find((p) => p.id === id)!.score).toBe(1);
  });

  it("default limits: a script firing a long list is throttled after the burst", async () => {
    await boot({ countdownTickMs: 10 });
    const { a } = await soloPlaying();
    const results = collect<any>(a, "answer_result");
    const errors = collect<any>(a, "error_msg");
    for (let i = 0; i < 40; i++) a.emit("submit_answer", { text: `nope${i}` });
    await tick(300);
    // Burst of 8 plus at most a token or two of refill during the flood.
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.length).toBeLessThan(12);
    expect(errors.filter((e) => e.code === "rate_limited").length).toBe(40 - results.length);
  });

  it("default limits: human-paced answers are never limited", async () => {
    let clock = 0;
    await boot({ countdownTickMs: 10, now: () => clock });
    const { a } = await soloPlaying();
    const errors = collect<any>(a, "error_msg");
    // 30 answers at 4/s (250ms apart) — faster than anyone types country names.
    for (let i = 0; i < 30; i++) {
      const res = awaitEvent<any>(a, "answer_result");
      a.emit("submit_answer", { text: `nope${i}` });
      await res;
      clock += 250;
    }
    expect(errors).toHaveLength(0);
  });

  it("limits other events with the generic bucket (e.g. create_room spam)", async () => {
    let clock = 0;
    await boot({ now: () => clock, rateLimits: { events: { burst: 2, refillPerSec: 1 } } });
    const a = await client();
    const joined = collect<any>(a, "joined");
    const errors = collect<any>(a, "error_msg");
    a.emit("create_room", { playerName: "A" });
    a.emit("create_room", { playerName: "A" });
    a.emit("create_room", { playerName: "A" });
    a.emit("create_room", { playerName: "A" });
    await tick();
    expect(joined).toHaveLength(2);
    expect(errors.map((e) => e.code)).toEqual(["rate_limited", "rate_limited"]);
    // Only one room survives: the second create vacated the first.
    expect(rooms.size).toBe(1);
    clock += 1000;
    const again = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "A" });
    await again;
  });

  it("answers and other events use separate buckets", async () => {
    let clock = 0;
    await boot({
      countdownTickMs: 10,
      now: () => clock,
      rateLimits: { answer: { burst: 1, refillPerSec: 0.001 } },
    });
    const { a } = await soloPlaying();
    const errors = collect<any>(a, "error_msg");
    a.emit("submit_answer", { text: "zzz" });
    a.emit("submit_answer", { text: "zzz" }); // limited
    await tick();
    expect(errors.map((e) => e.code)).toEqual(["rate_limited"]);
    // A non-answer event still goes through.
    const ended = awaitEvent<any>(a, "game_over");
    a.emit("give_up");
    await ended;
  });
});

describe("time_sync", () => {
  it("parseAck accepts only functions", () => {
    const fn = () => {};
    expect(parseAck(fn)).toBe(fn);
    for (const bad of [undefined, null, 1, "x", {}, []]) expect(parseAck(bad)).toBeNull();
  });

  it("acks with the server's Date.now()", async () => {
    await boot();
    const a = await client();
    const before = Date.now();
    const serverNow = await new Promise<number>((resolve) => a.emit("time_sync", resolve));
    expect(typeof serverNow).toBe("number");
    expect(serverNow).toBeGreaterThanOrEqual(before);
    expect(serverNow).toBeLessThanOrEqual(Date.now());
  });

  it("rejects a time_sync without an ack callback", async () => {
    await boot();
    const a = await client();
    const err = awaitEvent<any>(a, "error_msg");
    a.emit("time_sync", 123);
    expect((await err).code).toBe("bad_payload");
  });

  it("goes through the generic rate-limit bucket", async () => {
    let clock = 0;
    await boot({ now: () => clock, rateLimits: { events: { burst: 2, refillPerSec: 1 } } });
    const a = await client();
    const errors = collect<any>(a, "error_msg");
    const acks: number[] = [];
    for (let i = 0; i < 4; i++) a.emit("time_sync", (t: number) => acks.push(t));
    await tick();
    expect(acks).toHaveLength(2);
    expect(errors.map((e) => e.code)).toEqual(["rate_limited", "rate_limited"]);
  });
});

/* ------------------------------------------------------------------ */
/* Size caps                                                           */
/* ------------------------------------------------------------------ */

describe("size caps", () => {
  it(`rejects answers longer than ${MAX_ANSWER_LENGTH} chars as wrong, before normalizing`, async () => {
    await boot({ countdownTickMs: 10 });
    const { a, code, id } = await soloPlaying();
    // Normalizes to "france", but is too long to even be considered.
    let res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "France" + " ".repeat(MAX_ANSWER_LENGTH) });
    expect(await res).toEqual({ accepted: false, reason: "wrong" });
    expect(rooms.get(code)!.players.find((p) => p.id === id)!.score).toBe(0);
    // Exactly at the cap is still processed normally.
    res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "France".padEnd(MAX_ANSWER_LENGTH, " ") });
    expect(await res).toMatchObject({ accepted: true, isoCode: "fr" });
  });

  it("caps player names at 40 chars after trimming; blank names get the default", async () => {
    await boot();
    const a = await client();
    let joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "   " + "x".repeat(60) + "   " });
    const ja = await joined;
    expect(ja.state.players[0].name).toBe("x".repeat(MAX_NAME_LENGTH));

    const b = await client();
    joined = awaitEvent<any>(b, "joined");
    b.emit("join_room", { code: ja.state.code, playerName: "  \t  " });
    const jb = await joined;
    expect(jb.state.players.find((p: any) => p.id === jb.playerId).name).toBe("Player 2");

    const c = await client();
    joined = awaitEvent<any>(c, "joined");
    c.emit("create_room", { playerName: "" });
    expect((await joined).state.players[0].name).toBe("Player 1");
  });

  it("drops a connection that sends a message larger than maxHttpBufferSize", async () => {
    await boot();
    const a = await client();
    const gone = awaitEvent<any>(a, "disconnect");
    a.emit("create_room", { playerName: "x".repeat(MAX_HTTP_BUFFER_SIZE + 1024) });
    await gone;
    expect(rooms.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Payload validation                                                  */
/* ------------------------------------------------------------------ */

describe("bad payloads", () => {
  it("join_room with an object code → bad_payload, and the connection survives", async () => {
    await boot();
    const a = await client();
    const err = awaitEvent<any>(a, "error_msg");
    a.emit("join_room", { code: { $gt: "" }, playerName: "Eve" } as any);
    expect((await err).code).toBe("bad_payload");
    const joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "Eve" });
    await joined;
  });

  it("update_settings with lives \"abc\" → bad_payload; settings unchanged", async () => {
    await boot();
    const a = await client();
    const joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "Host" });
    const { state } = await joined;
    const before = { ...rooms.get(state.code)!.settings };
    const err = awaitEvent<any>(a, "error_msg");
    a.emit("update_settings", { lives: "abc", timeLimitSeconds: 600 } as any);
    expect((await err).code).toBe("bad_payload");
    expect(rooms.get(state.code)!.settings).toEqual(before);
    // Domain errors keep their specific codes.
    const err2 = awaitEvent<any>(a, "error_msg");
    a.emit("update_settings", { mode: "nonsense" } as any);
    expect((await err2).code).toBe("bad_mode");
    const err3 = awaitEvent<any>(a, "error_msg");
    a.emit("update_settings", { categoryId: "mars" } as any);
    expect((await err3).code).toBe("bad_category");
  });

  it("submit_answer with no payload → bad_payload", async () => {
    await boot({ countdownTickMs: 10 });
    const { a } = await soloPlaying();
    const err = awaitEvent<any>(a, "error_msg");
    const noResult = expectNoEvent(a, "answer_result", 200);
    (a as any).emit("submit_answer");
    expect((await err).code).toBe("bad_payload");
    await noResult;
  });

  it("set_ready with a non-boolean and create_room with a number → bad_payload", async () => {
    await boot();
    const a = await client();
    let err = awaitEvent<any>(a, "error_msg");
    a.emit("create_room", 42 as any);
    expect((await err).code).toBe("bad_payload");
    expect(rooms.size).toBe(0);
    const joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "A" });
    const { state, playerId } = await joined;
    err = awaitEvent<any>(a, "error_msg");
    a.emit("set_ready", { ready: "yes" } as any);
    expect((await err).code).toBe("bad_payload");
    expect(rooms.get(state.code)!.players.find((p) => p.id === playerId)!.ready).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* socket.data seat bookkeeping                                        */
/* ------------------------------------------------------------------ */

describe("socket.data seat bookkeeping", () => {
  const dataOf = (s: Socket) => server!.io.of("/").sockets.get(s.id!)!.data;

  it("a socket that leaves and creates a new room isn't treated as in the old one", async () => {
    await boot();
    const a = await client();
    let joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "A" });
    const ja = await joined;
    const oldCode = ja.state.code as string;
    expect(dataOf(a)).toEqual({ roomCode: oldCode, playerId: ja.playerId });

    const b = await client();
    joined = awaitEvent<any>(b, "joined");
    b.emit("join_room", { code: oldCode, playerName: "B" });
    await joined;

    const left = awaitEvent<any>(b, "player_left");
    a.emit("leave_room");
    await left;
    expect(dataOf(a).roomCode).toBeUndefined();
    expect(dataOf(a).playerId).toBeUndefined();

    joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "A" });
    const ja2 = await joined;
    expect(ja2.state.code).not.toBe(oldCode);
    expect(dataOf(a)).toEqual({ roomCode: ja2.state.code, playerId: ja2.playerId });

    // A's ready toggle lands in the NEW room only; B (old room) hears nothing.
    const silent = expectNoEvent(b, "player_ready", 200);
    const readyA = awaitEvent<any>(a, "player_ready");
    a.emit("set_ready", { ready: true });
    expect((await readyA).playerId).toBe(ja2.playerId);
    await silent;
    expect(rooms.get(oldCode)!.players.map((p) => p.name)).toEqual(["B"]);
  });

  it("a seat taken over by a reconnect no longer belongs to the old socket", async () => {
    await boot();
    const a = await client();
    let joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "A" });
    const ja = await joined;
    const code = ja.state.code as string;

    const b1 = await client();
    joined = awaitEvent<any>(b1, "joined");
    b1.emit("join_room", { code, playerName: "B" });
    const jb = await joined;

    // A second socket reclaims B's seat with the token while b1 is still open.
    const b2 = await client();
    joined = awaitEvent<any>(b2, "joined");
    b2.emit("join_room", { code, playerName: "B", reconnectToken: jb.reconnectToken });
    expect((await joined).playerId).toBe(jb.playerId);

    // b1 is no longer seated: its events are ignored and its binding cleared.
    const silent = expectNoEvent(a, "player_ready", 200);
    b1.emit("set_ready", { ready: true });
    await silent;
    expect(rooms.get(code)!.players.find((p) => p.id === jb.playerId)!.ready).toBe(false);
    expect(dataOf(b1).roomCode).toBeUndefined();
    expect(dataOf(b2)).toEqual({ roomCode: code, playerId: jb.playerId });
  });

  it("a forfeiting leaver's binding is cleared even though endGame removes the seat", async () => {
    await boot({ countdownTickMs: 10 });
    const a = await client();
    let joined = awaitEvent<any>(a, "joined");
    a.emit("create_room", { playerName: "A" });
    const ja = await joined;
    const code = ja.state.code as string;
    const b = await client();
    joined = awaitEvent<any>(b, "joined");
    b.emit("join_room", { code, playerName: "B" });
    await joined;
    a.emit("set_ready", { ready: true });
    b.emit("set_ready", { ready: true });
    await tick(100);
    const started = awaitEvent<any>(b, "game_started", 5000);
    a.emit("start_game");
    await started;

    // The leaver is removed from the channel first, so watch from A.
    const over = awaitEvent<any>(a, "game_over");
    b.emit("leave_room");
    await over;
    expect(dataOf(b).roomCode).toBeUndefined();
    expect(rooms.get(code)!.players.map((p) => p.name)).toEqual(["A"]);
    // b can immediately create a fresh room.
    joined = awaitEvent<any>(b, "joined");
    b.emit("create_room", { playerName: "B" });
    expect((await joined).state.code).not.toBe(code);
  });
});
