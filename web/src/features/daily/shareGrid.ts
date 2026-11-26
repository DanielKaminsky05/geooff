/**
 * Daily Trek — spoiler-free share text.
 *
 * Builds a Wordle-style recap a player can paste anywhere: the date, journey
 * chosen, lived/died, and a per-prompt capture tier — WITHOUT revealing answers.
 *
 * IMPORTANT: no emoji anywhere. Capture tiers render with monochrome block
 * glyphs so the grid stays plain-text and copy-pastes cleanly into any client.
 */

import type { DailyRunResult, JourneyId } from "../../lib/protocol";

const TITLE = "GEOFIGHT Daily";

/** Human journey labels (never leak the internal id casing). */
const JOURNEY_LABEL: Record<JourneyId, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

/**
 * Five capture tiers, full → empty, as non-emoji block glyphs. The index is the
 * fraction of a prompt's valid answers that were named, bucketed into fifths.
 */
const TIER_GLYPHS = ["█", "▓", "▒", "░", "·"] as const;
//                    █          ▓          ▒          ░          ·

/** Map a named/total capture ratio to one of the five tier glyphs. */
function tierGlyph(named: number, total: number): string {
  if (total <= 0) return TIER_GLYPHS[0]; // nothing to capture → treat as full
  const ratio = Math.max(0, Math.min(1, named / total));
  if (ratio >= 1) return TIER_GLYPHS[0];
  if (ratio >= 0.75) return TIER_GLYPHS[1];
  if (ratio >= 0.5) return TIER_GLYPHS[2];
  if (ratio > 0) return TIER_GLYPHS[3];
  return TIER_GLYPHS[4]; // zero named
}

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
