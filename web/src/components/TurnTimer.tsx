import { useEffect, useState } from "react";

export interface TurnTimerProps {
  /** epoch ms when the current turn's clock expires; null = no active turn. */
  endsAt: number | null;
  /** When set, the clock is frozen (current player disconnected) with this
   *  many ms left; `endsAt` is stale and ignored until a fresh turn starts. */
  pausedMs?: number | null;
}

/**
 * Per-turn countdown for last_standing. Counts down to `endsAt` (the same
 * server-authoritative deadline pattern as the race timer) and shows whole
 * seconds remaining.
 */
export function TurnTimer({ endsAt, pausedMs = null }: TurnTimerProps) {
  const paused = pausedMs != null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null || paused) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt, paused]);

  const secs = paused
    ? Math.max(0, Math.ceil(pausedMs / 1000))
    : endsAt == null
      ? null
      : Math.max(0, Math.ceil((endsAt - now) / 1000));
  const low = !paused && secs != null && secs <= 5;
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        data-testid="turn-timer"
        className="text-2xl font-bold tabular-nums"
        style={{ color: paused ? "var(--color-muted)" : low ? "var(--color-accent)" : "var(--color-foreground)" }}
      >
        {secs == null ? "—" : secs}
      </span>
      {paused && <span className="text-xs uppercase tracking-wide text-muted">paused</span>}
    </span>
  );
}

export default TurnTimer;
