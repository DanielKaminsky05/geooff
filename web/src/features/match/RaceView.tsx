import { useMemo, useState, type ReactNode } from "react";
import Leaderboard, { type LeaderboardRow } from "../../components/Leaderboard";
import { slotColor } from "../../lib/colors";
import { MatchScoreBar } from "./MatchHud";
import MapPane from "./MapPane";
import { EMPTY, SLOT_ORDER, paneTitle, type MatchModel } from "./matchModel";

/**
 * Race: solo shows just your map; a 1-v-1 keeps the classic side-by-side maps
 * (desktop) / you↔opponent toggle (mobile); 3-4 players get one big focused
 * map plus a leaderboard that doubles as the player switcher.
 *
 * `children` are shared on-map extras (named button, away banner).
 */
export default function RaceView({ model, children }: { model: MatchModel; children?: ReactNode }) {
  // Kept here (not in the sub-layouts) so it survives a 2↔3 player switch.
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [showOpponent, setShowOpponent] = useState(false);
  const multi = model.race && model.playerCount > 2;

  return (
    <>
      {multi ? (
        // The timer floats centered over the map (no strip), so the map is
        // full-height and the leaderboard sits flush at the top-left.
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
          <MatchScoreBar model={model} bare compact />
        </div>
      ) : (
        <MatchScoreBar model={model} />
      )}

      <section className="relative min-h-0 flex-1">
        {model.solo ? (
          <MapPane
            title={paneTitle("You", model.me)}
            colorVar={model.myColor}
            filled={model.myFilled}
            categoryId={model.categoryId}
          />
        ) : multi ? (
          <FocusedRace model={model} focusedPlayerId={focusedPlayerId} onFocus={setFocusedPlayerId} />
        ) : (
          <DuelRace
            model={model}
            showOpponent={showOpponent}
            onToggle={() => setShowOpponent((s) => !s)}
          />
        )}
        {children}
      </section>
    </>
  );
}

function DuelRace({
  model,
  showOpponent,
  onToggle,
}: {
  model: MatchModel;
  showOpponent: boolean;
  onToggle: () => void;
}) {
  const { me, myColor, myFilled, categoryId } = model;
  // This layout is only used with at most one opponent.
  const [rival] = model.opponents;
  const rivalColor = rival ? slotColor(rival.slot) : model.opponentColor;
  const rivalFilled = rival ? model.filledFor(rival.id) : EMPTY;
  const myTitle = paneTitle("You", me);
  const rivalTitle = paneTitle("Opponent", rival);

  return (
    <>
      {/* Desktop: side by side */}
      <div className="hidden h-full md:grid md:grid-cols-2">
        <MapPane title={myTitle} colorVar={myColor} filled={myFilled} categoryId={categoryId} borderRight />
        <MapPane
          title={rivalTitle}
          colorVar={rivalColor}
          filled={rivalFilled}
          categoryId={categoryId}
          revealNames={false}
        />
      </div>

      {/* Mobile: single map + toggle */}
      <div className="flex h-full flex-col md:hidden">
        <MapPane
          title={showOpponent ? rivalTitle : myTitle}
          colorVar={showOpponent ? rivalColor : myColor}
          filled={showOpponent ? rivalFilled : myFilled}
          categoryId={categoryId}
          revealNames={!showOpponent}
        />
        <button
          onClick={onToggle}
          className="absolute right-3 top-3 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow"
        >
          {showOpponent ? "View yours" : "View opponent"}
        </button>
      </div>
    </>
  );
}

/**
 * 3-4 players: one big focused map + a leaderboard switcher. Same layout on
 * mobile and desktop. Only my own map reveals country-name tooltips.
 */
function FocusedRace({
  model,
  focusedPlayerId,
  onFocus,
}: {
  model: MatchModel;
  focusedPlayerId: string | null;
  onFocus: (id: string) => void;
}) {
  const { players, myId, effectiveScores, filledFor } = model;

  // Every player ranked by count (desc), seat order as the stable tie-break.
  const rows = useMemo<LeaderboardRow[]>(
    () =>
      players
        .map((p) => ({
          id: p.id,
          name: p.name,
          slot: p.slot,
          count: effectiveScores[p.id] ?? filledFor(p.id).size,
          isMe: p.id === myId,
        }))
        .sort((a, b) => b.count - a.count || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]),
    [players, effectiveScores, filledFor, myId],
  );

  // Focus my own map by default; keep a valid focus if the focused seat leaves.
  const focusedId =
    focusedPlayerId && players.some((p) => p.id === focusedPlayerId) ? focusedPlayerId : myId;
  const focused = players.find((p) => p.id === focusedId);
  const isMine = focusedId === myId;
  const filled = focusedId ? filledFor(focusedId) : model.myFilled;
  const color = slotColor(focused?.slot);

  return (
    <div className="relative h-full">
      <MapPane colorVar={color} filled={filled} categoryId={model.categoryId} revealNames={isMine} hideTitle />
      {/* Current focus label (MapPane's own title is hidden to clear room for
          the leaderboard). */}
      <div
        className="absolute right-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold"
        style={{ color }}
      >
        {isMine ? "You" : (focused?.name ?? "Opponent")} · {filled.size}
      </div>
      <div className="absolute left-3 top-3 z-10 w-44 max-w-[55%] rounded-lg border border-border bg-surface/90 p-2 shadow backdrop-blur-sm">
        <Leaderboard rows={rows} focusedId={focusedId ?? undefined} onFocus={onFocus} />
      </div>
    </div>
  );
}
