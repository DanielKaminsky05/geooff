import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMatchFx } from "./useMatchFx";

describe("useMatchFx", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flashes + shakes on my hit, then clears on its own", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMatchFx());
    act(() => result.current.lifeLost(true, 2));
    expect(result.current.flash?.kind).toBe("damage");
    expect(result.current.shaking).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.flash).toBeNull();
    expect(result.current.shaking).toBe(false);
  });

  it("breaks the heart on my final life instead of flashing", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMatchFx());
    act(() => result.current.lifeLost(true, 0));
    expect(result.current.breaking).toBe(true);
    expect(result.current.flash).toBeNull();
    act(() => vi.advanceTimersByTime(1700));
    expect(result.current.breaking).toBe(false);
  });

  it("clears every pending timer on unmount", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useMatchFx());
    act(() => {
      result.current.lifeLost(false, 1);
      result.current.showToast("Opponent named Japan");
    });
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
