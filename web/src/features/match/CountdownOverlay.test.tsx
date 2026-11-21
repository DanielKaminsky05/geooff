import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CountdownOverlay from "./CountdownOverlay";

describe("CountdownOverlay", () => {
  it("uses one polite status message, not an assertive per-tick announcement", () => {
    const { rerender } = render(<CountdownOverlay countdown="ready" />);
    const overlay = screen.getByTestId("countdown-overlay");
    expect(overlay.querySelector('[aria-live="assertive"]')).toBeNull();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    const message = status.textContent;
    expect(message).toMatch(/get ready/i);

    // Ticks update the visual digit only; the live region text stays put.
    rerender(<CountdownOverlay countdown={2} />);
    expect(overlay).toHaveTextContent("2");
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(screen.getByRole("status")).not.toHaveTextContent("2");
  });

  it("hides the big digits from assistive tech", () => {
    render(<CountdownOverlay countdown={3} />);
    expect(screen.getByText("3").closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
