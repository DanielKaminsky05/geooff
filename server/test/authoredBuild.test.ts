import { describe, it, expect } from "vitest";
import { compileAuthoredSet } from "../src/daily/authoredBuild.js";
import { buildPromptPool } from "../src/prompts.js";
import { DAILY_PROMPT_COUNT } from "../src/protocol.js";
import type { AuthoredDailySet } from "../src/daily/authoredSets.js";

const POOL = buildPromptPool("countries");
const FIVE = POOL.slice(0, DAILY_PROMPT_COUNT).map((p) => p.id);
const DATE = "2026-03-10";
const DEST = { name: "Testville", at: { lat: 41, lon: 29 } };
const ROUTES = [
  { journeyId: "short" as const, points: [{ lat: 25, lon: 55 }, { lat: 41, lon: 29 }] },
  { journeyId: "medium" as const, points: [{ lat: 22, lon: 88 }, { lat: 35, lon: 51 }, { lat: 41, lon: 29 }] },
  { journeyId: "long" as const, points: [{ lat: 1, lon: 103 }, { lat: 20, lon: 77 }, { lat: 41, lon: 29 }] },
];

function base(over: Partial<AuthoredDailySet> = {}): AuthoredDailySet {
  return { dailyDate: DATE, destination: DEST, routes: ROUTES, promptIds: FIVE, ...over };
}

describe("compileAuthoredSet", () => {
  it("compiles a valid authored set with resolved prompts, drawn destination and routes", () => {
    const r = compileAuthoredSet(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.set.dailyDate).toBe(DATE);
    expect(r.set.prompts.map((p) => p.id)).toEqual(FIVE);
    expect(r.set.destination).toEqual(DEST);
    expect(r.set.routes.map((rt) => rt.journeyId)).toEqual(["short", "medium", "long"]);
    expect(r.set.journeys.map((j) => j.id)).toEqual(["short", "medium", "long"]);
    expect(r.set.journeys[0].landmarks.length).toBeGreaterThan(0);
  });

  it("orders routes short, medium, long regardless of input order", () => {
    const r = compileAuthoredSet(base({ routes: [ROUTES[2], ROUTES[0], ROUTES[1]] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.set.routes.map((rt) => rt.journeyId)).toEqual(["short", "medium", "long"]);
  });

  it("applies a per-journey temple-gold override", () => {
    const r = compileAuthoredSet(
      base({ landmarks: { short: [{ atFraction: 0.5, gold: 99 }, { atFraction: 1, gold: 123 }] } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const short = r.set.journeys.find((j) => j.id === "short")!;
    expect(short.landmarks).toEqual([
      { atFraction: 0.5, gold: 99 },
      { atFraction: 1, gold: 123 },
    ]);
  });

  it("rejects the wrong number of prompts", () => {
    expect(compileAuthoredSet(base({ promptIds: FIVE.slice(0, 4) }))).toMatchObject({ ok: false });
  });

  it("rejects duplicate prompts", () => {
    const dupes = [FIVE[0], FIVE[0], FIVE[1], FIVE[2], FIVE[3]];
    expect(compileAuthoredSet(base({ promptIds: dupes }))).toMatchObject({ ok: false });
  });

  it("rejects an unknown prompt id", () => {
    const bad = [...FIVE.slice(0, 4), "not-a-real-prompt"];
    const r = compileAuthoredSet(base({ promptIds: bad }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown prompt/);
  });

  it("rejects a destination without a name or valid point", () => {
    expect(compileAuthoredSet(base({ destination: { name: "", at: { lat: 0, lon: 0 } } }))).toMatchObject({ ok: false });
    expect(
      compileAuthoredSet(base({ destination: { name: "X", at: { lat: 999, lon: 0 } } })),
    ).toMatchObject({ ok: false });
  });

  it("rejects when routes are missing a journey", () => {
    const r = compileAuthoredSet(base({ routes: [ROUTES[0], ROUTES[1]] }));
    expect(r.ok).toBe(false);
  });

  it("rejects a route with fewer than 2 points", () => {
    const r = compileAuthoredSet(base({ routes: [{ journeyId: "short", points: [{ lat: 1, lon: 1 }] }, ROUTES[1], ROUTES[2]] }));
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(compileAuthoredSet(base({ dailyDate: "2026-13-40" }))).toMatchObject({ ok: false });
  });
});
