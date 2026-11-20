import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  startTestServer,
  connectClient,
  awaitEvent,
  type TestServer,
  type Socket,
} from "./fixtures/serverHarness.js";
import { rooms } from "../src/rooms.js";
import { promptById, validIdsFor } from "../src/prompts.js";
import { countries } from "../src/data/countries.js";

/**
 * showdown (simultaneous timed rounds + lives). Answers are DERIVED from the
 * active prompt's valid set; round timing is pinned small so tests run fast.
 */
const CATEGORY = "countries";
const isoToName = new Map(countries.map((c) => [c.iso, c.name]));

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

/** Create an N-player room in showdown mode (host + guests). */
async function makeShowdownRoom(lives: number, guests = 1) {
  const a = client();
  await awaitEvent(a, "connect");
  a.emit("create_room", { playerName: "Alice" });
  const joinedA = await awaitEvent<any>(a, "joined");
  const code = joinedA.state.code as string;

  const moded = awaitEvent<any>(a, "room_state");
  a.emit("update_settings", { mode: "showdown", lives });
  await moded;

  const names = ["Bob", "Cara", "Dan"];
  const others: { socket: Socket; id: string }[] = [];
  for (let i = 0; i < guests; i++) {
    const g = client();
    await awaitEvent(g, "connect");
    const pj = awaitEvent<any>(a, "player_joined");
    g.emit("join_room", { code, playerName: names[i] });
    const joined = await awaitEvent<any>(g, "joined");
    await pj;
    others.push({ socket: g, id: joined.playerId });
  }

  return { a, code, aId: joinedA.playerId as string, others };
}

async function readyAll(a: Socket, others: Socket[]) {
  a.emit("set_ready", { ready: true });
  await awaitEvent(a, "player_ready");
  for (const g of others) {
    g.emit("set_ready", { ready: true });
    await awaitEvent(g, "player_ready");
  }
}

const nameOf = (iso: string) => isoToName.get(iso)!;

describe("showdown — round scoring", () => {
  beforeEach(async () => {
    server = await startTestServer({
      countdownTickMs: 10,
      roundMsOverride: 300,
      interRoundMsOverride: 40,
    });
  });

  it("defaults the round clock to 30s when the mode is selected", async () => {
    const { code } = await makeShowdownRoom(3);
    expect(rooms.get(code)!.settings.turnSeconds).toBe(30);
  });

  it("the player who names the fewest loses a heart", async () => {
    const ctx = await makeShowdownRoom(3);
    const { a, aId, others } = ctx;
    const b = others[0].socket;
    const bId = others[0].id;
    await readyAll(a, [b]);

    const prompt1 = awaitEvent<any>(a, "prompt_changed", 8000);
    const roundStart = awaitEvent<any>(a, "round_started", 8000);
    a.emit("start_game");
    const prompt = await prompt1;
    await roundStart;

    const valid = [...validIdsFor(promptById(prompt.id)!, CATEGORY)];
    const result = awaitEvent<any>(a, "round_result", 8000);

    // A names two, B names one.
    let ar = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: nameOf(valid[0]) });
    await ar;
    ar = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: nameOf(valid[1]) });
    await ar;
    ar = awaitEvent<any>(b, "answer_result");
    b.emit("submit_answer", { text: nameOf(valid[0]) });
    await ar;

    const r = await result;
    expect(r.counts[aId]).toBe(2);
    expect(r.counts[bId]).toBe(1);
    expect(r.tie).toBe(false);
    expect(r.losers).toEqual([bId]);
    expect(r.eliminated).toEqual([]);
    // B lost a heart, A kept all.
    expect(rooms.get(ctx.code)!.lives![bId]).toBe(2);
    expect(rooms.get(ctx.code)!.lives![aId]).toBe(3);
  }, 10000);

  it("an equal round is a tie — nobody loses a heart", async () => {
    const ctx = await makeShowdownRoom(3);
    const { a, aId, others } = ctx;
    const b = others[0].socket;
    const bId = others[0].id;
    await readyAll(a, [b]);

    const prompt1 = awaitEvent<any>(a, "prompt_changed", 8000);
    const roundStart = awaitEvent<any>(a, "round_started", 8000);
    a.emit("start_game");
    const prompt = await prompt1;
    await roundStart;

    const valid = [...validIdsFor(promptById(prompt.id)!, CATEGORY)];
    const result = awaitEvent<any>(a, "round_result", 8000);

    let ar = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: nameOf(valid[0]) });
    await ar;
    ar = awaitEvent<any>(b, "answer_result");
    b.emit("submit_answer", { text: nameOf(valid[1]) });
    await ar;

    const r = await result;
    expect(r.tie).toBe(true);
    expect(r.losers).toEqual([]);
    expect(rooms.get(ctx.code)!.lives![aId]).toBe(3);
    expect(rooms.get(ctx.code)!.lives![bId]).toBe(3);
  }, 10000);

  it("reaching 0 hearts eliminates you; last one standing wins", async () => {
    // lives:1 → losing one round ends the game.
    const ctx = await makeShowdownRoom(1);
    const { a, aId, others } = ctx;
    const b = others[0].socket;
    const bId = others[0].id;
    await readyAll(a, [b]);

    const prompt1 = awaitEvent<any>(a, "prompt_changed", 8000);
    const roundStart = awaitEvent<any>(a, "round_started", 8000);
    const over = awaitEvent<any>(a, "game_over", 8000);
    a.emit("start_game");
    const prompt = await prompt1;
    await roundStart;

    const valid = [...validIdsFor(promptById(prompt.id)!, CATEGORY)];
    // A names one; B names none → B is the fewest → eliminated → A wins.
    const ar = awaitEvent<any>(a, "answer_result");
    a.emit("submit_answer", { text: nameOf(valid[0]) });
    await ar;

    const go = await over;
    expect(go.winnerId).toBe(aId);
    expect(rooms.get(ctx.code)!.phase).toBe("ended");
    void bId;
  }, 10000);
});
