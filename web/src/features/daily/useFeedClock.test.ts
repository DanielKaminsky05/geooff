import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFeedClock } from "./useFeedClock";
import { DAILY_BASE_SECONDS, DAILY_TIME_BONUS_SECONDS } from "./contract";

// Fake timers so we can drive the countdown deterministically. The hook counts
// against a wall-clock deadline (Date.now()), so advancing fake timers advances
// the mocked Date too (vi fakes Date alongside setInterval).
describe("useFeedClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the base time", () => {
    const { result } = renderHook(() => useFeedClock(() => {}));
    expect(result.current.secondsLeft).toBe(DAILY_BASE_SECONDS);
  });

  it("counts down in real time", () => {
    const { result } = renderHook(() => useFeedClock(() => {}));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.secondsLeft).toBe(DAILY_BASE_SECONDS - 5);
  });

  it("addTime() feeds the clock the per-answer bonus", () => {
    const { result } = renderHook(() => useFeedClock(() => {}));
    act(() => {
      vi.advanceTimersByTime(5000); // 15s left
    });
    expect(result.current.secondsLeft).toBe(DAILY_BASE_SECONDS - 5);
    act(() => {
      result.current.addTime();
    });
    expect(result.current.secondsLeft).toBe(
      DAILY_BASE_SECONDS - 5 + DAILY_TIME_BONUS_SECONDS,
    );
  });

  it("fires onExpire exactly once when the clock hits 0", () => {
    const onExpire = vi.fn();
    renderHook(() => useFeedClock(onExpire));
    act(() => {
      vi.advanceTimersByTime(DAILY_BASE_SECONDS * 1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    // Keep ticking past 0 — it must not re-fire.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("addTime() after expiry is ignored (a dead prompt stays dead)", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useFeedClock(onExpire));
    act(() => {
      vi.advanceTimersByTime(DAILY_BASE_SECONDS * 1000);
    });
    expect(result.current.secondsLeft).toBe(0);
    act(() => {
      result.current.addTime();
    });
    expect(result.current.secondsLeft).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("buying enough time delays expiry", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useFeedClock(onExpire));
    // Burn almost the whole base, then feed the clock before it expires.
    act(() => {
      vi.advanceTimersByTime((DAILY_BASE_SECONDS - 1) * 1000); // 1s left
    });
    act(() => {
      result.current.addTime(); // +2s -> 3s left
    });
    act(() => {
      vi.advanceTimersByTime(2000); // 1s left
    });
    expect(onExpire).not.toHaveBeenCalled();
    expect(result.current.secondsLeft).toBe(1);
  });

  it("reset() restores the base time and re-arms expiry", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useFeedClock(onExpire));
    act(() => {
      vi.advanceTimersByTime(DAILY_BASE_SECONDS * 1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.reset();
    });
    expect(result.current.secondsLeft).toBe(DAILY_BASE_SECONDS);
    // A fresh expiry fires for the new prompt.
    act(() => {
      vi.advanceTimersByTime(DAILY_BASE_SECONDS * 1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});
