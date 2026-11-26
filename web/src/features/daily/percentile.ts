/**
 * Daily Trek — synthetic percentile curve (client copy).
 *
 * Mirrors server/src/daily/percentile.ts exactly so the OFFLINE fallback
 * (a saved recap, or a /daily/finish that didn't reach the server) shows the
 * same "beat ~N%" number the server would have reconciled. Keep in sync with the
 * server anchors if they ever change — like lib/protocol.ts, this is a
 * deliberate copy (web and server are separate packages).
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

/** Map a capture ratio (0..1) to a percentile (0..100), smoothstepped between
 *  anchors. Ratios outside [0,1] are clamped; monotonic; rounded. */
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
