import { useMemo, type ReactNode } from "react";
import LivesBar, { type LivesBarPlayer } from "../../components/LivesBar";
import PromptBanner from "../../components/PromptBanner";
import TurnTimer from "../../components/TurnTimer";
import { slotColor } from "../../lib/colors";
import RevealScreen, { type RevealPlayer } from "./PromptReveal";
import { FloatingHud } from "./MatchHud";
import MapPane from "./MapPane";
import { displayName, type MatchModel } from "./matchModel";
import type { RoundResult } from "./matchState";

/**
 * Showdown: simultaneous rounds on your own board. A floating HUD shows every
 * player's live count + hearts (the current fewest flagged as in danger), the
 * active prompt, and the round clock; between rounds a result card shows who
 * lost a heart.
 *
 * `children` are shared on-map extras (named button, away banner).
 */
export default function ShowdownView({
  model,
  children,
  onSkipReveal,
}: {
  model: MatchModel;
  children?: ReactNode;
  /** Vote to skip the between-round reveal pause (from the match container). */
  onSkipReveal?: () => void;
}) {
  const { state, roster, myId, maxLives } = model;
  const { lives, hits, scores, prompt, roundEndsAt, roundNum, roundResult } = state;

  // Keyed on `roster` (id/slot/name), not the whole room: an unrelated
  // room_state (reconnect, ready flag) leaves the status row cached.
  const statusPlayers = useMemo<LivesBarPlayer[]>(() => {
    const countOf = (id: string) => scores[id] ?? 0;
    const aliveCounts = roster.filter((p) => (lives[p.id] ?? maxLives) > 0).map((p) => countOf(p.id));
    const min = aliveCounts.length ? Math.min(...aliveCounts) : 0;
    const allEqual = aliveCounts.length > 0 && Math.max(...aliveCounts) === min;
    return roster.map((p) => {
      const lv = lives[p.id] ?? maxLives;
      return {
        id: p.id,
        name: displayName(p, myId),
        slot: p.slot,
        lives: lv,
        maxLives,
        isCurrent: false,
        eliminated: lv <= 0,
        hitKey: hits[p.id] ?? 0,
        count: countOf(p.id),
        inDanger: lv > 0 && !allEqual && countOf(p.id) === min,
      };
    });
  }, [roster, myId, lives, maxLives, hits, scores]);

  return (
    <>
      <FloatingHud className="gap-1 pb-3">
        <LivesBar players={statusPlayers} showHearts />
        {prompt && model.live && <PromptBanner bare label={prompt.label} />}
        {roundEndsAt != null && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted">
            <span>Round {roundNum}</span>
            <TurnTimer endsAt={roundEndsAt} />
          </div>
        )}
      </FloatingHud>

      <section className="relative min-h-0 flex-1">
        {/* Your own board: you race the prompt on your own map. */}
        <MapPane colorVar={model.myColor} filled={model.myFilled} categoryId={model.categoryId} hideTitle />
        {children}
      </section>

      {roundResult && !state.gameOver && (
        <RoundResultOverlay model={model} result={roundResult} onSkip={onSkipReveal} />
      )}
    </>
  );
}

/**
 * Between-round reveal: a full-board takeover that lights up the missed
 * countries in red, lists them down the side, and shows who lost a heart up top,
 * with a countdown + skip at the foot. Shared with gauntlet via RevealScreen.
 */
function RoundResultOverlay({
  model,
  result,
  onSkip,
}: {
  model: MatchModel;
  result: RoundResult;
  onSkip?: () => void;
}) {
  const ranked = [...model.players].sort(
    (a, b) => (result.counts[b.id] ?? 0) - (result.counts[a.id] ?? 0) || a.slot.localeCompare(b.slot),
  );
  const players: RevealPlayer[] = ranked.map((p) => {
    const lost = result.losers.includes(p.id);
    const out = result.eliminated.includes(p.id);
    return {
      id: p.id,
      name: displayName(p, model.myId),
      color: slotColor(p.slot),
      detail: out ? " · out" : lost ? " · −1 ♥" : "",
      danger: lost,
      count: result.counts[p.id] ?? 0,
      named: result.named[p.id] ?? [],
    };
  });
  return (
    <RevealScreen
      title={result.tie ? "Tie — everyone safe" : "Round over"}
      subtitle={result.missed.length > 0 ? `Left on the board · ${result.missed.length}` : undefined}
      missed={result.missed}
      swept={result.missed.length === 0}
      categoryId={model.categoryId}
      players={players}
      controls={{
        endsAt: model.state.revealEndsAt,
        votes: model.state.revealVotes,
        iSkipped: model.state.iSkipped,
        onSkip: onSkip ?? (() => {}),
      }}
    />
  );
}
