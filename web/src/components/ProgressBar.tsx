export interface ProgressBarProps {
  value: number;
  max: number;
  /** Fill color (e.g. "var(--color-player1)"). */
  colorVar: string;
  /** "right" fills from the right edge (mirrors the opponent's bar). */
  from?: "left" | "right";
  /** Track height class. */
  heightClass?: string;
  label?: string;
}

/** Thin rounded progress bar; the fill animates as the value grows. */
export function ProgressBar({
  value,
  max,
  colorVar,
  from = "left",
  heightClass = "h-2",
  label,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`relative w-full overflow-hidden rounded-full bg-land ${heightClass}`}
    >
      <div
        data-testid="progress-fill"
        className={`absolute inset-y-0 rounded-full transition-[width] duration-300 ease-out ${
          from === "right" ? "right-0" : "left-0"
        }`}
        style={{ width: `${pct}%`, background: colorVar }}
      />
    </div>
  );
}

export default ProgressBar;
