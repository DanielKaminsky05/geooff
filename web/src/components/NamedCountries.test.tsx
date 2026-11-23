import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import NamedCountries from "./NamedCountries";
import { CONTINENTS } from "../lib/continents";
import { REGION_IDS, REGION_ISO } from "../lib/geo";

describe("NamedCountries", () => {
  it("lists named countries under their continent with counts", () => {
    render(<NamedCountries filled={new Set(["fr", "de", "jp"])} />);

    const europe = screen.getByTestId("continent-Europe");
    expect(within(europe).getByText("France")).toBeInTheDocument();
    expect(within(europe).getByText("Germany")).toBeInTheDocument();
    expect(within(europe).getByText("2 / 46")).toBeInTheDocument();
    expect(within(screen.getByTestId("continent-Asia")).getByText("Japan")).toBeInTheDocument();
  });

  it("fills named countries from the top, alphabetically, then blank slots", () => {
    render(<NamedCountries filled={new Set(["de", "fr", "al"])} />);
    const rows = within(screen.getByTestId("continent-Europe")).getAllByRole("listitem", { hidden: true });
    expect(rows.slice(0, 3).map((r) => r.textContent)).toEqual(["Albania", "France", "Germany"]);
    expect(rows).toHaveLength(CONTINENTS.Europe.length);
  });

  it("shows one blank row per country slot when nothing is named", () => {
    render(<NamedCountries filled={new Set()} />);
    expect(screen.getAllByTestId("blank-row")).toHaveLength(197);
  });

  it("groups a region set by sub-region, each named-first then blanks", () => {
    render(<NamedCountries filled={new Set(["de", "fr", "al"])} categoryId="europe" />);
    // Germany → Central, France → Western, Albania → Southern. Each lands in
    // its own colored sub-region section (not one flat list).
    const central = screen.getByTestId("sub-region-Central");
    expect(within(central).getByText("Germany")).toBeInTheDocument();
    expect(within(screen.getByTestId("sub-region-Western")).getByText("France")).toBeInTheDocument();
    expect(within(screen.getByTestId("sub-region-Southern")).getByText("Albania")).toBeInTheDocument();
    // Named items fill from the top alphabetically, the rest stay blank.
    const rows = within(central).getAllByRole("listitem", { hidden: true });
    expect(rows[0].textContent).toBe("Germany");
    // Every region id is bucketed: summed group totals equal the region size.
    const totals = screen
      .getAllByText(/^\d+ \/ \d+$/)
      .map((el) => Number(el.textContent!.split("/")[1].trim()));
    expect(totals.reduce((a, b) => a + b, 0)).toBe(REGION_ISO.europe.length);
    expect(screen.getByRole("region", { name: "Your countries" })).toBeInTheDocument();
  });

  for (const id of REGION_IDS) {
    it(`${id}: playable totals equal the shared region list`, () => {
      const { unmount } = render(<NamedCountries filled={new Set()} categoryId={id} />);
      const totals = screen
        .getAllByText(/^\d+ \/ \d+$/)
        .map((el) => Number(el.textContent!.split("/")[1].trim()));
      expect(totals.reduce((a, b) => a + b, 0)).toBe(REGION_ISO[id].length);
      expect(screen.getAllByTestId("blank-row")).toHaveLength(REGION_ISO[id].length);
      unmount();
    });
  }

  it("africa's Northern group can complete (Western Sahara isn't counted)", () => {
    const northern = ["dz", "eg", "ly", "ma", "sd", "tn"];
    render(<NamedCountries filled={new Set(northern)} categoryId="africa" />);
    const section = screen.getByTestId("sub-region-Northern");
    expect(within(section).getByText(`${northern.length} / ${northern.length}`)).toBeInTheDocument();
    expect(within(section).queryByTestId("blank-row")).toBeNull();
  });

  it("region lists use the same display names as the world list", () => {
    render(<NamedCountries filled={new Set(["cz", "mk"])} categoryId="europe" />);
    expect(screen.getByText("Czechia")).toBeInTheDocument();
    expect(screen.getByText("North Macedonia")).toBeInTheDocument();
    expect(screen.queryByText("Czech Republic")).toBeNull();
  });

  it("versus columns render separately for players sharing a name", () => {
    render(
      <NamedCountries
        filled={new Set()}
        versus={[
          { id: "a", name: "Sam", color: "#111", ids: ["fr"] },
          { id: "b", name: "Sam", color: "#222", ids: ["de", "jp"] },
        ]}
      />,
    );
    const cols = screen.getAllByTestId("named-Sam");
    expect(cols).toHaveLength(2);
    expect(within(cols[0]).getByText("France")).toBeInTheDocument();
    expect(within(cols[1]).getByText("Germany")).toBeInTheDocument();
  });

  it("flat mode lists named items in naming order with no grouping or blanks", () => {
    render(<NamedCountries filled={new Set(["jp", "fr", "de"])} flat />);
    // One plain list, items in insertion (naming) order — not alphabetised or
    // grouped by continent, and no blank slots.
    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Japan", "France", "Germany"]);
    expect(screen.queryByTestId("blank-row")).toBeNull();
    expect(screen.queryByTestId("continent-Europe")).toBeNull();
  });
});
