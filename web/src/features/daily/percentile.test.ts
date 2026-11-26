import { describe, it, expect } from "vitest";
import { capturePercentile } from "./percentile";

describe("capturePercentile (client copy of the server curve)", () => {
  it("hits the server anchors exactly", () => {
    expect(capturePercentile(0)).toBe(5);
    expect(capturePercentile(0.5)).toBe(70);
    expect(capturePercentile(1)).toBe(99);
  });

  it("is an S-curve, not the old linear ratio*100 fallback", () => {
    // The bug: the fallback used round(clamp(ratio*100, 1, 99)), so 0 -> 1 and
    // 0.5 -> 50. The real curve gives 5 and 70 — assert the difference.
    expect(capturePercentile(0)).not.toBe(1);
    expect(capturePercentile(0.5)).not.toBe(50);
  });

  it("clamps out-of-range ratios", () => {
    expect(capturePercentile(-1)).toBe(5);
    expect(capturePercentile(2)).toBe(99);
  });

  it("is monotonic non-decreasing", () => {
    let prev = -Infinity;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const pct = capturePercentile(r);
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
  });
});
