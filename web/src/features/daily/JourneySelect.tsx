/**
 * Daily Dive — journey wager screen (Track C).
 *
 * Shows the day's destination, the 5 prompt labels (read-only preview — this is
 * the terrain the player reads BEFORE committing), and three journey cards
 * (Short / Medium / Long) each with its distance, total gold at stake, and
 * landmark count. Picking a card locks in the wager and starts the run.
 *
 * Risk/reward framing: a longer journey carries more gold across more landmarks
 * but demands more distance (points) to arrive — the choice is a read on your
 * own knowledge, made before you play.
 */

import type { DailySet, DailyJourney, JourneyId } from "./contract";

const JOURNEY_FEEL: Record<JourneyId, { title: string; blurb: string }> = {
  short: { title: "Short", blurb: "A sure thing — modest gold, easy to reach." },
  medium: { title: "Medium", blurb: "The default gamble — good gold, a real stretch." },
  long: { title: "Long", blurb: "For when you know your stuff — big haul, long road." },
};

/** Total gold a journey carries across all its landmarks. */
function totalGold(journey: DailyJourney): number {
  return journey.landmarks.reduce((sum, l) => sum + l.gold, 0);
}

function JourneyCard({
  journey,
  onSelect,
}: {
  journey: DailyJourney;
  onSelect: (id: JourneyId) => void;
}) {
  const feel = JOURNEY_FEEL[journey.id];
  return (
    <button
      type="button"
      onClick={() => onSelect(journey.id)}
      data-testid={`journey-card-${journey.id}`}
      className="flex flex-1 flex-col items-start gap-3 rounded-xl border border-[var(--color-chrome-gold)]/40 bg-surface-raised p-5 text-left transition hover:border-[var(--color-chrome-gold)] hover:brightness-105"
    >
      <span className="text-xl font-semibold">{feel.title}</span>
      <p className="text-sm text-muted">{feel.blurb}</p>
      <dl className="mt-auto grid w-full grid-cols-3 gap-2 pt-2 text-center">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Distance</dt>
          <dd className="text-lg font-semibold">{journey.distance}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Gold</dt>
          <dd className="text-lg font-semibold text-[var(--color-chrome-gold)]">
            {totalGold(journey)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Landmarks</dt>
          <dd className="text-lg font-semibold">{journey.landmarks.length}</dd>
        </div>
      </dl>
    </button>
  );
}

export interface JourneySelectProps {
  set: DailySet;
  /** Commit to a journey and start the run. */
  onSelect: (journeyId: JourneyId) => void;
  className?: string;
}

export default function JourneySelect({ set, onSelect, className }: JourneySelectProps) {
  return (
    <section
      className={`mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 ${className ?? ""}`}
      data-testid="journey-select"
    >
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Today&apos;s destination</p>
        <h1 className="text-3xl font-semibold">{set.destination.name}</h1>
      </header>

      {/* Read-only preview of the day's five prompts — the terrain you wager on. */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted">
          The {set.prompts.length} prompts
        </p>
        <ol className="flex flex-col gap-2">
          {set.prompts.map((p, i) => (
            <li key={p.id} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-right text-sm text-muted">{i + 1}.</span>
              <span className="text-base">{p.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <p className="mb-3 text-center text-sm text-muted">
          Choose your journey. The wager is made before you play.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {set.journeys.map((j) => (
            <JourneyCard key={j.id} journey={j} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </section>
  );
}
