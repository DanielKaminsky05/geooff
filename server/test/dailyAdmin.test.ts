/**
 * Phase 3 integration: the Trek Builder admin routes. Saving an authored trek
 * (token-guarded) makes GET /daily serve it for that date, usage flags reflect
 * saved sets, and auth/validation are enforced — all against a fake repo, no
 * Supabase credentials.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { registerDailyRoutes } from "../src/daily/routes.js";
import { registerDailyAdminRoutes, hydrateAuthoredSets } from "../src/daily/adminRoutes.js";
import { clearAuthoredSets } from "../src/daily/authoredSets.js";
import { buildPromptPool } from "../src/prompts.js";
import { destinations } from "../src/daily/destinations.js";
import { DAILY_PROMPT_COUNT } from "../src/protocol.js";
import type { DailySet } from "../src/protocol.js";
import { makeFakeAuthoredSetsRepo } from "./fakeAuthoredSetsRepo.js";

const TOKEN = "s3cret";
const DATE = "2026-03-10";
const FIVE = buildPromptPool("countries").slice(0, DAILY_PROMPT_COUNT).map((p) => p.id);
const DEST = destinations[0].destination.name;

function makeApp(repo = makeFakeAuthoredSetsRepo()) {
  const app = express();
  app.use(express.json());
  // Daily routes pinned to DATE so GET /daily returns the day we author.
  registerDailyRoutes(app, { today: () => DATE });
  registerDailyAdminRoutes(app, { token: TOKEN, repo });
  return { app, repo };
}

function body(over = {}) {
  return { dailyDate: DATE, destinationName: DEST, promptIds: FIVE, ...over };
}

beforeEach(() => clearAuthoredSets());
afterEach(() => clearAuthoredSets());

describe("POST /daily/admin/sets", () => {
  it("rejects a request without the admin token (401)", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/daily/admin/sets").send(body());
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token (401)", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/daily/admin/sets")
      .set("x-admin-token", "nope")
      .send(body());
    expect(res.status).toBe(401);
  });

  it("saves a valid trek, persists it, and serves it from GET /daily", async () => {
    const { app, repo } = makeApp();
    const save = await request(app)
      .post("/daily/admin/sets")
      .set("x-admin-token", TOKEN)
      .send(body());
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ ok: true, persisted: true });
    expect(repo.rows).toHaveLength(1);

    // The curated set now overrides the generator for that date.
    const daily = await request(app).get("/daily");
    const set = daily.body as DailySet;
    expect(set.destination.name).toBe(DEST);
    expect(set.prompts.map((p) => p.id)).toEqual(FIVE);
  });

  it("rejects an invalid trek with 400 and persists nothing", async () => {
    const { app, repo } = makeApp();
    const res = await request(app)
      .post("/daily/admin/sets")
      .set("x-admin-token", TOKEN)
      .send(body({ promptIds: FIVE.slice(0, 4) }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(repo.rows).toHaveLength(0);
  });

  it("re-saving the same date replaces the row (PK = daily_date)", async () => {
    const { app, repo } = makeApp();
    const post = () =>
      request(app).post("/daily/admin/sets").set("x-admin-token", TOKEN).send(body());
    await post();
    await post();
    expect(repo.rows).toHaveLength(1);
  });
});

describe("GET /daily/admin/catalog", () => {
  it("requires the token", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/daily/admin/catalog")).status).toBe(401);
  });

  it("returns prompts and destinations, with usage flags after a save", async () => {
    const { app } = makeApp();
    const before = await request(app).get("/daily/admin/catalog").set("x-admin-token", TOKEN);
    expect(before.body.destinations).toContain(DEST);
    const used0 = before.body.prompts.find((p: { id: string }) => p.id === FIVE[0]);
    expect(used0.usedOn).toEqual([]);

    await request(app).post("/daily/admin/sets").set("x-admin-token", TOKEN).send(body());

    const after = await request(app).get("/daily/admin/catalog").set("x-admin-token", TOKEN);
    const used1 = after.body.prompts.find((p: { id: string }) => p.id === FIVE[0]);
    expect(used1.usedOn).toContain(DATE);
  });
});

describe("hydrateAuthoredSets", () => {
  it("loads persisted sets into the overlay at boot", async () => {
    const repo = makeFakeAuthoredSetsRepo();
    await repo.upsert({ dailyDate: DATE, destinationName: DEST, promptIds: FIVE });
    const n = await hydrateAuthoredSets(repo);
    expect(n).toBe(1);

    const app = express();
    app.use(express.json());
    registerDailyRoutes(app, { today: () => DATE });
    const daily = await request(app).get("/daily");
    expect((daily.body as DailySet).destination.name).toBe(DEST);
  });

  it("is a no-op with a null repo", async () => {
    expect(await hydrateAuthoredSets(null)).toBe(0);
  });
});
