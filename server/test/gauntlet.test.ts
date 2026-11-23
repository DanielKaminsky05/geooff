import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  startTestServer,
  connectClient,
  awaitEvent,
  expectNoEvent,
  type TestServer,
  type Socket,
} from "./fixtures/serverHarness.js";
import { rooms, type Room } from "../src/rooms.js";
import { promptById, validIdsFor, buildPromptPool } from "../src/prompts.js";
import { pickPrompt } from "../src/lastStanding.js";
import { countries } from "../src/data/countries.js";

/**
 * gauntlet (Last Standing + a prompt layer).
 *
 * The opening prompt is chosen at random, so tests DERIVE their answers from the
 * room's active prompt (via promptById/validIdsFor over the "countries" set)
 * rather than hard-coding a country. Timing is deterministic: countdownTickMs is
 * tiny and turnMsOverride pins the per-turn clock (long where we must not time
 * out, short where we test timeouts).
 */

const CATEGORY = "countries";
const isoToName = new Map(countries.map((c) => [c.iso, c.name]));

/** The canonical name of some iso in the active prompt's valid set (on-prompt). */
function onPromptName(promptId: string): string {
  const prompt = promptById(promptId)!;
  const valid = validIdsFor(prompt, CATEGORY);
  const iso = [...valid][0];
  return isoToName.get(iso)!;
}

/** The name of some set country NOT in the active prompt's valid set (off-prompt). */
function offPromptName(promptId: string): string {
  const prompt = promptById(promptId)!;
  const valid = validIdsFor(prompt, CATEGORY);
  const c = countries.find((c) => !valid.has(c.iso))!;
  return c.name;
}

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

/** Create a 2-player room and switch it to gauntlet (host sets the mode). */
async function makeGauntletRoom(lives = 3) {
  const a = client();
  await awaitEvent(a, "connect");
  a.emit("create_room", { playerName: "Alice" });
  const joinedA = await awaitEvent<any>(a, "joined");
  const code = joinedA.state.code as string;

  const stateModed = awaitEvent<any>(a, "room_state");
  a.emit("update_settings", { mode: "gauntlet", lives });
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
  };
}

/** Ready both, start, and resolve with the first prompt_changed + turn_started. */
async function startGauntlet(ctx: Awaited<ReturnType<typeof makeGauntletRoom>>) {
  const { a, b, aId } = ctx;
  a.emit("set_ready", { ready: true });
  b.emit("set_ready", { ready: true });
  await awaitEvent(a, "player_ready");

  const promptA = awaitEvent<any>(a, "prompt_changed", 8000);
  const turnA = awaitEvent<any>(a, "turn_started", 8000);
  a.emit("start_game");
  const prompt = await promptA;
  const t = await turnA;
  // Host (p1 = Alice) takes turn 1.
  expect(t.playerId).toBe(aId);
  return { prompt, turn: t };
}

/** Create a 3-player gauntlet room (Alice host + Bob + Cara). */
async function makeGauntletRoom3(lives = 3) {
  const a = client();
  await awaitEvent(a, "connect");
  a.emit("create_room", { playerName: "Alice" });
  const joinedA = await awaitEvent<any>(a, "joined");
  const code = joinedA.state.code as string;
  const stateModed = awaitEvent<any>(a, "room_state");
  a.emit("update_settings", { mode: "gauntlet", lives });
  await stateModed;

  const b = client();
  await awaitEvent(b, "connect");
  let pj = awaitEvent<any>(a, "player_joined");
  b.emit("join_room", { code, playerName: "Bob" });
  const joinedB = await awaitEvent<any>(b, "joined");
  await pj;

  const c = client();
  await awaitEvent(c, "connect");
  pj = awaitEvent<any>(a, "player_joined");
  c.emit("join_room", { code, playerName: "Cara" });
  const joinedC = await awaitEvent<any>(c, "joined");
  await pj;

  return {
    a, b, c, code,
    aId: joinedA.playerId as string,
    bId: joinedB.playerId as string,
    cId: joinedC.playerId as string,
  };
}

