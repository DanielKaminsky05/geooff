export interface HeartsProps {
  /** Remaining lives (rendered as filled hearts). */
  lives: number;
  /** Total lives (rendered as empty hearts beyond `lives`). */
  max: number;
  colorVar?: string;
  /** Accessible label prefix, e.g. a player name. */
  label?: string;
}

/**
 * Remaining-lives indicator for last_standing: `lives` filled hearts out of
 * `max`, the rest hollow. Purely presentational.
 */
export function Hearts({ lives, max, colorVar = "var(--color-accent)", label }: HeartsProps) {
  const clamped = Math.max(0, Math.min(max, lives));
  return (
    <span
      data-testid="hearts"
      data-lives={clamped}
      role="img"
      aria-label={`${label ? `${label}: ` : ""}${clamped} of ${max} lives`}
      className="inline-flex items-center gap-0.5 text-sm leading-none"
    >
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ color: i < clamped ? colorVar : "var(--color-muted)" }}
        >
          {i < clamped ? "♥" : "♡"}
        </span>
      ))}
    </span>
  );
}

export default Hearts;
