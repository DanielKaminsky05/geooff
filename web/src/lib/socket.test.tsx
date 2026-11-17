import { StrictMode, useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const calls: string[] = [];
const fakeSocket = {
  connect: vi.fn(() => {
    calls.push("connect");
    return fakeSocket;
  }),
  disconnect: vi.fn(() => {
    calls.push("disconnect");
    return fakeSocket;
  }),
};
const ioMock = vi.fn((..._args: unknown[]) => fakeSocket);

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

import { SocketProvider, useSocket } from "./socket";

const seen: { socket?: unknown } = {};
function Consumer() {
  const socket = useSocket();
  useEffect(() => {
    seen.socket = socket;
  });
  return null;
}

describe("SocketProvider", () => {
  beforeEach(() => {
    calls.length = 0;
    fakeSocket.connect.mockClear();
    fakeSocket.disconnect.mockClear();
    ioMock.mockClear();
    seen.socket = undefined;
  });

  it("creates the socket without auto-connecting", () => {
    render(
      <SocketProvider>
        <Consumer />
      </SocketProvider>,
    );
    expect(ioMock).toHaveBeenCalled();
    expect(ioMock.mock.calls[0][1]).toMatchObject({ autoConnect: false });
    expect(calls).toEqual(["connect"]);
    expect(seen.socket).toBe(fakeSocket);
  });

  it("survives StrictMode's mount -> cleanup -> mount (ends connected)", () => {
    render(
      <StrictMode>
        <SocketProvider>
          <Consumer />
        </SocketProvider>
      </StrictMode>,
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toBe("connect");
    // Simulated cleanup did happen, and connect was called after it.
    const lastDisconnect = calls.lastIndexOf("disconnect");
    expect(lastDisconnect).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf("connect")).toBeGreaterThan(lastDisconnect);
    expect(seen.socket).toBe(fakeSocket);
  });

  it("disconnects on real unmount", () => {
    const { unmount } = render(
      <SocketProvider>
        <Consumer />
      </SocketProvider>,
    );
    unmount();
    expect(calls).toEqual(["connect", "disconnect"]);
  });

  it("useSocket throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/SocketProvider/);
    spy.mockRestore();
  });
});
