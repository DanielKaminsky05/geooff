import { describe, it, expect } from "vitest";
import {
  encodeDailyShare,
  decodeDailyShare,
  dailySharePath,
  dailyShareUrl,
  tierGlyph,
  tierColor,
} from "./shareLink";
import type { DailyRunResult } from "../../lib/protocol";

const run: DailyRunResult = {
  runId: "r1",
  dailyDate: "2026-11-26",
  journey: "long",
  points: 4217,
  gold: 120,
  outcome: "arrived",
  playerId: null,
  perPrompt: [
    { promptId: "a", named: 5, total: 5, points: 10 },
    { promptId: "b", named: 3, total: 8, points: 6 },
    { promptId: "c", named: 0, total: 4, points: 0 },
  ],
};

describe("daily share link", () => {
  it("round-trips a run through encode → decode", () => {
    const data = decodeDailyShare(encodeDailyShare(run, "Legendary"));
    expect(data).not.toBeNull();
    expect(data).toMatchObject({
      date: "2026-11-26",
      journey: "long",
      outcome: "arrived",
      points: 4217,
      category: "Legendary",
    });
    expect(data!.grid).toEqual([
      { named: 5, total: 5 },
      { named: 3, total: 8 },
      { named: 0, total: 4 },
    ]);
  });

  it("produces a URL-safe payload (no +, /, = or spaces)", () => {
    const payload = encodeDailyShare(run, "Legendary");
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("omits category when not supplied", () => {
    const data = decodeDailyShare(encodeDailyShare(run));
    expect(data?.category).toBeUndefined();
  });

  it("rejects garbage, empty, and non-base64 input", () => {
    expect(decodeDailyShare("")).toBeNull();
    expect(decodeDailyShare("not-real-data!!")).toBeNull();
    expect(decodeDailyShare("////")).toBeNull();
  });

  it("builds a /s/ path and an absolute URL from the origin", () => {
    const payload = encodeDailyShare(run, "Legendary");
    expect(dailySharePath(run, "Legendary")).toBe(`/s/${payload}`);
    expect(dailyShareUrl(run, "https://example.com/", "Legendary")).toBe(
      `https://example.com/s/${payload}`,
    );
  });

  it("tier helpers agree on the capture buckets", () => {
    expect(tierGlyph(5, 5)).toBe("█");
    expect(tierGlyph(0, 4)).toBe("·");
    expect(tierColor(5, 5)).toBe("#ffd23f"); // Flawless
    expect(tierColor(0, 4)).toBe("#9ca3af"); // Blank
    // total 0 is treated as a full capture (nothing to miss)
    expect(tierGlyph(0, 0)).toBe("█");
  });
});
