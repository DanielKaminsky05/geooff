export interface GlitchWordmarkProps {
  /** Sizing / layout utility classes (the font size drives the glitch offset). */
  className?: string;
}

/**
 * The geofight wordmark: "GEOFIGHT" in the pixel display font with the
 * emerald (P1) / amber (P2) chromatic-glitch treatment (see `.wordmark-glitch`
 * in index.css). Size it via `className` — the glitch offset scales with the
 * font size, so it works from hero-size down to a header badge. Exposed as a
 * single image named "GeoFight" (aria-label on a plain span is ignored).
 */
export default function GlitchWordmark({ className = "" }: GlitchWordmarkProps) {
  return (
    <span
      data-text="GEOFIGHT"
      role="img"
      aria-label="GeoFight"
      className={`wordmark-glitch ${className}`}
    >
      GEOFIGHT
    </span>
  );
}
