import { useEffect, useId, useRef, useState } from "react";
import type { PlayerPublic } from "../../lib/protocol";
import type { Flash, Toast } from "./useMatchFx";
import { useDialogFocus } from "./useDialogFocus";

/** Life-loss FX: a vignette flash (red mine / green theirs) or, on my final
 *  life, a heart cracking apart before the lose screen. */
export function LifeLossFx({ flash, breaking }: { flash: Flash | null; breaking: boolean }) {
  return (
    <>
      {flash && (
        <div key={flash.key} aria-hidden className={flash.kind === "damage" ? "damage-flash" : "gain-flash"} />
      )}
      {breaking && (
        <div className="heartbreak" aria-hidden>
          <span className="heartbreak-half heartbreak-left">♥</span>
          <span className="heartbreak-half heartbreak-right">♥</span>
        </div>
      )}
    </>
  );
}

/** Brief unobtrusive toast centered above the input; never blocks typing. */
export function MatchToast({ toast }: { toast: Toast }) {
  return (
    <div
      key={toast.key}
      role="status"
      className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-semibold shadow"
    >
      {toast.text}
    </div>
  );
}

/** Each disconnected opponent with a live grace countdown. */
export function OpponentDisconnectedBanner({
  players,
  label,
}: {
  /** Each disconnected opponent with their grace deadline (null = unknown). */
  players: Array<{ player: PlayerPublic; endsAt: number | null }>;
  label: (p: PlayerPublic) => string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      role="status"
      className="absolute left-1/2 top-14 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap rounded-lg border border-accent bg-surface px-4 py-2 text-sm font-semibold text-accent shadow"
    >
      {players.map(({ player, endsAt }) => (
        <span key={player.id}>
          {label(player)} disconnected — waiting
          {endsAt != null ? ` ${Math.max(0, Math.ceil((endsAt - now) / 1000))}s` : "…"}
        </span>
      ))}
    </div>
  );
}

/** Own connection lost: keep the user here while socket.io retries. A modal
 *  alert dialog (focus parked on it, returned when the connection is back). */
export function ReconnectingOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(true, ref);
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      tabIndex={-1}
      className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/90 outline-none"
    >
      <p id={`${id}-title`} className="text-2xl font-bold">
        Reconnecting…
      </p>
      <p id={`${id}-desc`} className="text-sm text-muted">
        Hang tight — your seat is saved.
      </p>
    </div>
  );
}

/** Re-join failed for good (room gone / grace expired): offer a way out
 *  instead of a dead game that drops every input. */
export function FatalErrorOverlay({ message, onHome }: { message: string; onHome: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDialogFocus(true, buttonRef);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center"
    >
      <h2 id={`${id}-title`} className="text-2xl font-bold">
        Game unavailable
      </h2>
      <p id={`${id}-desc`} className="max-w-sm text-sm text-muted">
        {message}
      </p>
      <button
        ref={buttonRef}
        type="button"
        onClick={onHome}
        className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110"
      >
        Back to home
      </button>
    </div>
  );
}
