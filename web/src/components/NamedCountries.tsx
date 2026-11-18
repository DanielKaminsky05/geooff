import { memo, useMemo } from "react";
import { groupByContinent, countryName, type Continent } from "../lib/continents";
import { groupByRegion, stateName, type UsRegion } from "../lib/usStates";
import { mapFor } from "../lib/maps";
import type { CategoryId } from "../lib/protocol";

/** A region set is any mapped category that isn't countries or us-states. */
function isRegion(categoryId: CategoryId): boolean {
  return categoryId !== "countries" && categoryId !== "us-states";
}

/** Display names for a region's items, keyed by id (from its map locations). */
function regionNames(categoryId: CategoryId): Map<string, string> {
  return new Map(mapFor(categoryId).locations.map((l) => [l.id, l.name]));
}

/** One player's named items, in the order they named them. */
export interface NamedPlayer {
  name: string;
  color: string;
  ids: string[];
}

export interface NamedCountriesProps {
  /** Item ids the player has named (iso codes, or state ids for us-states). */
  filled: Set<string>;
  /** Which set is being played — picks the grouping + labels. */
  categoryId?: CategoryId;
  /**
   * Versus: show each player's items in naming order (no grouping), one column
   * per player. When set, this replaces the grouped solo view.
   */
  versus?: NamedPlayer[];
  /**
   * Flat: a single plain list of the named items in naming order, no grouping
   * or blanks. Used by solo gauntlet, where the set resets each prompt so
   * geographic grouping is meaningless.
   */
  flat?: boolean;
}

function itemName(categoryId: CategoryId, id: string): string {
  if (categoryId === "us-states") return stateName(id);
  // Regions and countries alike are countries — use the shared country names.
  return countryName(id);
}

/** A ruled list: a colored header + one row per item slot. */
interface Section {
  /** Stable key + test id suffix. */
  key: string;
  testId: string;
  label: string;
  color: string;
  names: string[];
  total: number;
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
const CONTINENT_COLUMNS: Continent[][] = [
  ["Europe"],
  ["Asia"],
  ["Africa"],
  ["North America"],
  ["South America", "Oceania"],
];

const REGION_COLORS: Record<UsRegion, string> = {
  Northeast: "#3355cc",
  Midwest: "#c98516",
  South: "#b83a3a",
  West: "#2f8a3e",
};

const REGION_COLUMNS: UsRegion[][] = [["Northeast"], ["Midwest"], ["South"], ["West"]];

/** Build the heading + column sections for the active set. */
function build(categoryId: CategoryId, filled: Set<string>): { heading: string; columns: Section[][] } {
  if (isRegion(categoryId)) {
    // Region sets: one simple alphabetical list (named first, then blanks).
    const names = regionNames(categoryId);
    const all = [...names.values()].sort((a, b) => a.localeCompare(b));
    const have = [...names.entries()]
      .filter(([id]) => filled.has(id))
      .map(([, name]) => name)
      .sort((a, b) => a.localeCompare(b));
    const section: Section = {
      key: categoryId,
      testId: `region-list-${categoryId}`,
      label: "Countries",
      color: "#3355cc",
      names: have,
      total: all.length,
    };
    return { heading: "Your countries", columns: [[section]] };
  }

  if (categoryId === "us-states") {
    const byRegion = new Map(groupByRegion(filled).map((g) => [g.region, g]));
    const columns = REGION_COLUMNS.map((col) =>
      col.map((region) => {
        const g = byRegion.get(region)!;
        return {
          key: region,
          testId: `region-${region}`,
          label: region,
          color: REGION_COLORS[region],
          names: g.names,
          total: g.total,
        };
      }),
    );
    return { heading: "Your states", columns };
  }

  const byContinent = new Map(groupByContinent(filled).map((g) => [g.continent, g]));
  const columns = CONTINENT_COLUMNS.map((col) =>
    col.map((continent) => {
      const g = byContinent.get(continent)!;
      return {
        key: continent,
        testId: `continent-${continent}`,
        label: continent,
        color: CONTINENT_COLORS[continent],
        names: g.names,
        total: g.total,
      };
    }),
  );
  return { heading: "Your countries", columns };
}

/**
 * The player's correct guesses as ruled lists, one per group (continents for
 * countries, Census regions for US states): a colored header, then one row per
 * item slot — named items fill from the top (alphabetical), the rest stay blank
 * to show what's left.
 */
function NamedCountriesInner({ filled, categoryId = "countries", versus, flat }: NamedCountriesProps) {
  const { heading, columns } = useMemo(() => build(categoryId, filled), [categoryId, filled]);

  // Flat: just the named items for the current prompt, in naming order.
  if (flat) {
    const noun = categoryId === "us-states" ? "states" : "countries";
    const ids = [...filled];
    return (
      <section
        id="your-countries"
        aria-label={`Named ${noun}`}
        className="mx-auto w-full max-w-md px-4 py-8"
      >
        <h2 className="flex items-baseline justify-between gap-2 text-xl font-bold">
          <span>Named {noun}</span>
          <span className="text-base tabular-nums text-muted">{ids.length}</span>
        </h2>
        <ol className="mt-4 border-x border-t border-border">
          {ids.map((id) => (
            <li key={id} className="truncate border-b border-border px-3 py-1 text-sm">
              {itemName(categoryId, id)}
            </li>
          ))}
          {ids.length === 0 && (
            <li className="border-b border-border px-3 py-1 text-sm text-muted">Nothing yet</li>
          )}
        </ol>
      </section>
    );
  }

  // Versus: per-player columns, items in naming order, no geographic grouping.
  if (versus) {
    const noun = categoryId === "us-states" ? "states" : "countries";
    return (
      <section
        id="your-countries"
        aria-label={`Named ${noun}`}
        className="mx-auto w-full max-w-4xl px-4 py-8"
      >
        <h2 className="text-xl font-bold">Named {noun}</h2>
        <div className="mt-6 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          {versus.map((p) => (
            <div key={p.name} data-testid={`named-${p.name}`}>
              <h3
                className="flex items-baseline justify-between gap-2 px-3 py-1.5 text-sm font-semibold text-white"
                style={{ background: p.color }}
              >
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums opacity-90">{p.ids.length}</span>
              </h3>
              <ol className="border-x border-border">
                {p.ids.map((id) => (
                  <li key={id} className="truncate border-b border-border px-3 py-1 text-sm">
                    {itemName(categoryId, id)}
                  </li>
                ))}
                {p.ids.length === 0 && (
                  <li className="border-b border-border px-3 py-1 text-sm text-muted">Nothing yet</li>
                )}
              </ol>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      id="your-countries"
      aria-label={heading}
      className="mx-auto w-full max-w-6xl px-4 py-8"
    >
      <h2 className="text-xl font-bold">{heading}</h2>

      <div className="mt-6 grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {columns.map((column, i) => (
          <div key={i} className="flex flex-col gap-3">
            {column.map((section) => (
              <RuledList key={section.key} section={section} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function RuledList({ section }: { section: Section }) {
  const { label, color, names, total, testId } = section;
  const blanks = total - names.length;
  return (
    <div data-testid={testId}>
      <h3
        className="flex items-baseline justify-between gap-2 px-3 py-1.5 text-sm font-semibold text-white"
        style={{ background: color }}
      >
        <span>{label}</span>
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
