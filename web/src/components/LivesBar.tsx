import Hearts from "./Hearts";
import { slotColor } from "../lib/colors";
import type { PlayerPublic } from "../lib/protocol";

export interface LivesBarPlayer {
  id: string;
  name: string;
  slot: PlayerPublic["slot"];
  lives: number;
  maxLives: number;
  /** Highlight this player as the one whose turn it is. */
  isCurrent: boolean;
  /** Out of the game (0 lives) → dimmed. */
  eliminated: boolean;
  /** Increments on each life lost → replays the hit FX. */
  hitKey: number;
  /** showdown: this player's tally this round (omitted for turn-based modes). */
  count?: number;
  /** showdown: tied for the fewest right now → shown in the danger color. */
  inDanger?: boolean;
}

/**
 * 3-4 player turn-based HUD: a chip per player with their name, the current
 * player's chip highlighted and eliminated players dimmed. Gauntlet also shows
 * remaining hearts; Last Standing is sudden death, so it shows no hearts.
 * Replaces the two-column ScoreBar (which only fits two players).
 */
export default function LivesBar({
  players,
  showHearts,
}: {
  players: LivesBarPlayer[];
  /** Gauntlet shows hearts; Last Standing (sudden death) does not. */
  showHearts: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-2 px-3 pt-2">
      {players.map((p) => {
        const color = slotColor(p.slot);
        return (
          <div
            key={p.id}
            data-testid={`lives-${p.id}`}
            aria-current={p.isCurrent ? "true" : undefined}
            className={`rounded-lg border px-2.5 py-1 transition ${
              p.isCurrent ? "border-foreground bg-surface-raised" : "border-border bg-surface/70"
            } ${p.eliminated ? "opacity-40" : ""}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-semibold" style={{ color }}>
                {p.name}
                {p.eliminated ? " · out" : ""}
                {/* Highlight/danger are colour-only visually; say them too. */}
                {p.isCurrent && !p.eliminated && <span className="sr-only">, current turn</span>}
              </span>
              {p.count != null && (
                <span
                  className="shrink-0 text-base font-bold tabular-nums"
                  style={{ color: p.inDanger && !p.eliminated ? "var(--color-accent)" : color }}
                >
                  {p.count}
                  {p.inDanger && !p.eliminated && <span className="sr-only"> (in danger)</span>}
                </span>
              )}
            </div>
            {showHearts && (
              <span key={p.hitKey} className="hearts-hit mt-0.5 inline-flex">
                {p.hitKey > 0 && (
                  <span className="damage-pop" aria-hidden>
                    −1
                  </span>
                )}
                <Hearts lives={p.lives} max={p.maxLives} colorVar={color} label={p.name} size="sm" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
