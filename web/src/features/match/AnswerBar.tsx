import CountryInput from "../../components/CountryInput";

/** The bottom input bar: guess field, floating reject message, solo Give up. */
export default function AnswerBar({
  onSubmit,
  clearSignal,
  rejectSignal,
  rejectMsg,
  disabled,
  onGiveUp,
}: {
  onSubmit: (text: string) => void;
  clearSignal: number;
  rejectSignal: number;
  rejectMsg: string | null;
  disabled: boolean;
  /** When set, show a "Give up" button (solo, while playing). */
  onGiveUp?: () => void;
}) {
  return (
    <section className="relative border-t border-border bg-surface px-4 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
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
            rejectSignal={rejectSignal}
            disabled={disabled}
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
      </div>
    </section>
  );
}
