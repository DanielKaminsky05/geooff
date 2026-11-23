import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FatalErrorOverlay, ReconnectingOverlay } from "./MatchOverlays";
import GameOverOverlay from "./GameOverOverlay";
import type { PlayerPublic } from "../../lib/protocol";

const me = { id: "a", name: "Alice", slot: "p1", ready: true, connected: true } as unknown as PlayerPublic;
const bob = { id: "b", name: "Bob", slot: "p2", ready: true, connected: true } as unknown as PlayerPublic;

function gameOver(overrides: Partial<Parameters<typeof GameOverOverlay>[0]> = {}) {
  return (
    <GameOverOverlay
      gameOver={{ winnerId: "a", scores: { a: 3, b: 1 } }}
      solo={false}
      players={[me, bob]}
      total={10}
      me={me}
      onRematch={vi.fn()}
      myRematch={false}
      othersRematch={false}
      onHome={vi.fn()}
      {...overrides}
    />
  );
}

describe("match overlays", () => {
  it("game over is a dialog titled by the result, focusing the primary action", () => {
    render(gameOver());
    const dialog = screen.getByRole("dialog", { name: "You win!" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Rematch" })).toHaveFocus();
  });

  it("game over falls back to Back to home when the primary action is disabled", () => {
    render(gameOver({ myRematch: true }));
    expect(screen.getByRole("button", { name: "Back to home" })).toHaveFocus();
  });

  it("solo game over focuses Play again", () => {
    render(gameOver({ solo: true, players: [me] }));
    expect(screen.getByRole("button", { name: "Play again" })).toHaveFocus();
  });

  it("fatal error is an alert dialog that focuses Back to home", () => {
    render(<FatalErrorOverlay message="Room is gone" onHome={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog", { name: "Game unavailable" });
    expect(dialog).toHaveAccessibleDescription("Room is gone");
    expect(screen.getByRole("button", { name: "Back to home" })).toHaveFocus();
  });

  it("reconnecting is a modal alert dialog that restores focus when it goes away", () => {
    const { rerender } = render(
      <>
        <input aria-label="guess" />
      </>,
    );
    const input = screen.getByLabelText("guess");
    input.focus();
    rerender(
      <>
        <input aria-label="guess" />
        <ReconnectingOverlay />
      </>,
    );
    expect(screen.getByRole("alertdialog", { name: "Reconnecting…" })).toHaveFocus();
    rerender(
      <>
        <input aria-label="guess" />
      </>,
    );
    expect(input).toHaveFocus();
  });
});
