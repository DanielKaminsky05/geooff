import { describe, it, expect } from "vitest";
import { promptScore } from "./DailyDive";
import { DAILY_NAME_BONUS, DAILY_PROMPT_MAX } from "../features/daily/contract";
import type { DailyPromptResult } from "../features/daily/contract";

/**
 * Mirror of the server's per-prompt reconcile (server/src/daily/routes.ts):
 * clamp base to [0, DAILY_PROMPT_MAX], clamp named to the pool, round ONCE per
 * prompt. The client's promptScore must agree with this term-for-term so the
 * local run total equals the authoritative /daily/finish total.
 */
function serverPerPrompt(r: DailyPromptResult): number {
  const base = Math.max(0, Math.min(DAILY_PROMPT_MAX, r.points));
  const named = r.total > 0 ? Math.min(Math.max(0, r.named), r.total) : Math.max(0, r.named);
  return Math.round(base + DAILY_NAME_BONUS * named);
}

const mk = (points: number, named = 0, total = 10): DailyPromptResult => ({
  promptId: "p",
  points,
  named,
  total,
  namedIsos: [],
});

describe("promptScore", () => {
  it("returns an integer even for a fractional capture base", () => {
    expect(promptScore(mk(95.4))).toBe(95);
    expect(Number.isInteger(promptScore(mk(142.6, 1)))).toBe(true);
  });

  it("matches the server's per-prompt rounding term-for-term", () => {
    const rows = [mk(95.4), mk(0.5), mk(142.6, 2, 5), mk(73.49, 3)];
    for (const r of rows) expect(promptScore(r)).toBe(serverPerPrompt(r));
  });

  it("sums to the server total (Σ round, not round Σ)", () => {
    // round(95.4)+round(95.4) = 190, NOT round(95.4+95.4) = round(190.8) = 191.
    const rows = [mk(95.4), mk(95.4)];
    const clientTotal = rows.reduce((s, r) => s + promptScore(r), 0);
    const serverTotal = rows.reduce((s, r) => s + serverPerPrompt(r), 0);
    expect(clientTotal).toBe(serverTotal);
    expect(clientTotal).toBe(190);
  });

  it("clamps base to the prompt ceiling and named to the pool", () => {
    expect(promptScore(mk(999))).toBe(DAILY_PROMPT_MAX);
    expect(promptScore(mk(0, 50, 3))).toBe(DAILY_NAME_BONUS * 3); // named clamped to total
    expect(promptScore(mk(-5, -5, 10))).toBe(0);
  });
});
