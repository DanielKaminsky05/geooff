/**
 * Daily Trek — local persistence seam.
 *
 * All saving goes through this interface so callers never touch `localStorage`
 * directly. `localDailyStore` can later be swapped for a server-backed
 * implementation (accounts/DB) WITHOUT changing a single caller.
 *
 * Phase-1 reality: the wallet and the one-attempt-per-day lock are device-local
 * and clearable. That's acceptable while there's no leaderboard to protect.
 */

import type { DailyRunResult } from "../../lib/protocol";

/** The revealed valid-answer lists per prompt, as returned by /daily/finish. */
export type RevealAnswers = Record<string, { iso: string; name: string }[]>;

export interface DailyStore {
  /** Current gold balance (no sink yet — the shop needs accounts). */
  getWallet(): number;
  /** Add gold, returning the new balance. */
  addGold(amount: number): number;
  /** Has today's run already been completed? (one-and-done) */
  isPlayedToday(dailyDate: string): boolean;
  /**
   * Mark a date's run as finished (locks replay for that day).
   * No-op when no result is stored for that date, so the one-and-done gate
   * ("played AND result present") can never be half-satisfied.
   * Prefer `recordFinished` for new call sites.
   */
  markPlayed(dailyDate: string): void;
  /** Persist a completed run (phase 2: to the DB; phase 1: localStorage). */
  saveResult(result: DailyRunResult): void;
  /** The finished run for a date, if any. */
  getResult(dailyDate: string): DailyRunResult | null;
  /**
   * Persist the revealed answers for a finished day so the recap can still show
   * the correct countries when the (locked) day is re-opened. Safe to store:
   * the player has already finished and seen them — no anti-cheat concern.
   */
  saveAnswers(dailyDate: string, answers: RevealAnswers): void;
  /** The stored revealed answers for a date, if any. */
  getAnswers(dailyDate: string): RevealAnswers | null;
  /**
   * Atomically-as-possible record a finished run: persists the result first,
   * then marks the date played only when the result is verifiably stored.
   * Prefer this over calling `saveResult` + `markPlayed` separately.
   */
  recordFinished(result: DailyRunResult): void;
  /** A stable anonymous device id (becomes the account id in phase 2). */
  getPlayerId(): string;
}

const K = {
  wallet: "geofight.daily.wallet",
  played: "geofight.daily.played", // JSON: Record<dailyDate, true>
  result: (date: string) => `geofight.daily.result.${date}`,
  answers: (date: string) => `geofight.daily.answers.${date}`,
  playerId: "geofight.daily.playerId",
} as const;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / disabled / private mode — degrade silently in phase 1.
  }
}

function newAnonymousId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `anon-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** The phase-1 localStorage-backed store. */
export const localDailyStore: DailyStore = {
  getWallet() {
    return readJSON<number>(K.wallet, 0);
  },
  addGold(amount) {
    const next = this.getWallet() + Math.max(0, Math.round(amount));
    writeJSON(K.wallet, next);
    return next;
  },
  isPlayedToday(dailyDate) {
    const played = readJSON<Record<string, true>>(K.played, {});
    return played[dailyDate] === true;
  },
  markPlayed(dailyDate) {
    // Guard: only set the played flag when a result is already stored.
    // This ensures the one-and-done gate ("played AND result present") is never
    // half-satisfied — a date cannot read as locked while having no result.
    if (this.getResult(dailyDate) == null) return;
    const played = readJSON<Record<string, true>>(K.played, {});
    played[dailyDate] = true;
    writeJSON(K.played, played);
  },
  saveResult(result) {
    writeJSON(K.result(result.dailyDate), result);
  },
  getResult(dailyDate) {
    return readJSON<DailyRunResult | null>(K.result(dailyDate), null);
  },
  saveAnswers(dailyDate, answers) {
    writeJSON(K.answers(dailyDate), answers);
  },
  getAnswers(dailyDate) {
    return readJSON<RevealAnswers | null>(K.answers(dailyDate), null);
  },
  recordFinished(result) {
    // Write the result first. If this silently fails (quota error etc.),
    // markPlayed will find no stored result and bail out — the invariant holds.
    this.saveResult(result);
    this.markPlayed(result.dailyDate);
  },
  getPlayerId() {
    let id = "";
    try {
      id = localStorage.getItem(K.playerId) ?? "";
    } catch {
      /* ignore */
    }
    if (!id) {
      id = newAnonymousId();
      try {
        localStorage.setItem(K.playerId, id);
      } catch {
        /* ignore */
      }
    }
    return id;
  },
};
