import { useEffect, useState } from "react";
import type { PlayerPublic } from "../../lib/protocol";
import type { Flash, Toast } from "./useMatchFx";

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

/** Own connection lost: keep the user here while socket.io retries. */
export function ReconnectingOverlay() {
  return (
    <div role="alert" className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/90">
      <p className="text-2xl font-bold">Reconnecting…</p>
      <p className="text-sm text-muted">Hang tight — your seat is saved.</p>
    </div>
  );
}

/** Re-join failed for good (room gone / grace expired): offer a way out
 *  instead of a dead game that drops every input. */
export function FatalErrorOverlay({ message, onHome }: { message: string; onHome: () => void }) {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center"
    >
      <p className="text-2xl font-bold">Game unavailable</p>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      <button
        onClick={onHome}
        className="rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:brightness-110"
      >
        Back to home
      </button>
    </div>
  );
}
