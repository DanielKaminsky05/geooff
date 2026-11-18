export interface PromptBannerProps {
  /** The current prompt's human-readable label (e.g. "Countries above 5000 ft"). */
  label: string;
  /** Drop the banner's own border/background (for use inside the floating HUD). */
  bare?: boolean;
}

/**
 * Gauntlet: a prominent, central banner showing the active prompt that answers
 * must satisfy. No counts/hints — just the constraint players are naming under.
 */
export function PromptBanner({ label, bare }: PromptBannerProps) {
  return (
    <div
      data-testid="prompt-banner"
      role="status"
      className={`px-4 py-3 text-center ${
        bare ? "" : "border-b border-border bg-surface-raised"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted">Prompt</p>
      <p className="mt-0.5 text-lg font-bold text-foreground sm:text-xl">{label}</p>
    </div>
  );
}

export default PromptBanner;
