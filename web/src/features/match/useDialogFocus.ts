import { useEffect, useEffectEvent, type RefObject } from "react";

/**
 * Focus management for a modal surface: while `active`, move focus to
 * `initialFocus` (falling back to the first enabled button inside it, then the
 * element itself), close on Escape via `onEscape`, and on deactivate/unmount
 * hand focus back to whatever had it before (if it's still in the document).
 */
export function useDialogFocus(
  active: boolean,
  initialFocus: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  const escape = useEffectEvent(() => onEscape?.());
  const hasEscape = onEscape != null;

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus.current;
    if (target) {
      const focusable =
        target instanceof HTMLButtonElement && !target.disabled
          ? target
          : (target.querySelector<HTMLElement>("button:not([disabled])") ?? target);
      focusable.focus({ preventScroll: true });
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        escape();
      }
    }
    if (hasEscape) document.addEventListener("keydown", onKey);
    return () => {
      if (hasEscape) document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active, initialFocus, hasEscape]);
}
