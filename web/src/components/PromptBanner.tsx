export interface PromptBannerProps {
  /** The current prompt's human-readable label (e.g. "Countries above 5000 ft"). */
  label: string;
}

/**
 * Gauntlet: a prominent, central banner showing the active prompt that answers
 * must satisfy. No counts/hints — just the constraint players are naming under.
 */
export function PromptBanner({ label }: PromptBannerProps) {
  return (
    <div
      data-testid="prompt-banner"
      role="status"
      className="border-b border-border bg-surface-raised px-4 py-3 text-center"
    >
      <p className="text-xs uppercase tracking-wide text-muted">Prompt</p>
      <p className="mt-0.5 text-lg font-bold text-foreground sm:text-xl">{label}</p>
    </div>
  );
}

export default PromptBanner;
