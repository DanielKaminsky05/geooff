import { useMemo, useRef } from "react";
import NamedCountries from "../../components/NamedCountries";
import { slotColor } from "../../lib/colors";
import type { MatchModel } from "./matchModel";
import { useDialogFocus } from "./useDialogFocus";

/** On-map button that opens the named-list sheet, with the running count. */
export function NamedButton({ model, onOpen }: { model: MatchModel; onOpen: () => void }) {
  const label = `${model.solo ? "Your" : "Named"} ${model.itemsNoun}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="absolute bottom-3 right-3 z-10 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow transition hover:brightness-125"
    >
      {label} ({model.namedCount}) <span aria-hidden="true">↑</span>
    </button>
  );
}

/**
 * The named list as a slide-up sheet (always mounted, translated off-screen
 * when closed) rather than content below the fold, so the match stays a single
 * non-scrolling viewport. Solo gauntlet uses a flat per-prompt list; a revealed
 * versus view shows per-player ordered columns; otherwise my list, grouped.
 * Closed, it's `inert` (unfocusable, hidden from assistive tech); open, it's a
 * modal dialog that takes focus, closes on Escape, and returns focus on close.
 */
export function NamedSheet({
  model,
  open,
  onClose,
}: {
  model: MatchModel;
  open: boolean;
  onClose: () => void;
}) {
  const { solo, players, state } = model;
  const { room, filled } = state;

  // One column per player in slot order, items in naming order, seat-coloured.
  const namedPlayers = useMemo(() => {
    if (solo || !room) return undefined;
    return players.map((pl) => ({
      id: pl.id,
      name: pl.name,
      color: slotColor(pl.slot),
      ids: [...(filled[pl.id] ?? [])],
    }));
  }, [solo, room, players, filled]);

  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(open, closeRef, onClose);

  return (
    <div
      data-testid="named-sheet"
      inert={!open}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
      aria-label={open ? `${solo ? "Your" : "Named"} ${model.itemsNoun}` : undefined}
      className={`fixed inset-0 z-30 flex flex-col bg-background transition-transform duration-300 ${
        open ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <div className="flex justify-end border-b border-border px-4 py-2">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold transition hover:brightness-125"
        >
          Close <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NamedCountries
          filled={model.myFilled}
          categoryId={model.categoryId}
          // A live RACE hides opponents' lists (revealed at game over); the
          // shared-pool modes stay revealed. Without `versus`, NamedCountries
          // falls back to the grouped view of my own `filled`.
          versus={model.revealAllNamed ? namedPlayers : undefined}
          flat={solo && model.gauntlet}
        />
      </div>
    </div>
  );
}
