import { useMemo, type ReactNode } from "react";
import LivesBar, { type LivesBarPlayer } from "../../components/LivesBar";
import PromptBanner from "../../components/PromptBanner";
import TurnTimer from "../../components/TurnTimer";
import { slotColor } from "../../lib/colors";
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
export default function ShowdownView({ model, children }: { model: MatchModel; children?: ReactNode }) {
  const { state, players, myId, maxLives } = model;
  const { lives, hits, scores, prompt, roundEndsAt, roundNum, roundResult } = state;

  const statusPlayers = useMemo<LivesBarPlayer[]>(() => {
    if (!state.room) return [];
    const countOf = (id: string) => scores[id] ?? 0;
    const aliveCounts = players.filter((p) => (lives[p.id] ?? maxLives) > 0).map((p) => countOf(p.id));
    const min = aliveCounts.length ? Math.min(...aliveCounts) : 0;
    const allEqual = aliveCounts.length > 0 && Math.max(...aliveCounts) === min;
    return players.map((p) => {
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
  }, [state.room, players, myId, lives, maxLives, hits, scores]);

  return (
    <>
      <FloatingHud className="gap-1 pb-10">
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

      {roundResult && !state.gameOver && <RoundResultOverlay model={model} result={roundResult} />}
    </>
  );
}

/** Between-round result: counts + who lost a heart. */
function RoundResultOverlay({ model, result }: { model: MatchModel; result: RoundResult }) {
  const ranked = [...model.players].sort(
    (a, b) => (result.counts[b.id] ?? 0) - (result.counts[a.id] ?? 0) || a.slot.localeCompare(b.slot),
  );
  return (
    <div className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center">
        <h3 className="text-xl font-bold">{result.tie ? "Tie — everyone safe" : "Round over"}</h3>
        <ol className="mt-4 flex flex-col gap-1.5 text-left">
          {ranked.map((p) => {
            const lost = result.losers.includes(p.id);
            const out = result.eliminated.includes(p.id);
            return (
              <li
                key={p.id}
                data-testid={`round-row-${p.id}`}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 ${
                  lost ? "border-accent/50 bg-accent/10" : "border-border bg-surface-raised"
                }`}
              >
                <span className="truncate font-semibold" style={{ color: slotColor(p.slot) }}>
                  {displayName(p, model.myId)}
                  {out ? " · out" : lost ? " · −1 ♥" : ""}
                </span>
                <span className="tabular-nums">{result.counts[p.id] ?? 0}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-sm text-muted">Next round…</p>
      </div>
    </div>
  );
}
