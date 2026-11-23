import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NamedButton, NamedSheet } from "./NamedSheet";
import type { MatchModel } from "./matchModel";

// Only the fields NamedButton / NamedSheet read.
const model = {
  solo: true,
  gauntlet: false,
  players: [],
  state: { room: null, filled: {} },
  myFilled: new Set(["fr"]),
  categoryId: "countries",
  revealAllNamed: false,
  itemsNoun: "countries",
  namedCount: 1,
} as unknown as MatchModel;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <NamedButton model={model} onOpen={() => setOpen(true)} />
      <NamedSheet model={model} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("NamedSheet", () => {
  it("is inert and not a dialog while closed", () => {
    render(<Harness />);
    const sheet = screen.getByTestId("named-sheet");
    expect(sheet).toHaveAttribute("inert");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the open button has a text name without the decorative arrow", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Your countries (1)" })).toBeInTheDocument();
  });

  it("opens as a labelled modal dialog and focuses the close button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Your countries (1)" }));

    const dialog = screen.getByRole("dialog", { name: "Your countries" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("Escape closes it and restores focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Your countries (1)" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("named-sheet")).toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });

  it("the Close button also restores focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Your countries (1)" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(opener).toHaveFocus();
  });
});
