import { useEffect, useState } from "react";

export interface TurnTimerProps {
  /** epoch ms when the current turn's clock expires; null = no active turn. */
  endsAt: number | null;
}

/**
 * Per-turn countdown for last_standing. Counts down to `endsAt` (the same
 * server-authoritative deadline pattern as the race timer) and shows whole
 * seconds remaining.
 */
export function TurnTimer({ endsAt }: TurnTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const secs = endsAt == null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
  const low = secs != null && secs <= 5;
  return (
    <span
      data-testid="turn-timer"
      className="text-2xl font-bold tabular-nums"
      style={{ color: low ? "var(--color-accent)" : "var(--color-foreground)" }}
    >
      {secs == null ? "—" : secs}
    </span>
  );
}

export default TurnTimer;
