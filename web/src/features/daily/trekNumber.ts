/**
 * Daily Trek sequential numbering (Wordle-style).
 *
 * Each day's trek has an ordinal derived purely from its date: the launch day is
 * Trek #1 and every date after it counts up by one. No storage — a given date
 * always maps to the same number, for authored and generator days alike.
 */

/** Launch day — Trek #1. Dates before this are pre-launch (<= 0). */
export const DAILY_EPOCH = "2026-11-26";

const MS_PER_DAY = 86_400_000;

/** UTC midnight (ms) for a "YYYY-MM-DD" string. */
function utcMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The trek number for a "YYYY-MM-DD" date (epoch = Trek #1). */
export function trekNumber(dateStr: string): number {
  return Math.floor((utcMidnight(dateStr) - utcMidnight(DAILY_EPOCH)) / MS_PER_DAY) + 1;
}
