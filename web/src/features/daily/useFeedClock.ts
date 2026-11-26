/**
 * Daily Trek — feed-the-clock timer.
 *
 * Each prompt starts with `DAILY_BASE_SECONDS` (20s) on the clock and counts
 * down in real time. Every NEW correct answer feeds the clock
 * `DAILY_TIME_BONUS_SECONDS` (2s) via `addTime()`. When the clock reaches 0 the
 * `onExpire` callback fires once.
 *
 * Early-advance is the CALLER's concern: it simply stops reading `secondsLeft`
 * and calls `reset()` for the next prompt — the remaining seconds are
 * FORFEITED, never carried over. There is no cross-prompt time banking.
 *
 * The clock is client-run in phase 1 (nothing is persisted or ranked yet, so
 * there's no incentive to cheat timing — only answer VALIDITY is a server
 * round-trip, which keeps the valid set secret).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DAILY_BASE_SECONDS, DAILY_TIME_BONUS_SECONDS } from "./contract";

/** How often the countdown re-evaluates (ms). 100ms = smooth meter, cheap. */
const TICK_MS = 100;

export interface FeedClock {
  /** Whole seconds remaining (ceil), clamped at 0. For HUD/meter display. */
  secondsLeft: number;
  /** Add the per-answer time bonus. Call once per NEWLY-named correct answer. */
  addTime: () => void;
  /** Hard reset to the base time (start of a new prompt). */
  reset: () => void;
}

/**
 * @param onExpire fired exactly once when the clock first hits 0. Kept in a ref
 *        so a changing callback identity never restarts the timer.
 */
export function useFeedClock(onExpire: () => void): FeedClock {
  // Absolute wall-clock deadline (ms). Counting against a deadline (not
  // decrementing a counter each tick) keeps the clock accurate even if ticks
  // are late or the tab was briefly throttled. Seeded in an effect (not during
  // render) so no impure Date.now() call happens while rendering; the base
  // duration is the same either way.
  const deadlineRef = useRef<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(DAILY_BASE_SECONDS * 1000);
  const expiredRef = useRef(false);

  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  // Seed the deadline on mount.
  useEffect(() => {
    deadlineRef.current = Date.now() + DAILY_BASE_SECONDS * 1000;
  }, []);

  const recompute = useCallback(() => {
    const ms = Math.max(0, deadlineRef.current - Date.now());
    setRemainingMs(ms);
    if (ms <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current();
    }
  }, []);

  useEffect(() => {
    const id = setInterval(recompute, TICK_MS);
    return () => clearInterval(id);
  }, [recompute]);

  const addTime = useCallback(() => {
    // Feeding the clock after expiry would resurrect a dead prompt; ignore it.
    if (expiredRef.current) return;
    deadlineRef.current += DAILY_TIME_BONUS_SECONDS * 1000;
    recompute();
  }, [recompute]);

  const reset = useCallback(() => {
    expiredRef.current = false;
    deadlineRef.current = Date.now() + DAILY_BASE_SECONDS * 1000;
    setRemainingMs(DAILY_BASE_SECONDS * 1000);
  }, []);

  return {
    secondsLeft: Math.ceil(remainingMs / 1000),
    addTime,
    reset,
  };
}

export default useFeedClock;
