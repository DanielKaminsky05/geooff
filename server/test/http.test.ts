import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createServer, type GeofightServer } from "../src/index.js";
import { createRoom, rooms } from "../src/rooms.js";

describe("HTTP API", () => {
  let server: GeofightServer;

  beforeEach(() => {
    server = createServer();
  });
  afterEach(() => {
    for (const r of [...rooms.values()]) rooms.delete(r.code);
  });

  it("GET /health returns 200 and { ok: true }", async () => {
    const res = await request(server.app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /api/rooms/:code returns exists:false for an unknown room", async () => {
    const res = await request(server.app).get("/api/rooms/ZZZZZZ");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: false, status: null, playerCount: 0 });
  });

  it("GET /api/rooms/:code returns public state for an existing room", async () => {
    const { room } = createRoom("Host");
    const res = await request(server.app).get(`/api/rooms/${room.code}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      exists: true,
      status: "lobby",
      playerCount: 1,
    });
  });

  it("GET /api/rooms/:code is case-insensitive on the code", async () => {
    const { room } = createRoom("Host");
    const res = await request(server.app).get(`/api/rooms/${room.code.toLowerCase()}`);
    expect(res.body).toMatchObject({ exists: true });
  });

  it("[anti-cheat] never includes answers or canonical names in the HTTP payload", async () => {
    const { room } = createRoom("Host");
    room.players[0].filled.add("fr");
    const res = await request(server.app).get(`/api/rooms/${room.code}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("France");
    expect(body).not.toContain("filled");
    // The HTTP payload exposes only a count + phase, never the country list.
    expect(res.body).not.toHaveProperty("filled");
  });
});
