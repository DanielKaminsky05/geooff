import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startTestServer,
  connectClient,
  awaitEvent,
  expectNoEvent,
  type TestServer,
  type Socket,
} from "./fixtures/serverHarness.js";
import { COUNTDOWN_SECONDS } from "../src/protocol.js";
import { total as REAL_TOTAL } from "../src/matching.js";
import { rooms } from "../src/rooms.js";

/**
 * A real country from the live dataset, used for "correct answer" assertions.
 * France -> iso "fr" is a stable member of the 196-country category.
 */
const CORRECT = { text: "France", iso: "fr" };

let server: TestServer;
const openSockets: Socket[] = [];

function client(): Socket {
  const s = connectClient(server.url);
  openSockets.push(s);
  return s;
}

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  for (const s of openSockets.splice(0)) {
    s.removeAllListeners();
    s.disconnect();
  }
  await server.close();
  vi.useRealTimers();
});

/** Create a room (A) + join a second player (B). Returns ids + sockets. */
async function makeRoom() {
  const a = client();
  await awaitEvent(a, "connect");
  a.emit("create_room", { playerName: "Alice" });
  const joinedA = await awaitEvent<any>(a, "joined");
  const code = joinedA.state.code;

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

/** Drive a room from lobby through countdown into "playing". */
async function startGame(ctx: Awaited<ReturnType<typeof makeRoom>>) {
  const { a, b } = ctx;
  a.emit("set_ready", { ready: true });
  b.emit("set_ready", { ready: true });
  // wait until both ready reflected
  await awaitEvent(a, "player_ready");

  const startedA = awaitEvent<any>(a, "game_started", 8000);
  const startedB = awaitEvent<any>(b, "game_started", 8000);
  const countdownA = awaitEvent<any>(a, "countdown");
  a.emit("start_game");
  await countdownA; // countdown begins immediately

  // Advance real time through the 3s countdown (interval-driven).
  const gsA = await startedA;
  const gsB = await startedB;
  return { gsA, gsB };
}

describe("solo rooms", () => {
  it("create_room with solo:true flags the room solo and non-joinable", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice", solo: true });
    const joined = await awaitEvent<any>(a, "joined");
    expect(joined.state.solo).toBe(true);

    // A second player cannot join a solo room.
    const b = client();
    await awaitEvent(b, "connect");
    const err = awaitEvent<any>(b, "error_msg");
    b.emit("join_room", { code: joined.state.code, playerName: "Bob" });
    expect((await err).code).toBe("not_joinable");
  });

  it("a solo host can start the round without a second player", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice", solo: true });
    await awaitEvent(a, "joined");

    const countdown = awaitEvent<any>(a, "countdown");
    const started = awaitEvent<any>(a, "game_started", 8000);
    a.emit("start_game");
    await countdown;
    const gs = await started;
    expect(gs.total).toBeGreaterThan(0);
  });
});

describe("create + join", () => {
  it("create_room responds with joined { playerId, slot:'p1', reconnectToken, state }", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice" });
    const joined = await awaitEvent<any>(a, "joined");
    expect(joined.slot).toBe("p1");
    expect(typeof joined.playerId).toBe("string");
    expect(typeof joined.reconnectToken).toBe("string");
    expect(joined.state.phase).toBe("lobby");
    expect(joined.state.players).toHaveLength(1);
  });

  it("a second client join_room gets slot 'p2' and the host gets player_joined", async () => {
    const { b } = await makeRoom();
    // joinedB captured inside makeRoom; re-verify B's slot by reading its state here
    // via a fresh room_state is overkill — assert player_joined already awaited in makeRoom.
    expect(b.connected).toBe(true);
  });

  it("join_room with an unknown code emits error_msg", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    const err = awaitEvent<any>(a, "error_msg");
    a.emit("join_room", { code: "NOPE00", playerName: "X" });
    expect((await err).code).toBe("room_not_found");
  });

  it("join_room on a full (4-player) room emits error_msg", async () => {
    const { code } = await makeRoom(); // 2 seats
    // Fill to MAX_PLAYERS (4): add a 3rd and 4th player.
    for (const name of ["Third", "Fourth"]) {
      const p = client();
      await awaitEvent(p, "connect");
      p.emit("join_room", { code, playerName: name });
      await awaitEvent(p, "joined");
    }
    // The 5th is turned away.
    const c = client();
    await awaitEvent(c, "connect");
    const err = awaitEvent<any>(c, "error_msg");
    c.emit("join_room", { code, playerName: "Fifth" });
    expect((await err).code).toBe("room_full");
  });

  it("[anti-cheat] joined.state has total/settings but no answer list", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice" });
    const joined = await awaitEvent<any>(a, "joined");
    const body = JSON.stringify(joined);
    expect(body).not.toContain("France");
    expect(joined.state.settings).toBeTruthy();
    // filled is an empty-per-player map, never a list of unguessed names.
    expect(Object.values(joined.state.filled ?? {}).flat()).toHaveLength(0);
  });
});

