import { memo, useMemo } from "react";
import { groupByContinent } from "../lib/continents";
import ProgressBar from "./ProgressBar";

export interface NamedCountriesProps {
  /** ISO codes the player has named. */
  filled: Set<string>;
  /** The player's fill color (e.g. "var(--color-player1)"). */
  colorVar: string;
}

/**
 * The player's correct guesses, grouped by continent with a per-continent
 * count. Lives below the game screen; reached by scrolling.
 */
function NamedCountriesInner({ filled, colorVar }: NamedCountriesProps) {
  const groups = useMemo(() => groupByContinent(filled), [filled]);
  const totalAll = groups.reduce((n, g) => n + g.total, 0);

  return (
    <section
      id="your-countries"
      aria-label="Your countries"
      className="mx-auto w-full max-w-6xl px-4 py-8"
    >
      <div className="flex items-center gap-4">
        <h2 className="shrink-0 text-xl font-bold">
          Your countries <span style={{ color: colorVar }}>{filled.size}</span>
          <span className="text-base font-semibold text-muted"> / {totalAll}</span>
        </h2>
        <ProgressBar
          value={filled.size}
          max={totalAll}
          colorVar={colorVar}
          heightClass="h-2.5"
          label="Total progress"
        />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ continent, names, total }) => (
          <div
            key={continent}
            data-testid={`continent-${continent}`}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{continent}</h3>
              <span className="text-sm tabular-nums text-muted">
                <span style={{ color: names.length > 0 ? colorVar : undefined }}>
                  {names.length}
                </span>{" "}
                / {total}
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar
                value={names.length}
                max={total}
                colorVar={colorVar}
                heightClass="h-1.5"
                label={`${continent} progress`}
              />
            </div>
            {names.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {names.map((name) => (
                  <li
                    key={name}
                    className="rounded-md bg-surface-raised px-2 py-0.5 text-sm"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export const NamedCountries = memo(NamedCountriesInner);
export default NamedCountries;
