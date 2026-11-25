import { useMemo, type ReactNode } from "react";
import WorldMap from "../../components/WorldMap";
import LivesBar, { type LivesBarPlayer } from "../../components/LivesBar";
import PromptBanner from "../../components/PromptBanner";
import { MatchScoreBar } from "./MatchHud";
import MapPane from "./MapPane";
import { displayName, type MatchModel } from "./matchModel";

/**
 * The turn-based shell shared by Last Standing and Gauntlet: a floating HUD
 * (N-player lives bar for 3-4 players, the score row with whose-turn + turn
 * clock, gauntlet's prompt) over one shared battlefield, where every claim is
 * coloured by whoever took it.
 *
 * `children` are shared on-map extras (named button, away banner).
 */
export default function LastStandingView({
  model,
  children,
}: {
  model: MatchModel;
  children?: ReactNode;
  /** Accepted for a uniform View signature; unused here (gauntlet reveal rides
   *  on a separate overlay in the match container). */
  onSkipReveal?: () => void;
}) {
  // `roster` (id/slot/name only) rather than `players`, so a reconnect or score
  // tick in a room_state doesn't rebuild the lives bar or the shared map colours.
  const { state, roster, myId, maxLives, gauntlet } = model;
  const { lives, hits, currentPlayerId, filled, prompt } = state;
  const multi = model.playerCount > 2;

  // 3-4 players: the two-column ScoreBar can't fit everyone, add a lives bar.
  const livesBarPlayers = useMemo<LivesBarPlayer[]>(() => {
    if (!multi) return [];
    return roster.map((p) => {
      const lv = lives[p.id] ?? maxLives;
      return {
        id: p.id,
        name: displayName(p, myId),
        slot: p.slot,
        lives: lv,
        maxLives,
        isCurrent: p.id === currentPlayerId,
        eliminated: lv <= 0,
        hitKey: hits[p.id] ?? 0,
      };
    });
  }, [multi, roster, myId, lives, maxLives, currentPlayerId, hits]);

  // One shared map: colour each claimed item by who took it.
  const claimedColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of roster) {
      for (const id of filled[p.id] ?? []) m.set(id, p.color);
    }
    return m;
  }, [roster, filled]);

  return (
    <>
      {/* Top chrome: a solid charcoal bar IN FLOW (shrink-0) so it never
          overlaps/clips the map — the map sits directly below it. Lives + score
          only; the active prompt floats on the map (below). */}
      <div className="chrome-bar chrome-ink flex shrink-0 flex-col border-b border-[var(--color-chrome-gold)]/40">
        {multi && <LivesBar players={livesBarPlayers} showHearts={gauntlet} />}
        <MatchScoreBar model={model} bare compact={multi} />
      </div>

      <section className="relative min-h-0 flex-1">
        {model.solo ? (
          // Solo gauntlet: just your map; name + count live in the HUD above.
          <MapPane
            colorVar={model.myColor}
            filled={model.myFilled}
            categoryId={model.categoryId}
            hideTitle
          />
        ) : (
          <div className="relative h-full">
            <WorldMap
              filledIso={model.myFilled}
              color={model.myColor}
              colorByIso={claimedColors}
              categoryId={model.categoryId}
              className="h-full w-full"
            />
          </div>
        )}
        {/* Active prompt floats directly on the map, just under the bar. */}
        {gauntlet && model.live && prompt && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-4 [text-shadow:0_1px_3px_var(--map-paper)]">
            <PromptBanner bare label={prompt.label} />
          </div>
        )}
        {children}
      </section>
    </>
  );
}
