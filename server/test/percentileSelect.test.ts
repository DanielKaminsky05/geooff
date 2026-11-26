import { describe, it, expect } from "vitest";
import { selectPercentile, MIN_FIELD } from "../src/daily/percentileSelect.js";
import { capturePercentile } from "../src/daily/percentile.js";

describe("selectPercentile — real vs synthetic at the MIN_FIELD boundary", () => {
  it("uses the real percentile once the field reaches MIN_FIELD", () => {
    const realPct = 42;
    const ratio = 1; // synthetic would be 99 — clearly different from realPct
    expect(selectPercentile({ fieldSize: MIN_FIELD, realPct, ratio })).toBe(realPct);
    expect(selectPercentile({ fieldSize: MIN_FIELD + 100, realPct, ratio })).toBe(realPct);
  });

  it("falls back to the synthetic curve below MIN_FIELD", () => {
    const ratio = 0.5;
    const synthetic = capturePercentile(ratio);
    expect(selectPercentile({ fieldSize: 0, realPct: 42, ratio })).toBe(synthetic);
    expect(selectPercentile({ fieldSize: MIN_FIELD - 1, realPct: 42, ratio })).toBe(synthetic);
  });

  it("the switch happens exactly at MIN_FIELD, not one short of it", () => {
    const realPct = 10;
    const ratio = 1; // synthetic = 99, so the two branches are distinguishable
    const justBelow = selectPercentile({ fieldSize: MIN_FIELD - 1, realPct, ratio });
    const atBoundary = selectPercentile({ fieldSize: MIN_FIELD, realPct, ratio });
    expect(justBelow).toBe(capturePercentile(ratio));
    expect(atBoundary).toBe(realPct);
    expect(justBelow).not.toBe(atBoundary);
  });
});
