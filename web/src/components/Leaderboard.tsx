import type { PlayerPublic } from "../lib/protocol";
import { slotColor } from "../lib/colors";

export interface LeaderboardRow {
  id: string;
  name: string;
  slot: PlayerPublic["slot"];
  count: number;
  isMe: boolean;
}

/**
 * Race leaderboard: every player ranked by count (desc). Each row is a colored
 * dot, name ("You" for me), and count. Tapping a row focuses that player's map.
 * Used both as the live in-match switcher and (via `ranked` rows) the game-over
 * final standings.
 */
export default function Leaderboard({
  rows,
  focusedId,
  onFocus,
  className,
}: {
  rows: LeaderboardRow[];
  focusedId?: string;
  onFocus?: (id: string) => void;
  className?: string;
}) {
  return (
    <ul className={`flex flex-col gap-1 ${className ?? ""}`}>
      {rows.map((r, i) => {
        const focused = r.id === focusedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onFocus?.(r.id)}
              aria-pressed={focused}
              data-testid={`leaderboard-row-${r.id}`}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition hover:brightness-125 ${
                focused ? "border-foreground bg-surface-raised" : "border-border bg-surface"
              }`}
            >
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted">{i + 1}</span>
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: slotColor(r.slot) }}
              />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {r.isMe ? "You" : r.name}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{r.count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
