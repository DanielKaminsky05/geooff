import { describe, it, expect } from "vitest";
import { compileAuthoredSet } from "../src/daily/authoredBuild.js";
import { buildPromptPool } from "../src/prompts.js";
import { destinations } from "../src/daily/destinations.js";
import { DAILY_PROMPT_COUNT } from "../src/protocol.js";
import type { AuthoredDailySet } from "../src/daily/authoredSets.js";

const POOL = buildPromptPool("countries");
const FIVE = POOL.slice(0, DAILY_PROMPT_COUNT).map((p) => p.id);
const DEST = destinations[0].destination.name;
const DATE = "2026-03-10";

function base(over: Partial<AuthoredDailySet> = {}): AuthoredDailySet {
  return { dailyDate: DATE, destinationName: DEST, promptIds: FIVE, ...over };
}

describe("compileAuthoredSet", () => {
  it("compiles a valid authored set with resolved prompts, destination and journeys", () => {
    const r = compileAuthoredSet(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.set.dailyDate).toBe(DATE);
    expect(r.set.prompts.map((p) => p.id)).toEqual(FIVE);
    expect(r.set.destination.name).toBe(DEST);
    expect(r.set.journeys.map((j) => j.id)).toEqual(["short", "medium", "long"]);
    // Default landmark layout when no override is given.
    expect(r.set.journeys[0].landmarks.length).toBeGreaterThan(0);
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

  it("rejects an unknown destination", () => {
    const r = compileAuthoredSet(base({ destinationName: "Atlantis" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown destination/);
  });

  it("rejects a malformed date", () => {
    expect(compileAuthoredSet(base({ dailyDate: "2026-13-40" }))).toMatchObject({ ok: false });
  });

  it("rejects malformed landmark overrides", () => {
    const r = compileAuthoredSet(base({ landmarks: { short: [{ atFraction: 2, gold: -1 }] } }));
    expect(r.ok).toBe(false);
  });
});
