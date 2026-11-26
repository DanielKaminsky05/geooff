import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface CountryInputProps {
  /**
   * Called with the trimmed guess on submit. Return `false` when the guess was
   * NOT sent (e.g. off-turn in a turn-based mode): the field then keeps its
   * text. Any other return value means it was sent, and the field clears
   * immediately (optimistically) so the next guess can be typed right away.
   */
  onSubmit: (text: string) => boolean | void;
  /**
   * Incrementing counter: bump to hard-reset the field (new game / round):
   * clears the text and forgets any in-flight guesses.
   */
  clearSignal: number;
  /**
   * Incrementing counter: bump once per accepted answer. The field's current
   * text is never touched (the player may already be typing the next guess);
   * it only retires the oldest in-flight guess.
   */
  acceptSignal?: number;
  /**
   * Incrementing counter: bump once per rejected answer (shake/flash). If the
   * field is still empty, the rejected guess is restored (selected) so it can
   * be fixed or typed over; if the player has typed further, their text stays.
   */
  rejectSignal: number;
  disabled?: boolean;
  /** Focus the field on mount (desktop only). Daily Trek opts in so each prompt
   *  drops you straight into typing. */
  autoFocus?: boolean;
}

const SHAKE_MS = 400;

function isCoarsePointer(): boolean {
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

/**
 * Presentational country input with optimistic submit.
 *  - Submit → clear at once and remember the guess as in flight.
 *  - Accept → retire the oldest in-flight guess; current text untouched.
 *  - Reject → retire it; restore it (selected) only into an empty field; shake.
 */
export function CountryInput({
  onSubmit,
  clearSignal,
  acceptSignal,
  rejectSignal,
  disabled,
  autoFocus,
}: CountryInputProps) {
  const [text, setText] = useState("");
  /** Bumped per reject: non-zero while shaking (restarts the timer on repeats). */
  const [shakeKey, setShakeKey] = useState(0);
  const shaking = shakeKey > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guesses sent but not yet answered, oldest first (results arrive in order). */
  const inFlight = useRef<string[]>([]);
  const selectAfterRestore = useRef(false);
  const prev = useRef({ clearSignal, acceptSignal, rejectSignal });

  // Auto-refocusing keeps the typing flow on desktop, but on touch devices it
  // force-pops the on-screen keyboard and scrolls the page — so skip it there
  // and let the player tap the field themselves.
  const refocus = () => {
    if (!isCoarsePointer()) inputRef.current?.focus();
  };

  // Focus on mount when asked (keeps you in the input as each prompt appears).
  useEffect(() => {
    if (autoFocus) refocus();
    // Mount only; refocus is stable enough and we only want the initial focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset (new game / round) → clear field + forget in-flight guesses.
  useEffect(() => {
    if (prev.current.clearSignal === clearSignal) return;
    prev.current.clearSignal = clearSignal;
    inFlight.current = [];
    setText("");
    refocus();
  }, [clearSignal]);

  // Accept → retire the oldest guess. Never touches what's being typed now.
  useEffect(() => {
    if (prev.current.acceptSignal === acceptSignal) return;
    prev.current.acceptSignal = acceptSignal;
    inFlight.current.shift();
  }, [acceptSignal]);

  // Reject → shake; restore the rejected guess only if the field is empty.
  useEffect(() => {
    if (prev.current.rejectSignal === rejectSignal) return;
    prev.current.rejectSignal = rejectSignal;
    // Without accept tracking we can't tell which guess was rejected: don't guess.
    const rejected = prev.current.acceptSignal === undefined ? undefined : inFlight.current.shift();
    // The DOM value is the committed text; empty means "hasn't typed further".
    if (rejected !== undefined && (inputRef.current?.value ?? "") === "") {
      selectAfterRestore.current = true;
      setText(rejected);
    }
    setShakeKey((k) => k + 1);
    refocus();
  }, [rejectSignal]);

  // End the shake a beat after the latest reject.
  useEffect(() => {
    if (shakeKey === 0) return;
    const t = setTimeout(() => setShakeKey(0), SHAKE_MS);
    return () => clearTimeout(t);
  }, [shakeKey]);

  // Select a restored guess once it's rendered, so typing replaces it.
  useLayoutEffect(() => {
    if (!selectAfterRestore.current) return;
    selectAfterRestore.current = false;
    if (!isCoarsePointer()) inputRef.current?.select();
  }, [text]);

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        // Empty (incl. a quick second Enter after the optimistic clear) → no-op.
        if (!trimmed) return;
        if (onSubmit(trimmed) === false) return; // not sent: keep the text
        inFlight.current.push(trimmed);
        setText("");
      }}
    >
      <input
        ref={inputRef}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter that commits an IME composition must not submit the guess.
          if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
            e.preventDefault();
          }
        }}
        placeholder="Type a country…"
        aria-label="Country guess"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        data-shaking={shaking ? "true" : "false"}
        className={`w-full rounded-xl border bg-surface px-5 py-4 text-lg outline-none transition placeholder:text-muted focus:border-foreground disabled:opacity-50 ${
          shaking
            ? "animate-[shake_0.4s] border-accent text-accent"
            : "border-border"
        }`}
      />
    </form>
  );
}

export default CountryInput;
