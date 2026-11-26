/**
 * Daily Trek — synthetic percentile.
 *
 * Phase 1 has no cross-player data, so "you beat ~N% of players" is a HARDCODED,
 * monotonic, plausible curve mapping a capture ratio (your points ÷ the day's
 * theoretical max, 0..1) to a percentile (0..100). No statistical basis — it is
 * purely for the social hit and is labeled an estimate on the end screen. Phase
 * 2 swaps the implementation for a real aggregate behind the same response.
 *
 * Anchors (monotonic, interpolated): 0 → 5, 0.5 → 70, 1.0 → 99. A full capture
 * is prestigious but short of a literal 100th percentile.
 */

/** Smoothstep ease between a and b over t∈[0,1] (S-curve, zero slope at ends). */
function smoothstep(a: number, b: number, t: number): number {
  const u = t * t * (3 - 2 * t);
  return a + (b - a) * u;
}

/** Monotonic anchors the curve passes through. Must be sorted by ratio. */
const ANCHORS: { ratio: number; pct: number }[] = [
  { ratio: 0.0, pct: 5 },
  { ratio: 0.5, pct: 70 },
  { ratio: 1.0, pct: 99 },
];

/**
 * Map a capture ratio (0..1) to a percentile (0..100). Ratios outside [0,1] are
 * clamped; between anchors we smoothstep for a pleasant S-curve. Monotonic:
 * a higher ratio never returns a lower percentile. Result is rounded.
 */
export function capturePercentile(ratio01: number): number {
  const r = Math.max(0, Math.min(1, ratio01));
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const lo = ANCHORS[i];
    const hi = ANCHORS[i + 1];
    if (r <= hi.ratio) {
      const span = hi.ratio - lo.ratio;
      const t = span === 0 ? 0 : (r - lo.ratio) / span;
      return Math.round(smoothstep(lo.pct, hi.pct, t));
    }
  }
  return ANCHORS[ANCHORS.length - 1].pct;
}