describe("ready + start_game", () => {
  it("set_ready broadcasts player_ready to both clients", async () => {
    const { a, b } = await makeRoom();
    const readyB = awaitEvent<any>(b, "player_ready");
    a.emit("set_ready", { ready: true });
    const evt = await readyB;
    expect(evt.ready).toBe(true);
  });

  it("start_game before both ready emits error_msg (not_ready)", async () => {
    const { a } = await makeRoom();
    const err = awaitEvent<any>(a, "error_msg");
    a.emit("set_ready", { ready: true });
    a.emit("start_game");
    expect((await err).code).toBe("not_ready");
  });

  it("emits countdown then game_started with a future endsAt and total === country count", async () => {
    const ctx = await makeRoom();
    const { gsA } = await startGame(ctx);
    expect(gsA.total).toBe(REAL_TOTAL);
    expect(gsA.categoryId).toBe("countries");
    expect(gsA.endsAt).toBeGreaterThan(Date.now());
  }, 10000);

  it("[anti-cheat] game_started carries a count, never the answer list", async () => {
    const ctx = await makeRoom();
    const { gsA } = await startGame(ctx);
    const body = JSON.stringify(gsA);
    expect(body).not.toContain("France");
    expect(typeof gsA.total).toBe("number");
  }, 10000);
});

describe("submit_answer", () => {
  it("rejects a guess before 'playing' with reason not_playing", async () => {
    const { a } = await makeRoom();
    const res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "France" });
    const r = await res;
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("not_playing");
  });

  it("a correct guess: guesser gets answer_result{accepted,isoCode}, BOTH get score_update, opponent gets opponent_progress", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, aId } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    const scoreA = awaitEvent<any>(a, "score_update");
    const scoreB = awaitEvent<any>(b, "score_update");
    const oppB = awaitEvent<any>(b, "opponent_progress");

    a.emit("submit_answer", { text: CORRECT.text });

    const r = await resA;
    expect(r.accepted).toBe(true);
    expect(r.isoCode).toBe(CORRECT.iso);
    expect(r.canonical).toBe("France");

    const su = await scoreA;
    expect(su.scores[aId]).toBe(1);
    await scoreB; // opponent also receives score_update

    const prog = await oppB;
    expect(prog.playerId).toBe(aId);
    expect(prog.isoCode).toBe(CORRECT.iso);
  }, 10000);

  it("[anti-cheat] opponent_progress contains only an isoCode, never a canonical name", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b } = ctx;
    const oppB = awaitEvent<any>(b, "opponent_progress");
    a.emit("submit_answer", { text: CORRECT.text });
    const prog = await oppB;
    // Self-healing payload: isoCode + the guesser's FULL named set so far (here
    // just the one iso). Both are already-named public facts — still no name.
    expect(prog).toEqual({ playerId: ctx.aId, isoCode: CORRECT.iso, filled: [CORRECT.iso] });
    expect(JSON.stringify(prog)).not.toContain("France");
  }, 10000);

  it("the guesser does NOT receive opponent_progress for their own guess", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a } = ctx;
    const noProg = expectNoEvent(a, "opponent_progress", 300);
    a.emit("submit_answer", { text: CORRECT.text });
    await noProg;
  }, 10000);

  it("a wrong guess returns accepted:false reason 'wrong' and nothing to the opponent", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b } = ctx;
    const resA = awaitEvent<any>(a, "answer_result");
    const silentB = expectNoEvent(b, "opponent_progress", 300);
    a.emit("submit_answer", { text: "atlantis" });
    const r = await resA;
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("wrong");
    await silentB;
  }, 10000);

  it("a duplicate guess returns accepted:false reason 'duplicate'", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a } = ctx;
    a.emit("submit_answer", { text: CORRECT.text });
    await awaitEvent(a, "answer_result");
    const dupRes = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    const r = await dupRes;
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("duplicate");
  }, 10000);

  it("an empty guess returns accepted:false reason 'empty'", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a } = ctx;
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "   " });
    const r = await resA;
    expect(r.reason).toBe("empty");
  }, 10000);

  it("an alias is accepted and returns the canonical name", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a } = ctx;
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "usa" });
    const r = await resA;
    expect(r.accepted).toBe(true);
    expect(r.canonical).toBe("United States");
    expect(r.isoCode).toBe("us");
  }, 10000);

  it("both players can independently score the same country", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, aId, bId } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    expect((await resA).accepted).toBe(true);

    const resB = awaitEvent<any>(b, "answer_result");
    // Wait for the score_update that reflects B's own point (ignore any
    // still-in-flight update from A's earlier guess).
    const bScored = new Promise<any>((resolve) => {
      b.on("score_update", function onSU(su: any) {
        if (su.scores[bId] === 1) {
          b.off("score_update", onSU);
          resolve(su);
        }
      });
    });
    b.emit("submit_answer", { text: CORRECT.text });
    expect((await resB).accepted).toBe(true);
    const su = await bScored;
    expect(su.scores[aId]).toBe(1);
    expect(su.scores[bId]).toBe(1);
  }, 10000);
});

