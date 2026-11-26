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
import { DAILY_PROMPT_COUNT } from "../src/protocol.js";
import type { DailySet } from "../src/protocol.js";
import type { AuthoredDailySet } from "../src/daily/authoredSets.js";
import { makeFakeAuthoredSetsRepo } from "./fakeAuthoredSetsRepo.js";

const TOKEN = "s3cret";
const DATE = "2026-03-10";
const FIVE = buildPromptPool("countries").slice(0, DAILY_PROMPT_COUNT).map((p) => p.id);
const DEST = { name: "Testville", at: { lat: 41, lon: 29 } };
const ROUTES = [
  { journeyId: "short" as const, points: [{ lat: 25, lon: 55 }, { lat: 41, lon: 29 }] },
  { journeyId: "medium" as const, points: [{ lat: 22, lon: 88 }, { lat: 41, lon: 29 }] },
  { journeyId: "long" as const, points: [{ lat: 1, lon: 103 }, { lat: 41, lon: 29 }] },
];

function makeApp(repo = makeFakeAuthoredSetsRepo()) {
  const app = express();
  app.use(express.json());
  // Daily routes pinned to DATE so GET /daily returns the day we author.
  registerDailyRoutes(app, { today: () => DATE });
  registerDailyAdminRoutes(app, { token: TOKEN, repo });
  return { app, repo };
}

function body(over: Partial<AuthoredDailySet> = {}): AuthoredDailySet {
  return { dailyDate: DATE, destination: DEST, routes: ROUTES, promptIds: FIVE, ...over };
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
    expect(set.destination.name).toBe(DEST.name);
    expect(set.prompts.map((p) => p.id)).toEqual(FIVE);
    expect(set.routes.map((r) => r.journeyId).sort()).toEqual(["long", "medium", "short"]);
  });

  it("applies a temple-gold override to the served journeys", async () => {
    const { app } = makeApp();
    await request(app)
      .post("/daily/admin/sets")
      .set("x-admin-token", TOKEN)
      .send(body({ landmarks: { short: [{ atFraction: 0.5, gold: 777 }, { atFraction: 1, gold: 888 }] } }));
    const set = (await request(app).get("/daily")).body as DailySet;
    const short = set.journeys.find((j) => j.id === "short")!;
    expect(short.landmarks.map((l) => l.gold)).toEqual([777, 888]);
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

describe("DELETE /daily/admin/sets/:date — unpublish", () => {
  it("requires the token", async () => {
    const { app } = makeApp();
    expect((await request(app).delete(`/daily/admin/sets/${DATE}`)).status).toBe(401);
  });

  it("removes the day from the DB and reverts GET /daily to the generator", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/daily/admin/sets").set("x-admin-token", TOKEN).send(body());
    // Authored day is live.
    expect(((await request(app).get("/daily")).body as DailySet).destination.name).toBe(DEST.name);

    const del = await request(app).delete(`/daily/admin/sets/${DATE}`).set("x-admin-token", TOKEN);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ ok: true, removed: true, wasLive: true });
    expect(repo.rows).toHaveLength(0);

    // No restart needed: the overlay dropped it, so the generator serves again.
    expect(((await request(app).get("/daily")).body as DailySet).destination.name).not.toBe(DEST.name);
  });

  it("rejects a malformed date", async () => {
    const { app } = makeApp();
    const res = await request(app).delete("/daily/admin/sets/nope").set("x-admin-token", TOKEN);
    expect(res.status).toBe(400);
  });
});

describe("GET /daily/admin/sets — published days", () => {
  it("lists the currently-published authored days", async () => {
    const { app } = makeApp();
    const before = await request(app).get("/daily/admin/sets").set("x-admin-token", TOKEN);
    expect(before.body.sets).toEqual([]);

    await request(app).post("/daily/admin/sets").set("x-admin-token", TOKEN).send(body());
    const after = await request(app).get("/daily/admin/sets").set("x-admin-token", TOKEN);
    expect(after.body.sets).toEqual([{ dailyDate: DATE, destinationName: DEST.name }]);
  });

  it("requires the token", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/daily/admin/sets")).status).toBe(401);
  });
});

describe("GET /daily/admin/sets/:date — load for editing", () => {
  it("returns the full authored day (destination, routes, prompts, gold)", async () => {
    const { app } = makeApp();
    await request(app).post("/daily/admin/sets").set("x-admin-token", TOKEN).send(body());
    const res = await request(app).get(`/daily/admin/sets/${DATE}`).set("x-admin-token", TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.destination).toEqual(DEST);
    expect(res.body.promptIds).toEqual(FIVE);
    expect(res.body.routes.map((r: { journeyId: string }) => r.journeyId)).toEqual(["short", "medium", "long"]);
    expect(res.body.landmarks.short.length).toBeGreaterThan(0);
  });

  it("404s for a date that isn't authored", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/daily/admin/sets/2099-01-01").set("x-admin-token", TOKEN);
    expect(res.status).toBe(404);
  });

  it("requires the token", async () => {
    const { app } = makeApp();
    expect((await request(app).get(`/daily/admin/sets/${DATE}`)).status).toBe(401);
  });
});

describe("GET /daily/admin/catalog", () => {
  it("requires the token", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/daily/admin/catalog")).status).toBe(401);
  });

  it("returns prompts with answers, and usage flags after a save", async () => {
    const { app } = makeApp();
    const before = await request(app).get("/daily/admin/catalog").set("x-admin-token", TOKEN);
    const p0 = before.body.prompts.find((p: { id: string }) => p.id === FIVE[0]);
    expect(p0.usedOn).toEqual([]);
    // Admin catalog reveals each prompt's correct answers for the builder sidebar.
    expect(Array.isArray(p0.answers)).toBe(true);
    expect(p0.answers.length).toBeGreaterThan(0);

    await request(app).post("/daily/admin/sets").set("x-admin-token", TOKEN).send(body());

    const after = await request(app).get("/daily/admin/catalog").set("x-admin-token", TOKEN);
    const used1 = after.body.prompts.find((p: { id: string }) => p.id === FIVE[0]);
    expect(used1.usedOn).toContain(DATE);
    expect(after.body.usageAvailable).toBe(true);
  });

  it("still serves the catalog but flags usage unavailable when the repo fails", async () => {
    const { app } = makeApp(makeFakeAuthoredSetsRepo({ failWith: new Error("db down") }));
    const res = await request(app).get("/daily/admin/catalog").set("x-admin-token", TOKEN);
    // Degrade, don't 500: the builder stays usable, but usage is marked unknown
    // so it can't present every prompt as never-used.
    expect(res.status).toBe(200);
    expect(res.body.prompts.length).toBeGreaterThan(0);
    expect(res.body.usageAvailable).toBe(false);
    const p0 = res.body.prompts.find((p: { id: string }) => p.id === FIVE[0]);
    expect(p0.usedOn).toEqual([]);
  });
});

describe("hydrateAuthoredSets", () => {
  it("loads persisted sets into the overlay at boot", async () => {
    const repo = makeFakeAuthoredSetsRepo();
    await repo.upsert({ dailyDate: DATE, destination: DEST, routes: ROUTES, promptIds: FIVE });
    const n = await hydrateAuthoredSets(repo);
    expect(n).toBe(1);

    const app = express();
    app.use(express.json());
    registerDailyRoutes(app, { today: () => DATE });
    const daily = await request(app).get("/daily");
    expect((daily.body as DailySet).destination.name).toBe(DEST.name);
  });

  it("is a no-op with a null repo", async () => {
    expect(await hydrateAuthoredSets(null)).toBe(0);
  });
});
