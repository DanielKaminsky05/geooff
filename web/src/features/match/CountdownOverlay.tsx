import type { Countdown } from "./matchState";

/** 3-2-1 overlay before play ("Get ready" until the first tick is seen). */
export default function CountdownOverlay({ countdown }: { countdown: NonNullable<Countdown> }) {
  return (
    <div
      data-testid="countdown-overlay"
      aria-live="assertive"
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/80"
    >
      {countdown === "ready" ? (
        <p className="text-5xl font-bold">Get ready</p>
      ) : (
        <p key={countdown} className="animate-[countdown-pop_0.9s_ease-out] text-9xl font-bold tabular-nums">
          {countdown}
        </p>
      )}
    </div>
  );
}