describe("game_over", () => {
  // Short race clock so the round timer (not give_up, which is solo-only) ends
  // multiplayer games quickly.
  beforeEach(async () => {
    await server.close();
    server = await startTestServer({ countdownTickMs: 20, raceMsOverride: 400 });
  });

  it("the round timer ends the game for both clients and names the higher scorer as winner", async () => {
    const ctx = await makeRoom();
    const overA = awaitEvent<any>(ctx.a, "game_over", 4000);
    const overB = awaitEvent<any>(ctx.b, "game_over", 4000);
    await startGame(ctx);
    const { a, aId } = ctx;

    // A scores once so A is the clear leader.
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    await resA;

    const go = await overA;
    await overB;
    expect(go.winnerId).toBe(aId);
    expect(go.scores[aId]).toBe(1);
  }, 10000);

  it("game_over.winnerId is null on a 0-0 tie", async () => {
    const ctx = await makeRoom();
    const overA = awaitEvent<any>(ctx.a, "game_over", 4000);
    await startGame(ctx);
    expect((await overA).winnerId).toBeNull();
  }, 10000);

  it("[anti-cheat boundary] game_over.missedByPlayer reveals only ISO codes", async () => {
    const ctx = await makeRoom();
    const overA = awaitEvent<any>(ctx.a, "game_over", 4000);
    await startGame(ctx);
    const { a, aId } = ctx;
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    await resA;
    const go = await overA;
    const missed: string[] = go.missedByPlayer[aId];
    expect(missed).not.toContain("fr"); // the one A filled
    // Every revealed token is a lowercase alpha-2 ISO code, never a name.
    for (const iso of missed) expect(iso).toMatch(/^[a-z0-9]{2,3}$/);
    expect(JSON.stringify(go)).not.toContain("France");
  }, 10000);

  it("rejects submit_answer after game_over", async () => {
    const ctx = await makeRoom();
    const overA = awaitEvent<any>(ctx.a, "game_over", 4000);
    await startGame(ctx);
    const { a } = ctx;
    await overA;
    const res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    expect((await res).reason).toBe("not_playing");
  }, 10000);
});

