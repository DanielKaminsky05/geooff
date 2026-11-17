import { memo, useMemo } from "react";
import { groupByContinent, type Continent, type ContinentGroup } from "../lib/continents";
import ProgressBar from "./ProgressBar";

export interface NamedCountriesProps {
  /** ISO codes the player has named. */
  filled: Set<string>;
  /** The player's fill color (e.g. "var(--color-player1)"). */
  colorVar: string;
}

/** Header color per continent (muted to sit on the dark theme). */
const CONTINENT_COLORS: Record<Continent, string> = {
  Europe: "#3355cc",
  Asia: "#b83a3a",
  Africa: "#8a3fa6",
  "North America": "#c98516",
  "South America": "#2f8a3e",
  Oceania: "#2f7fc1",
};

/** Column layout, classic quiz style: Oceania stacks under South America. */
const COLUMNS: Continent[][] = [
  ["Europe"],
  ["Asia"],
  ["Africa"],
  ["North America"],
  ["South America", "Oceania"],
];

/**
 * The player's correct guesses as ruled lists, one per continent: a colored
 * header, then one row per country slot — named countries fill from the top
 * (alphabetical), the rest stay blank to show what's left.
 */
function NamedCountriesInner({ filled, colorVar }: NamedCountriesProps) {
  const groups = useMemo(() => groupByContinent(filled), [filled]);
  const byContinent = useMemo(
    () => new Map(groups.map((g) => [g.continent, g])),
    [groups],
  );
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

      <div className="mt-6 grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((column) => (
          <div key={column.join("+")} className="flex flex-col gap-3">
            {column.map((continent) => (
              <ContinentList key={continent} group={byContinent.get(continent)!} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ContinentList({ group }: { group: ContinentGroup }) {
  const { continent, names, total } = group;
  const blanks = total - names.length;
  return (
    <div data-testid={`continent-${continent}`}>
      <h3
        className="flex items-baseline justify-between gap-2 px-3 py-1.5 text-sm font-semibold text-white"
        style={{ background: CONTINENT_COLORS[continent] }}
      >
        <span>{continent}</span>
        <span className="tabular-nums opacity-90">
          {names.length} / {total}
        </span>
      </h3>
      <ol className="border-x border-border">
        {names.map((name) => (
          <li key={name} className="truncate border-b border-border px-3 py-1 text-sm">
            {name}
          </li>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <li
            key={`blank-${i}`}
            aria-hidden="true"
            data-testid="blank-row"
            className="border-b border-border px-3 py-1 text-sm"
          >
            &nbsp;
          </li>
        ))}
      </ol>
    </div>
  );
}

export const NamedCountries = memo(NamedCountriesInner);
export default NamedCountries;
