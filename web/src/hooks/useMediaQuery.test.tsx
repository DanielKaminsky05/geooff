import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsDesktop, useMediaQuery } from "./useMediaQuery";

describe("useMediaQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back when matchMedia is unavailable (jsdom default)", () => {
    expect(window.matchMedia).toBeUndefined();
    expect(renderHook(() => useMediaQuery("(min-width: 1px)")).result.current).toBe(false);
    expect(renderHook(() => useMediaQuery("(min-width: 1px)", true)).result.current).toBe(true);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
  });

  it("tracks the query and updates on change", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    }));

    const { result, unmount } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
