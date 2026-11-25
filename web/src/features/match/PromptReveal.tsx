import { useEffect, useMemo, useState } from "react";
import WorldMap from "../../components/WorldMap";
import { useServerCountdown } from "../../lib/serverClock";
import type { CategoryId } from "../../lib/protocol";

/** Highlight colour for the answers nobody named — red, on the board. */
const MISSED_COLOR = "#ef4444";
/** Stable empty set — the reveal map fills entirely via `colorByIso`. */
const NO_FILL = new Set<string>();

export interface RevealData {
  label: string;
  missed: { iso: string; name: string }[];
  swept: boolean;
}

export interface RevealControlsProps {
  /** epoch ms the pause auto-advances; drives the countdown. */
  endsAt: number | null;
  /** skip-vote progress ("N of M voted"), or null before anyone votes. */
  votes: { count: number; needed: number } | null;
  /** whether I've already voted to skip. */
  iSkipped: boolean;
  onSkip: () => void;
}

/**
 * Countdown + skip/continue button, shown at the foot of the reveal. The pause
 * auto-advances at `endsAt`, or sooner once every connected, in-game player has
 * voted to skip.
 */
export function RevealControls({ endsAt, votes, iSkipped, onSkip }: RevealControlsProps) {
  const remaining = useServerCountdown(endsAt, false);
  const secs = endsAt == null ? null : Math.max(0, Math.ceil(remaining / 1000));
  const label = iSkipped
    ? `Waiting…${votes ? ` ${votes.count}/${votes.needed}` : ""}`
    : votes && votes.count > 0
      ? `Skip · ${votes.count}/${votes.needed}`
      : "Skip";
  return (
    <div className="flex items-center justify-center gap-4">
      {secs != null && (
        <span data-testid="reveal-countdown" className="text-sm tabular-nums text-muted">
          Next in {secs}s
        </span>
      )}
      <button
        type="button"
        onClick={onSkip}
        disabled={iSkipped}
        data-testid="reveal-skip"
        className="rounded-lg bg-[#f4efe3] px-5 py-2 text-sm font-semibold text-[var(--color-chrome)] transition hover:brightness-105 disabled:opacity-60"
      >
        {label}
      </button>
    </div>
  );
}

/**
 * End-of-prompt reveal: a full-area takeover where the board itself lights up
 * RED with the countries nobody named, a list of them runs down the side, and a
 * countdown + skip/continue sits at the foot of the map. Any count reads clearly
 * (19 missed is 19 red countries + 19 names, never "+N more"). The game is held
 * on the server until the pause ends or everyone skips.
 */
/** A player you can click on the reveal to see what THEY named this round. */
export interface RevealPlayer {
  id: string;
  name: string;
  /** seat colour — their named countries light up in it. */
  color: string;
  /** trailing note, e.g. " · −1 ♥" / " · out". */
  detail: string;
  /** true when they lost a heart (danger styling). */
  danger: boolean;
  count: number;
  named: { iso: string; name: string }[];
}

/** The "missed" (red) layer, always the default selection. */
const MISSED_KEY = "missed";

export default function RevealScreen({
  title,
  subtitle,
  missed,
  categoryId,
  swept,
  controls,
  players,
}: {
  title: string;
  subtitle?: string;
  missed: { iso: string; name: string }[];
  categoryId: CategoryId;
  swept: boolean;
  controls: RevealControlsProps;
  /** showdown: clickable players — selecting one shows what they named. */
  players?: RevealPlayer[];
}) {
  // Mount the (heavy, ~250-path) map a tick AFTER the frame paints, so the
  // heading/list show instantly and the map fills in a beat behind them.
  const [showMap, setShowMap] = useState(false);
  useEffect(() => {
    setShowMap(true);
  }, []);
  // Which layer is shown: the missed answers (default) or a player's picks.
  const [selected, setSelected] = useState(MISSED_KEY);

  const selPlayer = selected !== MISSED_KEY ? players?.find((p) => p.id === selected) : undefined;
  const items = selPlayer ? selPlayer.named : missed;
  const color = selPlayer ? selPlayer.color : MISSED_COLOR;
  const highlight = useMemo(() => new Map(items.map((m) => [m.iso, color])), [items, color]);
  const empty = items.length === 0;
  const emptyMessage = selPlayer
    ? `${selPlayer.name} named nothing this round`
    : swept
      ? "Swept — every answer named!"
      : "Nothing left on the board";
  const lineLabel = selPlayer
    ? `${selPlayer.name} named · ${selPlayer.named.length}`
    : subtitle;

  return (
    <div
      data-testid="reveal-screen"
      aria-live="polite"
      className="fade-in chrome-ink absolute inset-0 z-20 flex flex-col bg-[var(--color-chrome)]/95 backdrop-blur"
    >
      <header className="chrome-bar chrome-ink shrink-0 border-b border-[var(--color-chrome-gold)]/40 px-4 py-3 text-center">
        <h3 className="text-lg font-bold">{title}</h3>
        {lineLabel && <p className="text-xs text-muted">{lineLabel}</p>}
        {players && players.length > 0 && (
          <div className="mx-auto mt-3 flex w-full max-w-sm flex-col gap-1.5">
            <SelectRow
              selected={selected === MISSED_KEY}
              onClick={() => setSelected(MISSED_KEY)}
              color={MISSED_COLOR}
              label="Left on the board"
              count={missed.length}
            />
            {players.map((p) => (
              <SelectRow
                key={p.id}
                testId={`round-row-${p.id}`}
                selected={selected === p.id}
                onClick={() => setSelected(p.id)}
                color={p.color}
                label={`${p.name}${p.detail}`}
                count={p.count}
                danger={p.danger}
              />
            ))}
            <p className="text-[11px] text-muted">Tap a player to see what they named.</p>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* The board itself, lit up in the selected layer's colour. */}
        <div className="relative min-h-0 flex-1">
          {empty ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold">
              {emptyMessage}
            </div>
          ) : (
            showMap && (
              <WorldMap
                filledIso={NO_FILL}
                color={color}
                colorByIso={highlight}
                categoryId={categoryId}
                revealNames
                interactive={false}
                testId="reveal-map"
              />
            )
          )}
        </div>

        {/* The list for the selected layer, down the side. */}
        <aside className="chrome-bar chrome-ink flex max-h-44 shrink-0 flex-col gap-2 overflow-y-auto border-t border-[var(--color-chrome-gold)]/40 p-3 text-left md:max-h-none md:w-56 md:border-l md:border-t-0">
          {!empty && (
            <ol data-testid="reveal-list" className="flex flex-col gap-0.5 text-sm">
              {items.map((m) => (
                <li key={m.iso} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="truncate">{m.name}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      <footer className="chrome-bar chrome-ink shrink-0 border-t border-[var(--color-chrome-gold)]/40 px-4 py-3">
        <RevealControls {...controls} />
      </footer>
    </div>
  );
}

/** A selectable reveal layer: the missed set, or a player's picks. */
function SelectRow({
  selected,
  onClick,
  color,
  label,
  count,
  danger,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  color: string;
  label: string;
  count: number;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={selected}
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
        selected
          ? "border-foreground bg-surface-raised"
          : danger
            ? "border-accent/50 bg-accent/10 hover:brightness-110"
            : "border-border bg-surface-raised hover:brightness-110"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate font-semibold">{label}</span>
      </span>
      <span className="shrink-0 tabular-nums">{count}</span>
    </button>
  );
}