describe("gauntlet — 3 players", () => {
  beforeEach(async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  it("rotates turns p1 → p2 → p3 → p1 on correct answers", async () => {
    const ctx = await makeGauntletRoom3();
    const { a, b, c, aId, bId, cId } = ctx;

    // Ready up all three deterministically (await each ack before the next).
    a.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");
    b.emit("set_ready", { ready: true });
    await awaitEvent(b, "player_ready");
    c.emit("set_ready", { ready: true });
    await awaitEvent(c, "player_ready");

    const promptP = awaitEvent<any>(a, "prompt_changed", 8000);
    const turn1 = awaitEvent<any>(a, "turn_started", 8000);
    a.emit("start_game");
    const prompt = await promptP;
    expect((await turn1).playerId).toBe(aId); // host (p1) first

    const valid = [...validIdsFor(promptById(prompt.id)!, CATEGORY)];
    const nameOf = (iso: string) => isoToName.get(iso)!;

    // Drain every turn_started on the host socket (it receives all broadcasts in
    // order) to avoid racing a stale per-socket copy of an earlier transition.
    // p1 answers → p2's turn.
    let next = awaitEvent<any>(a, "turn_started", 8000);
    a.emit("submit_answer", { text: nameOf(valid[0]) });
    expect((await next).playerId).toBe(bId);

    // p2 answers → p3's turn.
    next = awaitEvent<any>(a, "turn_started", 8000);
    b.emit("submit_answer", { text: nameOf(valid[1]) });
    expect((await next).playerId).toBe(cId);

    // p3 answers → wraps back to p1.
    next = awaitEvent<any>(a, "turn_started", 8000);
    c.emit("submit_answer", { text: nameOf(valid[2]) });
    expect((await next).playerId).toBe(aId);
  }, 15000);
});

describe("gauntlet — current player leaves (3 players)", () => {
  beforeEach(async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  it("play passes to the next seat after the leaver, not back to p1", async () => {
    const ctx = await makeGauntletRoom3();
    const { a, b, c, aId, bId, cId } = ctx;
    a.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");
    b.emit("set_ready", { ready: true });
    await awaitEvent(b, "player_ready");
    c.emit("set_ready", { ready: true });
    await awaitEvent(c, "player_ready");

    const promptP = awaitEvent<any>(a, "prompt_changed", 8000);
    const turn1 = awaitEvent<any>(a, "turn_started", 8000);
    a.emit("start_game");
    const prompt = await promptP;
    expect((await turn1).playerId).toBe(aId);

    const valid = [...validIdsFor(promptById(prompt.id)!, CATEGORY)];
    let next = awaitEvent<any>(a, "turn_started", 8000);
    a.emit("submit_answer", { text: isoToName.get(valid[0])! });
    expect((await next).playerId).toBe(bId);

    // B (current, p2) leaves → C (p3) is next, not A (p1).
    next = awaitEvent<any>(a, "turn_started", 8000);
    b.emit("leave_room");
    expect((await next).playerId).toBe(cId);
    expect(rooms.get(ctx.code)!.currentPlayerId).toBe(cId);
  }, 15000);
});

describe("gauntlet — category without prompts", () => {
  beforeEach(async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  for (const mode of ["gauntlet", "showdown"] as const) {
    it(`switching to a prompt-less category resets ${mode} to race`, async () => {
      expect(buildPromptPool("us-states")).toHaveLength(0);
      const ctx = await makeGauntletRoom();
      const { a, code } = ctx;
      let rs = awaitEvent<any>(a, "room_state");
      a.emit("update_settings", { mode });
      expect((await rs).settings.mode).toBe(mode);

      rs = awaitEvent<any>(a, "room_state");
      a.emit("update_settings", { categoryId: "us-states" });
      const state = await rs;
      expect(state.settings.categoryId).toBe("us-states");
      expect(state.settings.mode).toBe("race");
      expect(rooms.get(code)!.settings.mode).toBe("race");
    });
  }
});

describe("gauntlet — prompt setup", () => {
  beforeEach(async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  it("sets a prompt and emits prompt_changed at game start", async () => {
    const ctx = await makeGauntletRoom();
    const { prompt } = await startGauntlet(ctx);

    expect(typeof prompt.id).toBe("string");
    expect(typeof prompt.label).toBe("string");
    expect(prompt.label.length).toBeGreaterThan(0);
    // Runtime holds the active prompt; valid set is NOT leaked over the wire.
    const room = rooms.get(ctx.code)!;
    expect(room.currentPromptId).toBe(prompt.id);
    expect(room.claimedThisPrompt).toBeInstanceOf(Set);
    expect((prompt as any).validIds).toBeUndefined();
  });

  it("room_state carries the prompt { id, label, total }", async () => {
    const ctx = await makeGauntletRoom();
    const { prompt } = await startGauntlet(ctx);

    // A fresh snapshot (via reconnect-less re-fetch) includes the prompt.
    const stateP = awaitEvent<any>(ctx.a, "room_state");
    ctx.a.emit("set_ready", { ready: true }); // any state-broadcasting no-op works
    const state = await stateP;
    const expectedTotal = validIdsFor(promptById(prompt.id)!, CATEGORY).size;
    expect(state.prompt).toEqual({ id: prompt.id, label: prompt.label, total: expectedTotal });
    expect(expectedTotal).toBeGreaterThan(0);
    // The prompt_changed payload carries the same count.
    expect(prompt.total).toBe(expectedTotal);
  });
});

describe("gauntlet — on/off prompt answers", () => {
  beforeEach(async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
  });

  it("an on-prompt valid answer scores and passes the turn", async () => {
    const ctx = await makeGauntletRoom();
    const { prompt } = await startGauntlet(ctx);
    const { a, aId, bId } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    const turn2 = awaitEvent<any>(a, "turn_started");
    a.emit("submit_answer", { text: onPromptName(prompt.id) });

    const r = await resA;
    expect(r.accepted).toBe(true);

    const t2 = await turn2;
    expect(t2.playerId).toBe(bId);
    const room = rooms.get(ctx.code)!;
    expect(room.currentPlayerId).toBe(bId);
    // Correct answer costs no life.
    expect(room.lives![aId]).toBe(3);
    // Claimed under this prompt.
    expect(room.claimedThisPrompt!.has(r.isoCode)).toBe(true);
  });

  it("an off-prompt valid country is rejected off_prompt with no turn pass", async () => {
    const ctx = await makeGauntletRoom();
    const { prompt } = await startGauntlet(ctx);
    const { a, aId } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    const noTurn = expectNoEvent(a, "turn_started", 300);
    a.emit("submit_answer", { text: offPromptName(prompt.id) });

    const r = await resA;
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("off_prompt");
    await noTurn;
    // Still A's turn, no life lost.
    const room = rooms.get(ctx.code)!;
    expect(room.currentPlayerId).toBe(aId);
    expect(room.lives![aId]).toBe(3);
  });

  it("a non-country guess is rejected wrong (not off_prompt)", async () => {
    const ctx = await makeGauntletRoom();
    await startGauntlet(ctx);
    const { a } = ctx;

    const resA = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: "atlantis" });
    expect((await resA).reason).toBe("wrong");
  });
});

describe("gauntlet — timeout cycles the prompt", () => {
  it("a turn timeout costs a life AND cycles in a different prompt", async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 80 });
    const ctx = await makeGauntletRoom();
    const { a, b, aId, bId } = ctx;

    a.emit("set_ready", { ready: true });
    b.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");

    const firstPrompt = awaitEvent<any>(a, "prompt_changed", 8000);
    const firstTurn = awaitEvent<any>(a, "turn_started", 8000);
    const lifeLost = awaitEvent<any>(a, "life_lost", 8000);
    // The SECOND prompt_changed is the cycle on timeout.
    const secondPrompt = new Promise<any>((resolve) => {
      let seen = 0;
      a.on("prompt_changed", function onP(p: any) {
        seen += 1;
        if (seen === 2) {
          a.off("prompt_changed", onP);
          resolve(p);
        }
      });
    });
    a.emit("start_game");
    const p1 = await firstPrompt;
    await firstTurn;

    // A never answers → A's clock runs out.
    const ll = await lifeLost;
    expect(ll.playerId).toBe(aId);
    expect(ll.livesLeft).toBe(2);

    // A fresh prompt cycled in, with a different id.
    const p2 = await secondPrompt;
    expect(p2.id).not.toBe(p1.id);
    const room = rooms.get(ctx.code)!;
    expect(room.currentPromptId).toBe(p2.id);
    expect(room.claimedThisPrompt!.size).toBe(0);
    // Play passed to B for the new prompt.
    expect(room.currentPlayerId).toBe(bId);
  }, 10000);
});

