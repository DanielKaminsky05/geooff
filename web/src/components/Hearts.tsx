import type { CSSProperties } from "react";

export interface HeartsProps {
  /** Remaining lives (rendered as filled hearts). */
  lives: number;
  /** Total lives (rendered as empty hearts beyond `lives`). */
  max: number;
  colorVar?: string;
  /** Accessible label prefix, e.g. a player name. */
  label?: string;
  /** Bigger hearts for the prominent score-bar placement. */
  size?: "sm" | "lg";
}

/**
 * Remaining-lives indicator for last_standing: `lives` filled hearts out of
 * `max`, the rest hollow. As lives run out the filled hearts shake harder and
 * mix toward the alert red — no shake at full health, peaking on the last
 * heart (see .heart-shake). Presentational.
 */
export function Hearts({ lives, max, colorVar = "var(--color-accent)", label, size = "sm" }: HeartsProps) {
  const clamped = Math.max(0, Math.min(max, lives));

  // Danger ramps 0 → 1 as lives fall from `max` to 1 (0 at full health).
  const t = max > 1 ? Math.min(1, Math.max(0, (max - clamped) / (max - 1))) : clamped <= 1 ? 1 : 0;
  const shaking = clamped > 0 && t > 0;

  const fillColor =
    t > 0
      ? `color-mix(in srgb, var(--color-accent) ${Math.round(t * 100)}%, ${colorVar})`
      : colorVar;

  // Faster + wider shake as danger rises.
  const shakeVars: CSSProperties = shaking
    ? ({
        "--amp": `${(0.8 + t * 2.6).toFixed(2)}px`,
        "--rot": `${(t * 9).toFixed(1)}deg`,
        "--dur": `${(1.5 - t * 1.1).toFixed(2)}s`,
      } as CSSProperties)
    : {};

  return (
    <span
      data-testid="hearts"
      data-lives={clamped}
      role="img"
      aria-label={`${label ? `${label}: ` : ""}${clamped} of ${max} lives`}
      className={`inline-flex items-center leading-none ${size === "lg" ? "gap-1 text-xl" : "gap-0.5 text-sm"}`}
    >
      {Array.from({ length: max }, (_, i) => {
        const filled = i < clamped;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={filled && shaking ? "heart-shake" : ""}
            style={{
              color: filled ? fillColor : "var(--color-muted)",
              ...(filled && shaking ? { ...shakeVars, animationDelay: `${i * 0.09}s` } : {}),
            }}
          >
            {filled ? "♥" : "♡"}
          </span>
        );
      })}
    </span>
  );
}

export default Hearts;
