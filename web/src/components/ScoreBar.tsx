import { useEffect, useState } from "react";
import type { PlayerPublic } from "../lib/protocol";
import ProgressBar from "./ProgressBar";
import Hearts from "./Hearts";
import TurnTimer from "./TurnTimer";
import { slotColor } from "../lib/colors";

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
  /** last_standing: show each player's remaining lives up here. */
  lastStanding?: boolean;
  lives?: Record<string, number>;
  maxLives?: number;
  /** last_standing: per-player life-loss counters, to replay the hit FX. */
  hits?: Record<string, number>;
  /** gauntlet: show "named / prompt total" for the current prompt instead of score/total. */
  gauntlet?: boolean;
  /** gauntlet: per-player count named for the current prompt. */
  promptCounts?: Record<string, number>;
  /** gauntlet: number of valid answers in the current prompt. */
  promptTotal?: number;
  /** Drop the bar's own border/background (for use inside the floating HUD). */
  bare?: boolean;
  /** 3-4 player race: show only the center (timer + category); the per-player
      scores live in the on-map leaderboard, so the two side columns are hidden. */
  compact?: boolean;
  /** last_standing: fold whose-turn + per-turn clock into the center column. */
  showTurn?: boolean;
  turnName?: string;
  turnColor?: string;
  turnEndsAt?: number | null;
  /** last_standing: set while the turn clock is frozen (ms left). */
  turnPausedMs?: number | null;
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
  lives,
  maxLives,
  hitKey = 0,
  gauntlet = false,
}: {
  player?: PlayerPublic;
  score: number;
  total: number;
  colorVar: string;
  align: "left" | "right";
  /** When set, show prominent lives (last_standing) instead of the progress bar. */
  lives?: number;
  maxLives?: number;
  /** Increments each time this player loses a life → replays the hit FX. */
  hitKey?: number;
  /** Gauntlet: a shared pool — the count is unified in the center, not per-player,
      so each slot here shows just the name + lives (no number). */
  gauntlet?: boolean;
}) {
  const right = align === "right";
  const showLives = lives != null && maxLives != null;
  return (
    <div className={right ? "text-right" : "text-left"}>
      <div className="truncate text-sm font-semibold" style={{ color: colorVar }}>
        {player?.name ?? "Waiting…"}
        {player && !player.connected ? " (offline)" : ""}
      </div>
      <div className={`mt-1 flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
        {!gauntlet && (
          <div
            className="shrink-0 text-xl font-bold tabular-nums"
            style={{ color: colorVar }}
          >
            {score} <span className="text-sm text-muted">/ {total}</span>
          </div>
        )}
        {showLives ? (
          // Re-key on the hit count so the group pops + "−1" replays on a loss.
          <span key={hitKey} className="hearts-hit">
            {hitKey > 0 && (
              <span className="damage-pop" aria-hidden>
                −1
              </span>
            )}
            <Hearts lives={lives} max={maxLives} colorVar={colorVar} label={player?.name} size="lg" />
          </span>
        ) : (
          <div className="max-w-80 flex-1">
            <ProgressBar
              value={score}
              max={total}
              colorVar={colorVar}
              from={right ? "right" : "left"}
              heightClass="h-2.5"
              label={`${player?.name ?? "Player"} progress`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ScoreBar({
  p1,
  p2,
  scores,
  total,
  endsAt,
  category,
  solo,
  lastStanding,
  lives,
  maxLives,
  hits,
  gauntlet,
  promptCounts,
  promptTotal,
  bare,
  compact,
  showTurn,
  turnName,
  turnColor,
  turnEndsAt,
  turnPausedMs,
}: ScoreBarProps) {
  const remaining = useCountdown(endsAt);
  const p1Score = p1 ? (scores[p1.id] ?? p1.score ?? 0) : 0;
  const p2Score = p2 ? (scores[p2.id] ?? p2.score ?? 0) : 0;
  const low = endsAt != null && remaining <= 30_000;
  // Hearts are Gauntlet-only; Last Standing is sudden death (no lives shown).
  const livesFor = (p?: PlayerPublic) =>
    gauntlet && p && lives ? (lives[p.id] ?? maxLives) : undefined;
  const hitFor = (p?: PlayerPublic) => (gauntlet && p && hits ? (hits[p.id] ?? 0) : 0);
  // Gauntlet is a shared pool: unify both players' progress into one count.
  const promptNamed = Object.values(promptCounts ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${compact ? "justify-center" : "justify-between"} ${
        bare ? "" : "border-b border-border bg-surface"
      }`}
    >
      {!compact && (
        <div className="min-w-0 flex-1">
          <PlayerScore
            player={p1}
            score={p1Score}
            total={total}
            colorVar={slotColor(p1?.slot ?? "p1")}
            align="left"
            gauntlet={gauntlet}
            lives={livesFor(p1)}
            maxLives={gauntlet ? maxLives : undefined}
            hitKey={hitFor(p1)}
          />
        </div>
      )}

      <div className="flex flex-col items-center px-2">
        {/* Last Standing has no shared round clock — the per-turn timer lives in
            the turn bar, so only show the category here. */}
        {!lastStanding && (
          <div
            data-testid="timer"
            className="text-2xl font-bold tabular-nums"
            style={{ color: low ? "var(--color-accent)" : "var(--color-foreground)" }}
          >
            {endsAt == null ? "—:—" : fmt(remaining)}
          </div>
        )}
        <div className="text-xs uppercase tracking-wide text-muted">{category}</div>
        {/* Gauntlet: one unified count for the shared pool (not per-player). */}
        {gauntlet && (
          <div
            data-testid="gauntlet-count"
            className="text-xl font-bold tabular-nums text-foreground"
          >
            {promptNamed} <span className="text-sm text-muted">/ {promptTotal}</span>
          </div>
        )}
        {/* last_standing/gauntlet: whose turn + the per-turn clock, folded in
            here so there's no separate turn strip. */}
        {showTurn && (
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: turnColor }}>
              {turnName}
            </span>
            <TurnTimer endsAt={turnEndsAt ?? null} pausedMs={turnPausedMs ?? null} />
          </div>
        )}
      </div>

      {!compact && (
        <div className="min-w-0 flex-1">
          {!solo && (
            <PlayerScore
              player={p2}
              score={p2Score}
              total={total}
              colorVar={slotColor(p2?.slot ?? "p2")}
              align="right"
              gauntlet={gauntlet}
              lives={livesFor(p2)}
              maxLives={gauntlet ? maxLives : undefined}
              hitKey={hitFor(p2)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default ScoreBar;
