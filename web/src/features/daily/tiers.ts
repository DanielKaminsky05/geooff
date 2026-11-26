/**
 * Daily Trek — result tiers.
 *
 * Shared keyword logic so the end-of-run recap and the per-leg reveal agree:
 *  - runCategory: a headline keyword for the WHOLE run (how far you got).
 *  - promptTier: a per-prompt grade (how much of a question you captured), with a
 *    `full` flag for a 100% clear so the UI can celebrate it.
 */

import type { DailyRunResult } from "../../lib/protocol";

/**
 * A bold result category for the run. Arriving is tiered by the road you chose;
 * dying is tiered by how far along the road you made it.
 */
export function runCategory(
  outcome: DailyRunResult["outcome"],
  journey: DailyRunResult["journey"],
  progress: number,
): string {
  if (outcome === "arrived") {
    if (journey === "long") return "Legendary";
    if (journey === "medium") return "Intrepid";
    return "Wayfarer";
  }
  if (progress >= 0.8) return "So Close";
  if (progress >= 0.55) return "Wanderer";
  if (progress >= 0.3) return "Straggler";
  return "Stranded";
}

export interface PromptTier {
  label: string;
  /** A vivid color for the tier, so each one reads instantly. */
  color: string;
  /** True when every valid answer was named (a 100% clear). */
  full: boolean;
}

/** Grade one prompt by how much of its answer set you named. */
export function promptTier(named: number, total: number): PromptTier {
  if (total > 0 && named >= total) return { label: "Flawless", color: "#ffd23f", full: true };
  const ratio = total > 0 ? named / total : 0;
  if (ratio >= 0.75) return { label: "Great", color: "#c084fc", full: false };
  if (ratio >= 0.4) return { label: "Solid", color: "#4ade80", full: false };
  if (ratio > 0) return { label: "Scraped", color: "#fb923c", full: false };
  return { label: "Blank", color: "#9ca3af", full: false };
}

/** A unique line shown after the walk when a prompt is fully cleared. */
export const FULL_CLEAR_MESSAGE = "Flawless — you named every one!";
