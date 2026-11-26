import { describe, it, expect } from "vitest";
import { buildShareGrid } from "./shareGrid";
import { promptTier } from "./tiers";
import type { DailyPromptResult, DailyRunResult } from "../../lib/protocol";

function promptResult(named: number, total: number, points = named * 10): DailyPromptResult {
  return { promptId: `p${named}-${total}`, named, total, points };
}

function makeResult(over: Partial<DailyRunResult> = {}): DailyRunResult {
  return {
    runId: "run-1",
    dailyDate: "2026-11-25",
    journey: "medium",
    points: 420,
    perPrompt: [
      promptResult(5, 5),
      promptResult(3, 10),
      promptResult(0, 8),
      promptResult(7, 7),
      promptResult(2, 20),
    ],
    gold: 150,
    outcome: "arrived",
    playerId: null,
    ...over,
  };
}

// Covers U+1F000–U+1FAFF (emoji blocks), misc symbols/dingbats, and variation
// selectors — anything that would render as an emoji/colored glyph.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

describe("buildShareGrid", () => {
  it("contains the date and journey", () => {
    const grid = buildShareGrid(makeResult());
    expect(grid).toContain("2026-11-25");
    expect(grid).toContain("Medium");
  });

  it("contains the total points", () => {
    const grid = buildShareGrid(makeResult({ points: 420 }));
    expect(grid).toContain("420");
  });

  it("renders one line per prompt", () => {
    const result = makeResult();
    const grid = buildShareGrid(result);
    const lines = grid.split("\n");
    // Each prompt produces a line that starts with its 1-based index.
    result.perPrompt.forEach((p, i) => {
      const line = lines.find((l) => l.startsWith(`${i + 1} `));
      expect(line, `prompt ${i + 1} line`).toBeTruthy();
      expect(line).toContain(`${p.named}/${p.total}`);
    });
  });

  it("states the outcome in words (not emoji)", () => {
    expect(buildShareGrid(makeResult({ outcome: "arrived" }))).toContain("Arrived");
    expect(buildShareGrid(makeResult({ outcome: "died" }))).toContain("Died");
  });

  it("contains NO emoji characters", () => {
    const grid = buildShareGrid(makeResult());
    expect(EMOJI_RE.test(grid)).toBe(false);
    // Spot-check: every char is plain ASCII or an allowed block glyph.
    const allowedBlocks = new Set(["█", "▓", "▒", "░", "·"]);
    for (const ch of grid) {
      const ok = ch.charCodeAt(0) < 128 || allowedBlocks.has(ch);
      expect(ok, `unexpected char: ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it("uses glyphs consistent with promptTier's grade (no threshold drift)", () => {
    // Each promptTier label maps to exactly one glyph; they must stay aligned so
    // a prompt reads as the same tier in the recap and the share grid.
    const LABEL_TO_GLYPH: Record<string, string> = {
      Flawless: "█",
      Great: "▓",
      Solid: "▒",
      Scraped: "░",
      Blank: "·",
    };
    const cases: Array<[number, number]> = [
      [5, 5], // 1.0  Flawless
      [8, 10], // 0.8  Great
      [9, 20], // 0.45 Solid — the boundary the two systems used to disagree on
      [2, 10], // 0.2  Scraped
      [0, 8], // 0    Blank
    ];
    const result = makeResult({ perPrompt: cases.map(([n, t]) => promptResult(n, t)) });
    const lines = buildShareGrid(result).split("\n");
    cases.forEach(([named, total], i) => {
      const line = lines.find((l) => l.startsWith(`${i + 1} `))!;
      const expected = LABEL_TO_GLYPH[promptTier(named, total).label];
      expect(line, `prompt ${i + 1} (ratio ${named}/${total})`).toContain(expected);
    });
  });

  it("renders a perfect prompt and an empty prompt as different tiers", () => {
    const perfect = buildShareGrid(
      makeResult({ perPrompt: [promptResult(5, 5)], points: 50 }),
    );
    const empty = buildShareGrid(
      makeResult({ perPrompt: [promptResult(0, 5)], points: 0 }),
    );
    const perfectGlyph = perfect.split("\n").find((l) => l.startsWith("1 "))!;
    const emptyGlyph = empty.split("\n").find((l) => l.startsWith("1 "))!;
    expect(perfectGlyph).not.toBe(emptyGlyph);
    // Full-capture glyph is the solid block; zero-capture is the faintest.
    expect(perfectGlyph).toContain("█");
    expect(emptyGlyph).toContain("·");
  });
});