describe("gauntlet — prompts don't repeat until the pool is exhausted", () => {
  it("draws the whole pool before any prompt repeats, then reshuffles", () => {
    const pool = buildPromptPool("countries");
    expect(pool.length).toBeGreaterThan(1);
    // Minimal room shape pickPrompt needs: the category + a fresh used-bag.
    const room = { settings: { categoryId: "countries" }, usedPromptIds: new Set<string>() } as unknown as Room;

    // One full bag: every draw is unique and covers the entire pool.
    const firstBag: string[] = [];
    let last: string | undefined;
    for (let i = 0; i < pool.length; i++) {
      const p = pickPrompt(room, last);
      expect(p).toBeDefined();
      firstBag.push(p!.id);
      last = p!.id;
    }
    expect(new Set(firstBag).size).toBe(pool.length); // no repeats within the bag
    expect(new Set(firstBag)).toEqual(new Set(pool.map((p) => p.id))); // covers all

    // The bag is now empty → the next draw reshuffles, and must not immediately
    // repeat the just-finished prompt.
    const afterReset = pickPrompt(room, last);
    expect(afterReset!.id).not.toBe(last);
  });
});

describe("gauntlet — elimination", () => {
  it("reaching 0 lives ends the game with the OTHER player as winner", async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60 });
    const ctx = await makeGauntletRoom(1);
    const { a, b, bId, code } = ctx;

    a.emit("set_ready", { ready: true });
    b.emit("set_ready", { ready: true });
    await awaitEvent(a, "player_ready");

    const over = awaitEvent<any>(b, "game_over", 8000);
    a.emit("start_game");
    // A lets the only turn run out → A eliminated → B wins.
    const go = await over;
    expect(go.winnerId).toBe(bId);
    const room = rooms.get(code)!;
    expect(room.phase).toBe("ended");
    // Gauntlet runtime fully torn down.
    expect(room.turnTimer).toBeUndefined();
    expect(room.currentPlayerId).toBeUndefined();
    expect(room.currentPromptId).toBeUndefined();
    expect(room.claimedThisPrompt).toBeUndefined();
  }, 10000);
});

