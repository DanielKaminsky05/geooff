import { useEffect, useRef, useState } from "react";

export interface CountryInputProps {
  /** Called with the trimmed guess on submit. */
  onSubmit: (text: string) => void;
  /**
   * Incrementing counter: bump to clear the field (accepted answer).
   * The value itself doesn't matter, only that it changed.
   */
  clearSignal: number;
  /**
   * Incrementing counter: bump to shake/flash the field (rejected/duplicate).
   * The field keeps its text.
   */
  rejectSignal: number;
  disabled?: boolean;
}

/**
 * Presentational country input.
 *  - On accept (clearSignal change) → clears the field, ready for next guess.
 *  - On reject (rejectSignal change) → keeps text, triggers a brief shake/flash.
 */
export function CountryInput({
  onSubmit,
  clearSignal,
  rejectSignal,
  disabled,
}: CountryInputProps) {
  const [text, setText] = useState("");
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstClear = useRef(true);
  const firstReject = useRef(true);

  // Accept → clear field.
  useEffect(() => {
    if (firstClear.current) {
      firstClear.current = false;
      return;
    }
    setText("");
    inputRef.current?.focus();
  }, [clearSignal]);

  // Reject → keep text, shake/flash.
  useEffect(() => {
    if (firstReject.current) {
      firstReject.current = false;
      return;
    }
    setShaking(true);
    inputRef.current?.focus();
    inputRef.current?.select();
    const t = setTimeout(() => setShaking(false), 400);
    return () => clearTimeout(t);
  }, [rejectSignal]);

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
      }}
    >
      <input
        ref={inputRef}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
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
