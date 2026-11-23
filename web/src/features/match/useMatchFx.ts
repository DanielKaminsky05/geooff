import { useCallback, useEffect, useRef, useState } from "react";

export interface Flash {
  kind: "damage" | "gain";
  key: number;
}

export interface Toast {
  text: string;
  key: number;
}

const FLASH_MS = 550;
const SHAKE_MS = 450;
const HEARTBREAK_MS = 1700;
const TOAST_MS = 2000;

/**
 * Transient, timer-driven match FX: the life-loss vignette flash, screen
 * shake, final-life heart-break, and the gauntlet "Opponent named …" toast.
 * Every pending timer is cleared on unmount (and on reset).
 */
export function useMatchFx() {
  const [flash, setFlash] = useState<Flash | null>(null);
  const [shaking, setShaking] = useState(false);
  const [breaking, setBreaking] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((fn: () => void, ms: number) => {
    const pending = timers.current;
    const t = setTimeout(() => {
      pending.delete(t);
      fn();
    }, ms);
    pending.add(t);
  }, []);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** Someone lost a life: heart-break on my last life, else flash (+ shake if mine). */
  const lifeLost = useCallback(
    (mine: boolean, livesLeft: number) => {
      if (mine && livesLeft === 0) {
        setBreaking(true);
        later(() => setBreaking(false), HEARTBREAK_MS);
        return;
      }
      const key = (seq.current += 1);
      setFlash({ kind: mine ? "damage" : "gain", key });
      later(() => setFlash((cur) => (cur && cur.key === key ? null : cur)), FLASH_MS);
      if (mine) {
        setShaking(true);
        later(() => setShaking(false), SHAKE_MS);
      }
    },
    [later],
  );

  /** Show a brief toast; `key` re-triggers the fade on repeats. `ms` overrides
   *  the default dwell (the end-of-prompt reveal lingers a little longer). */
  const showToast = useCallback(
    (text: string, ms: number = TOAST_MS) => {
      const key = (seq.current += 1);
      setToast({ text, key });
      later(() => setToast((cur) => (cur && cur.key === key ? null : cur)), ms);
    },
    [later],
  );

  /** Drop all FX (a new game restarting in place). */
  const reset = useCallback(() => {
    clearTimers();
    setFlash(null);
    setShaking(false);
    setBreaking(false);
    setToast(null);
  }, [clearTimers]);

  return { flash, shaking, breaking, toast, lifeLost, showToast, reset };
}
