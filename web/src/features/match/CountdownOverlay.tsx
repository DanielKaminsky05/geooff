import type { Countdown } from "./matchState";

/**
 * 3-2-1 overlay before play ("Get ready" until the first tick is seen).
 * The big digits are visual only; screen readers get a single polite status
 * message for the whole countdown instead of an interrupting announcement on
 * every tick.
 */
export default function CountdownOverlay({ countdown }: { countdown: NonNullable<Countdown> }) {
  return (
    <div
      data-testid="countdown-overlay"
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/80"
    >
      <p role="status" aria-live="polite" className="sr-only">
        Get ready, the game is about to start.
      </p>
      <div aria-hidden="true">
        {countdown === "ready" ? (
          <p className="text-5xl font-bold">Get ready</p>
        ) : (
          <p key={countdown} className="countdown-pop text-9xl font-bold tabular-nums">
            {countdown}
          </p>
        )}
      </div>
    </div>
  );
}
