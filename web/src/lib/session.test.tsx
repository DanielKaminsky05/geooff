import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { IDENTITY_KEY, SessionProvider, useSession, type Identity } from "./session";

// Minimal Manager-like emitter so we can fire "reconnect".
type Handler = (...args: unknown[]) => void;
function createFakeSocket() {
  const managerHandlers = new Map<string, Handler[]>();
  const manager = {
    on: vi.fn((ev: string, cb: Handler) => {
      managerHandlers.set(ev, [...(managerHandlers.get(ev) ?? []), cb]);
      return manager;
    }),
    off: vi.fn((ev: string, cb: Handler) => {
      managerHandlers.set(ev, (managerHandlers.get(ev) ?? []).filter((h) => h !== cb));
      return manager;
    }),
    fire(ev: string) {
      (managerHandlers.get(ev) ?? []).forEach((cb) => cb());
    },
    count(ev: string) {
      return (managerHandlers.get(ev) ?? []).length;
    },
  };
  return { io: manager, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
}

let socket: ReturnType<typeof createFakeSocket>;

vi.mock("./socket", () => ({
  useSocket: () => socket,
}));

// Ensure a working sessionStorage regardless of the jsdom build.
if (
  typeof globalThis.sessionStorage === "undefined" ||
  typeof globalThis.sessionStorage.getItem !== "function"
) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
    } satisfies Storage,
  });
}

const ID: Identity = {
  playerId: "p1-id",
  slot: "p1",
  reconnectToken: "tok-1",
  roomCode: "ABCD",
};

const captured: { session?: ReturnType<typeof useSession> } = {};
function Capture() {
  const s = useSession();
  useEffect(() => {
    captured.session = s;
  });
  return <div data-testid="id">{s.identity?.playerId ?? "none"}</div>;
}

function renderSession() {
  return render(
    <SessionProvider>
      <Capture />
    </SessionProvider>,
  );
}

describe("SessionProvider identity persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    socket = createFakeSocket();
  });

  it("persists identity to sessionStorage on set", () => {
    renderSession();
    act(() => captured.session!.setIdentity(ID));
    expect(JSON.parse(sessionStorage.getItem(IDENTITY_KEY)!)).toEqual(ID);
    expect(captured.session!.identity).toEqual(ID);
    expect(captured.session!.identityRef.current).toEqual(ID);
  });

  it("restores identity (state and ref) from sessionStorage on mount", () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(ID));
    const { getByTestId } = renderSession();
    expect(getByTestId("id")).toHaveTextContent("p1-id");
    expect(captured.session!.identity).toEqual(ID);
    expect(captured.session!.identityRef.current).toEqual(ID);
  });

  it("ignores malformed stored identity", () => {
    sessionStorage.setItem(IDENTITY_KEY, "{not json");
    renderSession();
    expect(captured.session!.identity).toBeNull();
    expect(captured.session!.identityRef.current).toBeNull();
  });

  it("setIdentity(null) clears storage, state and ref", () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(ID));
    renderSession();
    act(() => captured.session!.setIdentity(null));
    expect(sessionStorage.getItem(IDENTITY_KEY)).toBeNull();
    expect(captured.session!.identity).toBeNull();
    expect(captured.session!.identityRef.current).toBeNull();
  });
});

describe("SessionProvider auto-rejoin", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    socket = createFakeSocket();
  });

  it("emits join_room with the reconnect token on Manager reconnect", () => {
    renderSession();
    act(() => {
      captured.session!.setPlayerName("Alice");
      captured.session!.setIdentity(ID);
    });
    socket.io.fire("reconnect");
    expect(socket.emit).toHaveBeenCalledWith("join_room", {
      code: "ABCD",
      playerName: "Alice",
      reconnectToken: "tok-1",
    });
  });

  it("does not emit when identity has no roomCode", () => {
    renderSession();
    act(() => captured.session!.setIdentity({ ...ID, roomCode: undefined }));
    socket.io.fire("reconnect");
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("does not emit when there is no identity", () => {
    renderSession();
    socket.io.fire("reconnect");
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("does not emit on the initial connect", () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(ID));
    renderSession();
    socket.io.fire("open");
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("removes the reconnect listener on unmount", () => {
    const { unmount } = renderSession();
    expect(socket.io.count("reconnect")).toBe(1);
    unmount();
    expect(socket.io.count("reconnect")).toBe(0);
  });

  it("tolerates a socket without a Manager (.io)", () => {
    socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as unknown as ReturnType<
      typeof createFakeSocket
    >;
    expect(() => renderSession()).not.toThrow();
  });
});
