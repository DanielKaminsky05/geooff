import { useMemo } from "react";
import NamedCountries from "../../components/NamedCountries";
import { slotColor } from "../../lib/colors";
import type { MatchModel } from "./matchModel";

/** On-map button that opens the named-list sheet, with the running count. */
export function NamedButton({ model, onOpen }: { model: MatchModel; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="absolute bottom-3 right-3 z-10 rounded-lg bg-surface-raised px-3 py-2 text-sm font-semibold shadow transition hover:brightness-125"
    >
      {model.solo ? "Your" : "Named"} {model.itemsNoun} ({model.namedCount}) ↑
    </button>
  );
}

/**
 * The named list as a slide-up sheet (always mounted, translated off-screen
 * when closed) rather than content below the fold, so the match stays a single
 * non-scrolling viewport. Solo gauntlet uses a flat per-prompt list; a revealed
 * versus view shows per-player ordered columns; otherwise my list, grouped.
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

  return (
    <div
      className={`fixed inset-0 z-30 flex flex-col bg-background transition-transform duration-300 ${
        open ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <div className="flex justify-end border-b border-border px-4 py-2">
        <button
          onClick={onClose}
          className="rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold transition hover:brightness-125"
        >
          Close ✕
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