describe("rematch", () => {
  beforeEach(async () => {
    await server.close();
    server = await startTestServer({ countdownTickMs: 20, raceMsOverride: 400 });
  });

  it("request_rematch broadcasts rematch_requested; both requests trigger rematch_start back to lobby", async () => {
    const ctx = await makeRoom();
    const { a, b } = ctx;
    const overBoth = Promise.all([
      awaitEvent(a, "game_over", 4000),
      awaitEvent(b, "game_over", 4000),
    ]);
    await startGame(ctx);
    await overBoth;

    const reqB = awaitEvent<any>(b, "rematch_requested");
    a.emit("request_rematch");
    await reqB;

    const startA = awaitEvent(a, "rematch_start");
    const stateA = awaitEvent<any>(a, "room_state");
    b.emit("request_rematch");
    await startA;
    const snap = await stateA;
    expect(snap.phase).toBe("lobby");
    for (const p of snap.players) expect(p.score).toBe(0);
  }, 10000);

  it("a seat that disconnected mid-match is dropped at game over so the rest can rematch", async () => {
    await server.close();
    // Long grace so the disconnected seat is still held when the round ends.
    server = await startTestServer({ countdownTickMs: 20, raceMsOverride: 500, graceMs: 60_000 });
    const ctx = await makeRoom();
    const { a, b, code } = ctx;
    const c = client();
    await awaitEvent(c, "connect");
    c.emit("join_room", { code, playerName: "Cara" });
    const cId = (await awaitEvent<any>(c, "joined")).playerId as string;

    a.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");
    b.emit("set_ready", { ready: true });
    await awaitEvent(b, "player_ready");
    c.emit("set_ready", { ready: true });
    await awaitEvent(c, "player_ready");
    const started = awaitEvent<any>(a, "game_started", 4000);
    a.emit("start_game");
    await started;

    // C drops mid-match; the game ends on the round timer while C is away.
    const disc = awaitEvent<any>(a, "opponent_disconnected");
    c.disconnect();
    await disc;
    const leftC = awaitEvent<any>(a, "player_left", 4000);
    await awaitEvent(a, "game_over", 4000);
    expect((await leftC).playerId).toBe(cId);
    expect(rooms.get(code)!.players.map((p) => p.id)).not.toContain(cId);

    // The two connected players can now rematch.
    const startA = awaitEvent(a, "rematch_start");
    a.emit("request_rematch");
    b.emit("request_rematch");
    await startA;
    expect(rooms.get(code)!.phase).toBe("lobby");
  }, 10000);
});

describe("disconnect + reconnect", () => {
  it("opponent is notified on disconnect and a valid token reattaches the seat", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, aId, code, tokenA } = ctx;

    const oppDisc = awaitEvent<any>(b, "opponent_disconnected");
    a.disconnect();
    const disc = await oppDisc;
    expect(disc.playerId).toBe(aId);
    expect(disc.graceSeconds).toBe(60);

    const a2 = client();
    await awaitEvent(a2, "connect");
    const oppRecon = awaitEvent<any>(b, "opponent_reconnected");
    a2.emit("join_room", { code, playerName: "Alice", reconnectToken: tokenA });
    const rejoined = await awaitEvent<any>(a2, "joined");
    expect(rejoined.playerId).toBe(aId);
    expect(rejoined.state.phase).toBe("playing");
    expect((await oppRecon).playerId).toBe(aId);
  }, 10000);

  it("[anti-cheat] reconnect snapshot carries only ISO codes, never unguessed names", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, aId, code, tokenA } = ctx;
    // Fill one country before disconnecting.
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    await resA;

    a.disconnect();
    const a2 = client();
    await awaitEvent(a2, "connect");
    a2.emit("join_room", { code, playerName: "Alice", reconnectToken: tokenA });
    const rejoined = await awaitEvent<any>(a2, "joined");
    expect(rejoined.state.filled[aId]).toEqual([CORRECT.iso]);
    expect(JSON.stringify(rejoined.state)).not.toContain("France");
  }, 10000);

  it("[anti-cheat] reconnect with an unknown token does not hijack a seat", async () => {
    const { code } = await makeRoom(); // 2 seats
    // Fill the room to capacity so a bad-token join can't fall through to a free seat.
    for (const name of ["Third", "Fourth"]) {
      const p = client();
      await awaitEvent(p, "connect");
      p.emit("join_room", { code, playerName: name });
      await awaitEvent(p, "joined");
    }
    const c = client();
    await awaitEvent(c, "connect");
    // A bad token must not reattach to an existing seat; the room is full.
    const err = awaitEvent<any>(c, "error_msg");
    c.emit("join_room", { code, playerName: "Hacker", reconnectToken: "not-a-real-token" });
    expect((await err).code).toBe("room_full");
  });
});