describe("gauntlet — solo", () => {
  /** Lone-host gauntlet room (private solo), already in gauntlet mode. */
  async function makeSoloGauntlet(lives: number) {
    const a = client();
    await awaitEvent(a, "connect");
    a.emit("create_room", { playerName: "Solo", solo: true });
    const joined = await awaitEvent<any>(a, "joined");
    const code = joined.state.code as string;
    const moded = awaitEvent<any>(a, "room_state");
    a.emit("update_settings", { mode: "gauntlet", lives });
    await moded;
    return { a, aId: joined.playerId as string, code };
  }

  it("a lone host starts gauntlet (no ready-up) and takes every turn", async () => {
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60_000 });
    const { a, aId, code } = await makeSoloGauntlet(2);

    const promptA = awaitEvent<any>(a, "prompt_changed", 8000);
    const turnA = awaitEvent<any>(a, "turn_started", 8000);
    a.emit("start_game");
    const prompt = await promptA;
    expect((await turnA).playerId).toBe(aId);
    expect(typeof prompt.label).toBe("string");
    expect(rooms.get(code)!.currentPromptId).toBe(prompt.id);
    // A valid on-prompt answer keeps the turn on the lone player.
    const resA = awaitEvent<any>(a, "answer_result");
    const turn2 = awaitEvent<any>(a, "turn_started");
    a.emit("submit_answer", { text: onPromptName(prompt.id) });
    expect((await resA).accepted).toBe(true);
    expect((await turn2).playerId).toBe(aId);
  });

  it("the run ends at 0 lives with no winner (survival over)", async () => {
    // Short turn + lives:1 → one timeout drains the only life and ends the run.
    server = await startTestServer({ countdownTickMs: 10, turnMsOverride: 60 });
    const { a, code } = await makeSoloGauntlet(1);

    const over = awaitEvent<any>(a, "game_over", 8000);
    a.emit("start_game");
    // Never answer → the clock runs out → last life gone → run over.
    const go = await over;
    expect(go.winnerId).toBeNull();
    const room = rooms.get(code)!;
    expect(room.phase).toBe("ended");
    expect(room.turnTimer).toBeUndefined();
  }, 10000);
});
