import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CountryInput from "./CountryInput";

/**
 * Harness that lets a test drive the accept (clearSignal) / reject
 * (rejectSignal) signals the way the Match page does.
 */
function Harness({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [clearSignal, setClear] = useState(0);
  const [rejectSignal, setReject] = useState(0);
  return (
    <div>
      <CountryInput
        onSubmit={(text) => onSubmit(text)}
        clearSignal={clearSignal}
        rejectSignal={rejectSignal}
      />
      <button onClick={() => setClear((n) => n + 1)}>accept</button>
      <button onClick={() => setReject((n) => n + 1)}>reject</button>
    </div>
  );
}

describe("CountryInput", () => {
  it("clears the field when an answer is accepted", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await user.type(input, "france");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("france");
    expect(input.value).toBe("france"); // not cleared until server accepts

    // Simulate accepted result.
    await user.click(screen.getByText("accept"));
    expect(input.value).toBe("");
  });

  it("keeps the text when an answer is rejected", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await user.type(input, "notacountry");
    await user.keyboard("{Enter}");

    // Simulate rejected result.
    await user.click(screen.getByText("reject"));
    expect(input.value).toBe("notacountry"); // preserved
    expect(input.getAttribute("data-shaking")).toBe("true");
  });

  it("refocuses the field after an accepted result", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await user.type(input, "france");
    await user.click(screen.getByText("accept"));
    expect(document.activeElement).toBe(input);
  });

  it("applies the shake class on reject and clears it after the timeout", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await user.type(input, "wrongtext");
    await user.click(screen.getByText("reject"));
    expect(input.className).toContain("animate-[shake_0.4s]");

    // Shake clears ~400ms later.
    await waitFor(
      () => expect(input.getAttribute("data-shaking")).toBe("false"),
      { timeout: 1000 },
    );
    expect(input.className).not.toContain("animate-[shake_0.4s]");
  });

  it("does not emit on an all-whitespace submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await user.type(input, "   ");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims the submitted text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await user.type(input, "  spain  ");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("spain");
  });
});
