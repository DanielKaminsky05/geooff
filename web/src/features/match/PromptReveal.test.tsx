import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import RevealScreen, { RevealControls } from "./PromptReveal";

const MISSED = [
  { iso: "bo", name: "Bolivia" },
  { iso: "td", name: "Chad" },
  { iso: "np", name: "Nepal" },
];
const noControls = { endsAt: null, votes: null, iSkipped: false, onSkip: () => {} };

describe("RevealScreen", () => {
  it("lists every missed answer and lights up the board (no truncation)", () => {
    render(
      <RevealScreen
        title="Left on the board"
        subtitle="Landlocked countries · 3"
        missed={MISSED}
        categoryId="countries"
        swept={false}
        controls={noControls}
      />,
    );
    const screen_ = screen.getByTestId("reveal-screen");
    expect(screen_).toHaveTextContent("Left on the board");
    const list = screen.getByTestId("reveal-list");
    for (const name of ["Bolivia", "Chad", "Nepal"]) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    expect(screen_).not.toHaveTextContent("more");
    // The board map is rendered so the missed countries can light up red.
    expect(within(screen_).getByTestId("reveal-map")).toBeInTheDocument();
  });

  it("shows a sweep message (and no map) when nothing was missed", () => {
    render(
      <RevealScreen title="Board swept!" missed={[]} categoryId="countries" swept controls={noControls} />,
    );
    expect(screen.getByText("Swept — every answer named!")).toBeInTheDocument();
    expect(screen.queryByTestId("reveal-map")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reveal-list")).not.toBeInTheDocument();
  });

  it("switches the list to a player's picks when their row is clicked", () => {
    const players = [
      {
        id: "b",
        name: "Bob",
        color: "var(--color-player2)",
        detail: " · −1 ♥",
        danger: true,
        count: 2,
        named: [
          { iso: "fr", name: "France" },
          { iso: "de", name: "Germany" },
        ],
      },
    ];
    render(
      <RevealScreen
        title="Round over"
        subtitle="Left on the board · 3"
        missed={MISSED}
        categoryId="countries"
        swept={false}
        controls={noControls}
        players={players}
      />,
    );
    // Default view: the missed answers.
    const list = screen.getByTestId("reveal-list");
    expect(within(list).getByText("Bolivia")).toBeInTheDocument();
    expect(within(list).queryByText("France")).not.toBeInTheDocument();

    // Click Bob's row → the list becomes what Bob named.
    fireEvent.click(screen.getByTestId("round-row-b"));
    const bobList = screen.getByTestId("reveal-list");
    expect(within(bobList).getByText("France")).toBeInTheDocument();
    expect(within(bobList).getByText("Germany")).toBeInTheDocument();
    expect(within(bobList).queryByText("Bolivia")).not.toBeInTheDocument();
    expect(screen.getByTestId("reveal-screen")).toHaveTextContent("Bob named · 2");
  });
});

describe("RevealControls", () => {
  it("votes to skip when the button is clicked", () => {
    const onSkip = vi.fn();
    render(<RevealControls endsAt={null} votes={null} iSkipped={false} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId("reveal-skip"));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("disables the button and shows progress once I've voted", () => {
    render(<RevealControls endsAt={null} votes={{ count: 1, needed: 2 }} iSkipped onSkip={() => {}} />);
    const btn = screen.getByTestId("reveal-skip");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("1/2");
  });
});
