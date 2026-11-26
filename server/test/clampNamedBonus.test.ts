import { describe, it, expect } from "vitest";
import { clampNamedBonus } from "../src/daily/routes.js";

describe("clampNamedBonus", () => {
  it("clamps a known prompt's named count to the real pool size", () => {
    expect(clampNamedBonus(50, 7, true)).toBe(7);
    expect(clampNamedBonus(3, 7, true)).toBe(3);
  });

  it("yields 0 for a known prompt with an empty pool (no inflation)", () => {
    // The bug this guards: total === 0 must force named to 0, not trust the
    // client's value, even though an empty pool is only reachable via data corruption.
    expect(clampNamedBonus(50, 0, true)).toBe(0);
  });

  it("grants no bonus for an unknown / wrong-day prompt", () => {
    expect(clampNamedBonus(50, 7, false)).toBe(0);
    expect(clampNamedBonus(50, 0, false)).toBe(0);
  });

  it("is defensive against malformed client values", () => {
    expect(clampNamedBonus(-5, 7, true)).toBe(0);
    expect(clampNamedBonus(Number.NaN, 7, true)).toBe(0);
    expect(clampNamedBonus(Infinity, 7, true)).toBe(0);
    expect(clampNamedBonus("9", 7, true)).toBe(0);
    expect(clampNamedBonus(undefined, 7, true)).toBe(0);
  });
});
