import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint: the desktop layouts switch on at this width. */
export const DESKTOP_QUERY = "(min-width: 768px)";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * Subscribe to a CSS media query. Lets a component render only the layout that
 * is actually visible instead of mounting every variant and hiding the rest
 * with CSS (each hidden WorldMap is ~250 SVG paths + a zoom/pan instance).
 *
 * `fallback` is returned when `matchMedia` is unavailable (jsdom in tests,
 * which ships none by default, or a non-browser render). Tests can stub
 * `window.matchMedia` to exercise the other branch.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = () => (hasMatchMedia() ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}

/** True at desktop widths (>= md). Defaults to desktop where matchMedia is absent. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY, true);
}
