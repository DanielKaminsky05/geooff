import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { createMockSocket, type MockSocket } from "../test/mockSocket";
import { useSocketEvents } from "./useSocketEvents";

let socket: MockSocket;
vi.mock("./socket", () => ({ useSocket: () => socket }));

function Probe({ label, onScore }: { label: string; onScore: (label: string, s: unknown) => void }) {
  useSocketEvents({ score_update: (p) => onScore(label, p.scores) });
  return null;
}

describe("useSocketEvents", () => {
  beforeEach(() => {
    socket = createMockSocket();
  });

  it("calls the latest handler without resubscribing, and unsubscribes on unmount", () => {
    const on = vi.spyOn(socket, "on");
    const off = vi.spyOn(socket, "off");
    const onScore = vi.fn();
    const { rerender, unmount } = render(<Probe label="first" onScore={onScore} />);
    expect(on).toHaveBeenCalledTimes(1);

    rerender(<Probe label="second" onScore={onScore} />);
    expect(on).toHaveBeenCalledTimes(1); // no resubscribe on a new handler identity
    socket.__server("score_update", { scores: { a: 1 } });
    expect(onScore).toHaveBeenCalledWith("second", { a: 1 });

    unmount();
    expect(off).toHaveBeenCalledWith("score_update", expect.any(Function));
    onScore.mockClear();
    socket.__server("score_update", { scores: { a: 2 } });
    expect(onScore).not.toHaveBeenCalled();
  });
});