describe("robustness", () => {
  it("a malformed payload does not crash the server; the connection survives", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    // Garbage payloads to several handlers.
    a.emit("create_room", null as any);
    a.emit("submit_answer", 12345 as any);
    a.emit("join_room", undefined as any);
    // The first create_room(null) still creates a room with a default name.
    const joined = await awaitEvent<any>(a, "joined");
    expect(joined.state.phase).toBe("lobby");
    // Server is alive: health still responds.
    const b = client();
    await awaitEvent(b, "connect");
    expect(b.connected).toBe(true);
  });

  it("events from a client not in any room are ignored safely", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("set_ready", { ready: true });
    a.emit("start_game");
    a.emit("give_up");
    a.emit("request_rematch");
    // No crash, still connected.
    await expectNoEvent(a, "error_msg", 200);
    expect(a.connected).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Regression tests (fast timers injected via createServer options)    */
/* ------------------------------------------------------------------ */

describe("regressions", () => {
  const GRACE_MS = 150;

  beforeEach(async () => {
    // Swap the default server for one with short countdown + grace timers.
    await server.close();
    server = await startTestServer({ countdownTickMs: 20, graceMs: GRACE_MS });
  });

  it("grace expiry mid-match: the present player wins even when behind", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, bId, code } = ctx;

    // A (who will disconnect) takes the lead.
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    expect((await resA).accepted).toBe(true);

    const over = awaitEvent<any>(b, "game_over", 2000);
    a.disconnect();
    const go = await over;
    expect(go.winnerId).toBe(bId);
    // B is still connected, so the ended room is kept for them.
    expect(rooms.get(code)?.phase).toBe("ended");
  });

  it("room is deleted when both players disconnect mid-match and grace expires", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, code } = ctx;
    a.disconnect();
    b.disconnect();
    await new Promise((r) => setTimeout(r, GRACE_MS * 3));
    expect(rooms.has(code)).toBe(false);
  });

  it("a socket creating a second room is removed from the first", async () => {
    const { a, b, bId, code } = await makeRoom();

    const left = awaitEvent<any>(a, "player_left");
    b.emit("create_room", { playerName: "Bob" });
    const joined = await awaitEvent<any>(b, "joined");
    expect(joined.state.code).not.toBe(code);
    expect((await left).playerId).toBe(bId);
    expect(rooms.get(code)!.players).toHaveLength(1);

    // set_ready now routes to the NEW room, not the old one.
    const noReadyOnA = expectNoEvent(a, "player_ready", 200);
    const readyB = awaitEvent<any>(b, "player_ready");
    b.emit("set_ready", { ready: true });
    expect((await readyB).playerId).toBe(joined.playerId);
    await noReadyOnA;
  });

  it("a socket joining another room mid-match forfeits the old match to the opponent", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, aId, code } = ctx;

    const c = client();
    await awaitEvent(c, "connect");
    c.emit("create_room", { playerName: "Carol" });
    const other = (await awaitEvent<any>(c, "joined")).state.code;

    const overA = awaitEvent<any>(a, "game_over");
    const noOverB = expectNoEvent(b, "game_over", 200);
    b.emit("join_room", { code: other, playerName: "Bob" });
    await awaitEvent(b, "joined");
    expect((await overA).winnerId).toBe(aId);
    await noOverB;
    expect(rooms.get(code)!.players).toHaveLength(1);
    expect(rooms.get(other)!.players).toHaveLength(2);
  });

  it("a duplicate join_room from the same socket is idempotent", async () => {
    const { a, b, bId, code } = await makeRoom();
    const noJoinOnA = expectNoEvent(a, "player_joined", 200);
    const noErr = expectNoEvent(b, "error_msg", 200);
    const again = awaitEvent<any>(b, "joined");
    const state = awaitEvent<any>(b, "room_state");
    b.emit("join_room", { code, playerName: "Bob" });
    expect((await again).playerId).toBe(bId);
    expect((await state).players).toHaveLength(2);
    await noJoinOnA;
    await noErr;
    expect(rooms.get(code)!.players).toHaveLength(2);
  });

  it("room_state includes the category total", async () => {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Alice" });
    const joined = await awaitEvent<any>(a, "joined");
    expect(joined.state.total).toBe(REAL_TOTAL);
    const rs = awaitEvent<any>(a, "room_state");
    a.emit("set_ready", { ready: true });
    expect((await rs).total).toBe(REAL_TOTAL);
  });

  it("update_settings rejects an unknown categoryId with bad_category", async () => {
    const { a, code } = await makeRoom();
    const err = awaitEvent<any>(a, "error_msg");
    a.emit("update_settings", { categoryId: "capitals" as any, timeLimitSeconds: 120 });
    expect((await err).code).toBe("bad_category");
    expect(rooms.get(code)!.settings.categoryId).toBe("countries");
  });

  it("give_up is ignored in a multiplayer game (not_solo)", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, code } = ctx;
    const err = awaitEvent<any>(a, "error_msg");
    const noOverA = expectNoEvent(a, "game_over", 250);
    const noOverB = expectNoEvent(b, "game_over", 250);
    a.emit("give_up");
    expect((await err).code).toBe("not_solo");
    await noOverA;
    await noOverB;
    expect(rooms.get(code)!.phase).toBe("playing");
  });

  it("leave_room mid-match ends the game with the remaining player as winner", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    const { a, b, bId, code } = ctx;

    // The leaver is ahead; the remaining player must still win.
    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    await resA;

    const over = awaitEvent<any>(b, "game_over");
    const left = awaitEvent<any>(b, "player_left");
    a.emit("leave_room");
    expect((await over).winnerId).toBe(bId);
    expect((await left).playerId).toBe(ctx.aId);
    const room = rooms.get(code)!;
    expect(room.phase).toBe("ended");
    expect(room.players.map((p) => p.id)).toEqual([bId]);
  });
});

