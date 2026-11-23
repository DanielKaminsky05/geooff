import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CountryInput from "./CountryInput";

/**
 * Harness that lets a test drive the reset (clearSignal), accept
 * (acceptSignal) and reject (rejectSignal) signals the way the Match page does.
 */
function Harness({ onSubmit }: { onSubmit: (t: string) => boolean | void }) {
  const [clearSignal, setClear] = useState(0);
  const [acceptSignal, setAccept] = useState(0);
  const [rejectSignal, setReject] = useState(0);
  return (
    <div>
      <CountryInput
        onSubmit={onSubmit}
        clearSignal={clearSignal}
        acceptSignal={acceptSignal}
        rejectSignal={rejectSignal}
      />
      <button onClick={() => setClear((n) => n + 1)}>reset</button>
      <button onClick={() => setAccept((n) => n + 1)}>accept</button>
      <button onClick={() => setReject((n) => n + 1)}>reject</button>
    </div>
  );
}

function setup(onSubmit: (t: string) => boolean | void = vi.fn()) {
  const user = userEvent.setup();
  render(<Harness onSubmit={onSubmit} />);
  const input = screen.getByLabelText("Country guess") as HTMLInputElement;
  // Server results arrive while the player keeps typing: fire them without
  // moving focus off the field (a real click would blur it).
  const server = (name: "accept" | "reject" | "reset") => fireEvent.click(screen.getByText(name));
  return { user, input, server };
}

describe("CountryInput", () => {
  it("clears optimistically on submit; an accept leaves it alone", async () => {
    const onSubmit = vi.fn();
    const { user, input, server } = setup(onSubmit);

    await user.type(input, "france{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("france");
    expect(input.value).toBe(""); // cleared before the server answers

    server("accept");
    expect(input.value).toBe("");
  });

  it("type-ahead survives the pending accept (no wipe of the next guess)", async () => {
    const onSubmit = vi.fn();
    const { user, input, server } = setup(onSubmit);

    await user.type(input, "france{Enter}");
    await user.type(input, "ger"); // next guess started before the result lands
    server("accept");
    expect(input.value).toBe("ger");
    await user.type(input, "many{Enter}");
    expect(onSubmit).toHaveBeenLastCalledWith("germany");
  });

  it("restores a rejected guess, selected, when the field is still empty", async () => {
    const { user, input, server } = setup();

    await user.type(input, "notacountry{Enter}");
    expect(input.value).toBe("");

    server("reject");
    expect(input.value).toBe("notacountry");
    expect(input.getAttribute("data-shaking")).toBe("true");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("notacountry".length);

    // Typing replaces the selected, restored guess.
    await user.keyboard("spain");
    expect(input.value).toBe("spain");
  });

  it("on reject while typing ahead: shakes but never clobbers the new text", async () => {
    const { user, input, server } = setup();

    await user.type(input, "wrongland{Enter}");
    await user.type(input, "ita");
    server("reject");
    expect(input.value).toBe("ita");
    expect(input.getAttribute("data-shaking")).toBe("true");
    await user.type(input, "ly");
    expect(input.value).toBe("italy");
  });

  it("matches results to in-flight guesses in order", async () => {
    const { user, input, server } = setup();

    await user.type(input, "france{Enter}");
    await user.type(input, "atlantis{Enter}");
    server("accept"); // france
    server("reject"); // atlantis
    expect(input.value).toBe("atlantis");
  });

  it("a quick second Enter does not re-send the same guess", async () => {
    const onSubmit = vi.fn();
    const { user, input } = setup(onSubmit);

    await user.type(input, "france{Enter}{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the text when onSubmit reports the guess was not sent", async () => {
    const onSubmit = vi.fn(() => false);
    const { user, input } = setup(onSubmit);

    await user.type(input, "France{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("France");
    expect(input.value).toBe("France");
  });

  it("does not submit on an Enter that commits an IME composition", () => {
    const onSubmit = vi.fn();
    const { input } = setup(onSubmit);

    fireEvent.change(input, { target: { value: "日本" } });
    const enter = fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(enter).toBe(false); // default (implicit form submit) prevented
    const legacy = fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(legacy).toBe(false);
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe("日本");
  });

  it("a reset clears the field and forgets in-flight guesses", async () => {
    const { user, input, server } = setup();

    await user.type(input, "france{Enter}");
    await user.type(input, "ger");
    server("reset");
    expect(input.value).toBe("");
    server("reject"); // stale result from before the reset
    expect(input.value).toBe("");
  });

  it("refocuses the field after a reset", async () => {
    const { user, input } = setup();

    await user.type(input, "france");
    await user.click(screen.getByText("reset"));
    expect(document.activeElement).toBe(input);
  });

  it("applies the shake class on reject and clears it after the timeout", async () => {
    const { user, input, server } = setup();

    await user.type(input, "wrongtext");
    server("reject");
    expect(input.className).toContain("animate-[shake_0.4s]");

    // Shake clears ~400ms later.
    await waitFor(() => expect(input.getAttribute("data-shaking")).toBe("false"), { timeout: 1000 });
    expect(input.className).not.toContain("animate-[shake_0.4s]");
  });

  it("does not emit on an all-whitespace submit", async () => {
    const onSubmit = vi.fn();
    const { user, input } = setup(onSubmit);

    await user.type(input, "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("trims the submitted text", async () => {
    const onSubmit = vi.fn();
    const { user, input } = setup(onSubmit);

    await user.type(input, "  spain  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("spain");
  });
});
