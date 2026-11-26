import CountryInput from "../../components/CountryInput";

/** The bottom input bar: guess field, floating reject message, solo Give up,
 *  multiplayer Leave. */
export default function AnswerBar({
  onSubmit,
  clearSignal,
  acceptSignal,
  rejectSignal,
  rejectMsg,
  disabled,
  autoFocus,
  onGiveUp,
  onLeave,
}: {
  /** Return `false` when the guess was not sent (the field keeps its text). */
  onSubmit: (text: string) => boolean | void;
  /** Hard reset of the field (new game / round). */
  clearSignal: number;
  /** One bump per accepted answer (never clears what's being typed). */
  acceptSignal?: number;
  rejectSignal: number;
  rejectMsg: string | null;
  disabled: boolean;
  /** Focus the field on mount (desktop only). */
  autoFocus?: boolean;
  /** When set, show a "Give up" button (solo, while playing). */
  onGiveUp?: () => void;
  /** When set, show a "Leave" button (multiplayer, while the match is live). */
  onLeave?: () => void;
}) {
  return (
    <section className="chrome-bar chrome-ink relative border-t border-[var(--color-chrome-gold)]/40 px-4 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
      {/* Floated above the bar (out of flow) so it never pushes the layout
          up/down when it appears on a rejected guess. */}
      {rejectMsg && (
        <p className="pointer-events-none absolute inset-x-0 bottom-full mb-1 text-center text-sm text-accent">
          {rejectMsg}
        </p>
      )}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <CountryInput
            onSubmit={onSubmit}
            clearSignal={clearSignal}
            acceptSignal={acceptSignal}
            rejectSignal={rejectSignal}
            disabled={disabled}
            autoFocus={autoFocus}
          />
        </div>
        {onGiveUp && (
          <button
            onClick={onGiveUp}
            className="shrink-0 rounded-xl bg-surface-raised px-5 py-4 font-semibold transition hover:brightness-125"
          >
            Give up
          </button>
        )}
        {onLeave && (
          <button
            onClick={onLeave}
            className="shrink-0 rounded-xl bg-surface-raised px-5 py-4 font-semibold transition hover:brightness-125"
          >
            Leave
          </button>
        )}
      </div>
    </section>
  );
}