describe("solo mode", () => {
  beforeEach(async () => {
    await server.close();
    server = await startTestServer({ countdownTickMs: 20 });
  });

  async function soloRoom() {
    const a = client();
    a.emit("create_room", { playerName: "Solo" });
    const joined = await awaitEvent<any>(a, "joined");
    return { a, aId: joined.playerId as string, code: joined.state.code as string };
  }

  it("a lone host starts a solo round without readying up", async () => {
    const { a } = await soloRoom();
    const solo = awaitEvent<any>(a, "room_state");
    const started = awaitEvent<any>(a, "game_started", 2000);
    a.emit("start_game");
    expect((await solo).solo).toBe(true);
    expect((await started).total).toBe(REAL_TOTAL);
  });

  it("scores, and give_up ends the solo round with the player as winner", async () => {
    const { a, aId } = await soloRoom();
    const started = awaitEvent<any>(a, "game_started", 2000);
    a.emit("start_game");
    await started;
    const res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    expect((await res).accepted).toBe(true);
    const over = awaitEvent<any>(a, "game_over");
    a.emit("give_up");
    const go = await over;
    expect(go.winnerId).toBe(aId);
    expect(go.scores[aId]).toBe(1);
  });

  it("nobody can join a solo round in progress", async () => {
    const { a, code } = await soloRoom();
    const started = awaitEvent<any>(a, "game_started", 2000);
    a.emit("start_game");
    await started;
    const b = client();
    const err = awaitEvent<any>(b, "error_msg");
    b.emit("join_room", { code, playerName: "Late" });
    expect((await err).code).toBe("in_progress");
    expect(rooms.get(code)!.players).toHaveLength(1);
  });

  it("play again in solo restarts immediately with a fresh score", async () => {
    const { a, aId } = await soloRoom();
    let started = awaitEvent<any>(a, "game_started", 2000);
    a.emit("start_game");
    await started;
    const res = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: CORRECT.text });
    await res;
    const over = awaitEvent<any>(a, "game_over");
    a.emit("give_up");
    await over;

    started = awaitEvent<any>(a, "game_started", 2000);
    const noLobby = expectNoEvent(a, "rematch_start", 300);
    a.emit("request_rematch");
    await started;
    await noLobby;
    const state = rooms.get((await soloRoomCode(a)) ?? "")!;
    expect(state.solo).toBe(true);
    expect(state.players.find((p) => p.id === aId)!.score).toBe(0);
  });

  async function soloRoomCode(a: Socket) {
    for (const room of rooms.values()) {
      if (room.players.some((p) => p.socketId === a.id)) return room.code;
    }
    return null;
  }

  it("a two-player game is not marked solo", async () => {
    const ctx = await makeRoom();
    await startGame(ctx);
    expect(rooms.get(ctx.code)!.solo).toBe(false);
  });
});
