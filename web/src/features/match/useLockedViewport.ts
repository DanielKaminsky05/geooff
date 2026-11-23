import { useEffect } from "react";

/**
 * Keep the match a single, non-scrolling, keyboard-aware viewport (iOS).
 *
 * 1. Size the match to the *visible* viewport (above the keyboard and Safari
 *    toolbars) via `--app-h` rather than 100vh. Otherwise focusing the input
 *    pops the keyboard and scrolls the page up, hiding the map.
 * 2. Pin the body so the window physically cannot scroll: iOS would otherwise
 *    scroll the document to lift the input above the keyboard, dragging the
 *    map off the top of the screen.
 */
export function useLockedViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);

  useEffect(() => {
    const { body } = document;
    const html = document.documentElement;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
      height: body.style.height,
      overflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = "0";
    body.style.left = "0";
    body.style.width = "100%";
    body.style.height = "100%";
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.width = prev.width;
      body.style.height = prev.height;
      body.style.overflow = prev.overflow;
      html.style.overflow = prev.htmlOverflow;
    };
  }, []);
}
