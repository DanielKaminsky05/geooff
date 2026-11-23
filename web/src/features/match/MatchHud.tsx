import { useMemo, type ReactNode } from "react";
import ScoreBar from "../../components/ScoreBar";
import { slotColor } from "../../lib/colors";
import type { MatchModel } from "./matchModel";

/**
 * The shared score row, wired from the match model. In the turn-based modes it
 * renders `bare` inside the floating HUD with whose-turn + the per-turn clock
 * folded into its center column.
 */
export function MatchScoreBar({
  model,
  bare,
  compact,
}: {
  model: MatchModel;
  bare?: boolean;
  compact?: boolean;
}) {
  const { state, players, solo, me, turnBased, myTurn, currentPlayer } = model;
  const { filled } = state;

  // Gauntlet: how many each player has named for the CURRENT prompt (the
  // filled sets reset on each prompt), shown as "named / prompt total".
  const promptCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of players) m[p.id] = filled[p.id]?.size ?? 0;
    return m;
  }, [players, filled]);

  // Two columns in slot order: seats can be any pair (e.g. p1 vs p3 after
  // someone left), so don't assume p1/p2.
  const [left, right] = players;

  return (
    <ScoreBar
      p1={solo ? me : left}
      p2={solo ? undefined : right}
      solo={solo}
      scores={model.effectiveScores}
      total={state.total}
      endsAt={state.endsAt}
      category={model.categoryLabel}
      lastStanding={turnBased}
      gauntlet={model.gauntlet}
      promptCounts={promptCounts}
      promptTotal={state.prompt?.total ?? 0}
      lives={state.lives}
      maxLives={model.maxLives}
      hits={state.hits}
      bare={bare}
      compact={compact}
      showTurn={turnBased && model.live}
      turnName={myTurn ? "Your turn" : `${currentPlayer?.name ?? "Opponent"}'s turn`}
      turnColor={
        currentPlayer ? slotColor(currentPlayer.slot) : myTurn ? model.myColor : model.opponentColor
      }
      turnEndsAt={state.turnEndsAt}
      turnPausedMs={state.turnPausedMs}
    />
  );
}

/** A HUD floating over a full-height map, fading out at the bottom. */
export function FloatingHud({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col bg-gradient-to-b from-background via-background/90 to-transparent ${className}`}
    >
      {children}
    </div>
  );
}
