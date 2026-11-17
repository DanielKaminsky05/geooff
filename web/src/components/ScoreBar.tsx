import { useEffect, useState } from "react";
import type { PlayerPublic } from "../lib/protocol";

export interface ScoreBarProps {
  p1?: PlayerPublic;
  p2?: PlayerPublic;
  scores: Record<string, number>;
  total: number;
  /** epoch ms when the round ends. */
  endsAt: number | null;
  category: string;
  /** Solo round: no opponent column. */
  solo?: boolean;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function useCountdown(endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null) return;
    // Resync immediately: `now` may be stale from mount (e.g. during countdown).
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt == null ? 0 : endsAt - now;
}

function PlayerScore({
  player,
  score,
  total,
  colorVar,
  align,
}: {
  player?: PlayerPublic;
  score: number;
  total: number;
  colorVar: string;
  align: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className="truncate text-sm font-semibold" style={{ color: colorVar }}>
        {player?.name ?? "Waiting…"}
        {player && !player.connected ? " (offline)" : ""}
      </div>
      <div className="text-xl font-bold tabular-nums" style={{ color: colorVar }}>
        {score} <span className="text-muted">/ {total}</span>
      </div>
    </div>
  );
}

export function ScoreBar({ p1, p2, scores, total, endsAt, category, solo }: ScoreBarProps) {
  const remaining = useCountdown(endsAt);
  const p1Score = p1 ? (scores[p1.id] ?? p1.score ?? 0) : 0;
  const p2Score = p2 ? (scores[p2.id] ?? p2.score ?? 0) : 0;
  const low = endsAt != null && remaining <= 30_000;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <PlayerScore
          player={p1}
          score={p1Score}
          total={total}
          colorVar="var(--color-player1)"
          align="left"
        />
      </div>

      <div className="flex flex-col items-center px-2">
        <div
          data-testid="timer"
          className="text-2xl font-bold tabular-nums"
          style={{ color: low ? "var(--color-accent)" : "var(--color-foreground)" }}
        >
          {endsAt == null ? "—:—" : fmt(remaining)}
        </div>
        <div className="text-xs uppercase tracking-wide text-muted">{category}</div>
      </div>

      <div className="min-w-0 flex-1">
        {!solo && (
          <PlayerScore
            player={p2}
            score={p2Score}
            total={total}
            colorVar="var(--color-player2)"
            align="right"
          />
        )}
      </div>
    </div>
  );
}

export default ScoreBar;
