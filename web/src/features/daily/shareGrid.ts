/**
 * Daily Trek — spoiler-free share text.
 *
 * Builds a Wordle-style recap a player can paste anywhere: the date, journey
 * chosen, lived/died, and a per-prompt capture tier — WITHOUT revealing answers.
 *
 * IMPORTANT: no emoji anywhere. Capture tiers render with monochrome block
 * glyphs so the grid stays plain-text and copy-pastes cleanly into any client.
 */

import type { DailyRunResult } from "./contract";
import { JOURNEY_LABEL, tierGlyph } from "./shareLink";

const TITLE = "GEOFIGHT Daily";

/**
 * Build the spoiler-free share recap. A handful of lines: titled with the date,
 * the chosen journey, the outcome in words, one glyph line per prompt (with its
 * named/total ratio), and the total points. No country names ever appear.
 */
export function buildShareGrid(result: DailyRunResult): string {
  const journey = JOURNEY_LABEL[result.journey] ?? result.journey;
  const outcome = result.outcome === "arrived" ? "Arrived" : "Died";

  const lines: string[] = [];
  lines.push(`${TITLE} ${result.dailyDate}`);
  lines.push(`${journey} journey - ${outcome}`);

  result.perPrompt.forEach((p, i) => {
    const glyph = tierGlyph(p.named, p.total);
    lines.push(`${i + 1} ${glyph} ${p.named}/${p.total}`);
  });

  lines.push(`${result.points} pts`);

  return lines.join("\n");
}
