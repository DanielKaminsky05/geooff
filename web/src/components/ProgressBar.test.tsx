import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressBar from "./ProgressBar";

describe("ProgressBar", () => {
  it("fills proportionally and exposes progressbar semantics", () => {
    render(<ProgressBar value={49} max={196} colorVar="red" label="p" />);
    const bar = screen.getByRole("progressbar", { name: "p" });
    expect(bar.getAttribute("aria-valuenow")).toBe("49");
    expect(bar.getAttribute("aria-valuemax")).toBe("196");
    expect(screen.getByTestId("progress-fill").style.width).toBe("25%");
  });

  it("clamps out-of-range values and handles max 0", () => {
    const { rerender } = render(<ProgressBar value={500} max={100} colorVar="red" />);
    expect(screen.getByTestId("progress-fill").style.width).toBe("100%");
    rerender(<ProgressBar value={3} max={0} colorVar="red" />);
    expect(screen.getByTestId("progress-fill").style.width).toBe("0%");
  });

  it("can fill from the right edge", () => {
    render(<ProgressBar value={1} max={2} colorVar="red" from="right" />);
    expect(screen.getByTestId("progress-fill").className).toContain("right-0");
  });
});
