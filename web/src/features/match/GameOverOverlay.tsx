import { useId, useRef, type ReactNode } from "react";
import ProgressBar from "../../components/ProgressBar";
import { slotColor } from "../../lib/colors";
import type { PlayerPublic } from "../../lib/protocol";
import { SLOT_ORDER, displayName } from "./matchModel";
import type { GameOver } from "./matchState";
import { useDialogFocus } from "./useDialogFocus";

interface Props {
  gameOver: GameOver;
  solo: boolean;
  gauntlet?: boolean;
  /** Every seated player. */
  players: PlayerPublic[];
  total: number;
  me?: PlayerPublic;
  onRematch: () => void;
  myRematch: boolean;
  othersRematch: boolean;
  onHome: () => void;
}

/**
 * End-of-game card. Solo shows your score (out of total); a 1-v-1 shows a
 * you-vs-opponent pair; 3+ players get a ranked final leaderboard.
 */
export default function GameOverOverlay(props: Props) {
  const { gameOver, solo, players, me } = props;
  if (solo) return <SoloResult {...props} />;

  const result =
    gameOver.winnerId == null ? "It's a tie!" : me && gameOver.winnerId === me.id ? "You win!" : "You lose";

  if (players.length > 2) {
    const ranked = players
      .map((p) => ({ p, score: gameOver.scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score || SLOT_ORDER[a.p.slot] - SLOT_ORDER[b.p.slot]);
    return (
      <Card title={result}>
        <ol className="mt-6 flex flex-col gap-2 text-left">
          {ranked.map(({ p, score }, i) => {
            const isWinner = gameOver.winnerId != null && p.id === gameOver.winnerId;
            return (
              <li
                key={p.id}
                data-testid={`final-rank-${p.id}`}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  isWinner ? "border-foreground bg-surface-raised" : "border-border"
                }`}
              >
                <span className="w-4 shrink-0 text-sm tabular-nums text-muted">{i + 1}</span>
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: slotColor(p.slot) }} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {displayName(p, me?.id ?? null)}
                  {isWinner && (
                    <span className="ml-1 text-xs text-muted" role="img" aria-label="winner">
                      👑
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xl font-bold tabular-nums" style={{ color: slotColor(p.slot) }}>
                  {score}
                </span>
              </li>
            );
          })}
        </ol>
        <RematchActions {...props} others="Someone wants a rematch" waiting="Waiting for others…" />
      </Card>
    );
  }

  // 1-v-1: this layout has at most one opponent.
  const rival = players.find((p) => p.id !== me?.id);
  return (
    <Card title={result}>
      <div className="mt-6 flex flex-col gap-4 text-left">
        <FinalScore
          name={me?.name ?? "You"}
          score={me ? (gameOver.scores[me.id] ?? 0) : 0}
          total={props.total}
          colorVar="var(--color-foreground)"
          testId="my-final-score"
        />
        <FinalScore
          name={rival?.name ?? "Opponent"}
          score={rival ? (gameOver.scores[rival.id] ?? 0) : 0}
          total={props.total}
          colorVar="var(--color-muted)"
          testId="opp-final-score"
        />
      </div>
      <RematchActions {...props} others="Opponent wants a rematch" waiting="Waiting for opponent…" />
    </Card>
  );
}

function SoloResult({ gameOver, gauntlet, total, me, myRematch, onRematch, onHome }: Props) {
  const myScore = me ? (gameOver.scores[me.id] ?? 0) : 0;
  return (
    <Card title={gauntlet ? "Run over" : total > 0 && myScore >= total ? "You named them all!" : "Round over"}>
      <p className="mt-6 text-sm text-muted">{gauntlet ? "You answered" : "You named"}</p>
      <p data-testid="my-final-score" className="text-5xl font-bold tabular-nums text-foreground">
        {myScore}
        {!gauntlet && <span className="text-2xl text-muted"> / {total}</span>}
      </p>
      {!gauntlet && (
        <div className="mt-3">
          <ProgressBar
            value={myScore}
            max={total}
            colorVar="var(--color-foreground)"
            heightClass="h-3"
            label="Your progress"
          />
        </div>
      )}
      <div className="mt-8 flex flex-col gap-3">
        <PrimaryButton onClick={onRematch} disabled={myRematch}>
          {myRematch ? "Starting…" : "Play again"}
        </PrimaryButton>
        <HomeButton onClick={onHome} />
      </div>
    </Card>
  );
}

/** The modal card: a dialog titled by the result, with initial focus on the
 *  first enabled action (Rematch / Play again, else Back to home). */
function Card({ title, children }: { title: string; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(true, cardRef);
  return (
    <div className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-background/90 px-6">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center"
      >
        <h2 id={titleId} className="text-3xl font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function RematchActions({
  myRematch,
  othersRematch,
  onRematch,
  onHome,
  others,
  waiting,
}: Props & { others: string; waiting: string }) {
  return (
    <div className="mt-8 flex flex-col gap-3">
      {othersRematch && !myRematch && <p className="text-sm font-semibold text-muted">{others}</p>}
      <PrimaryButton onClick={onRematch} disabled={myRematch}>
        {myRematch ? waiting : othersRematch ? "Accept rematch" : "Rematch"}
      </PrimaryButton>
      <HomeButton onClick={onHome} />
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function HomeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl bg-surface-raised px-6 py-3 font-semibold transition hover:brightness-125"
    >
      Back to home
    </button>
  );
}

function FinalScore({
  name,
  score,
  total,
  colorVar,
  testId,
}: {
  name: string;
  score: number;
  total: number;
  colorVar: string;
  testId: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm text-muted">{name}</p>
        <p data-testid={testId} className="text-2xl font-bold tabular-nums" style={{ color: colorVar }}>
          {score}
        </p>
      </div>
      <div className="mt-1">
        <ProgressBar value={score} max={total} colorVar={colorVar} heightClass="h-2.5" label={`${name} final score`} />
      </div>
    </div>
  );
}
