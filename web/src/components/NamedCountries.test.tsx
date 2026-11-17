import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import NamedCountries from "./NamedCountries";

describe("NamedCountries", () => {
  it("lists named countries under their continent with counts", () => {
    render(<NamedCountries filled={new Set(["fr", "de", "jp"])} colorVar="var(--color-player1)" />);

    const europe = screen.getByTestId("continent-Europe");
    expect(within(europe).getByText("France")).toBeInTheDocument();
    expect(within(europe).getByText("Germany")).toBeInTheDocument();
    expect(within(screen.getByTestId("continent-Asia")).getByText("Japan")).toBeInTheDocument();
    expect(within(europe).getByText(/\/ 46/)).toBeInTheDocument();
  });

  it("shows an empty state for continents with nothing named", () => {
    render(<NamedCountries filled={new Set()} colorVar="var(--color-player1)" />);
    expect(screen.getAllByText("None yet")).toHaveLength(6);
  });
});
