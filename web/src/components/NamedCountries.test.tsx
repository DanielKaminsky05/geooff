import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import NamedCountries from "./NamedCountries";
import { CONTINENTS } from "../lib/continents";

describe("NamedCountries", () => {
  it("lists named countries under their continent with counts", () => {
    render(<NamedCountries filled={new Set(["fr", "de", "jp"])} colorVar="var(--color-player1)" />);

    const europe = screen.getByTestId("continent-Europe");
    expect(within(europe).getByText("France")).toBeInTheDocument();
    expect(within(europe).getByText("Germany")).toBeInTheDocument();
    expect(within(europe).getByText("2 / 46")).toBeInTheDocument();
    expect(within(screen.getByTestId("continent-Asia")).getByText("Japan")).toBeInTheDocument();
  });

  it("fills named countries from the top, alphabetically, then blank slots", () => {
    render(<NamedCountries filled={new Set(["de", "fr", "al"])} colorVar="var(--color-player1)" />);
    const rows = within(screen.getByTestId("continent-Europe")).getAllByRole("listitem", { hidden: true });
    expect(rows.slice(0, 3).map((r) => r.textContent)).toEqual(["Albania", "France", "Germany"]);
    expect(rows).toHaveLength(CONTINENTS.Europe.length);
  });

  it("shows one blank row per country slot when nothing is named", () => {
    render(<NamedCountries filled={new Set()} colorVar="var(--color-player1)" />);
    expect(screen.getAllByTestId("blank-row")).toHaveLength(197);
  });
});
