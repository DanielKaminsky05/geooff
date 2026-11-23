import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode, act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { createMockSocket, type MockSocket } from "../test/mockSocket";
import type { Identity } from "../lib/session";
import type { RoomState, PlayerPublic } from "../lib/protocol";

let socket: MockSocket;
let identity: Identity | null;
const navigate = vi.fn();
const setIdentitySpy = vi.fn();

vi.mock("../lib/socket", () => ({
  useSocket: () => socket,
}));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    playerName: "Alice",
    setPlayerName: vi.fn(),
    identity,
    setIdentity: (id: Identity | null) => {
      identity = id;
      setIdentitySpy(id);
    },
    identityRef: { current: identity },
  }),
  defaultName: () => "Player 1234",
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

import Lobby from "./Lobby";

function player(over: Partial<PlayerPublic> & { id: string; slot: PlayerPublic["slot"] }): PlayerPublic {
  return { name: "P", connected: true, ready: false, score: 0, ...over };
}

function roomState(over: Partial<RoomState> = {}): RoomState {
  return {
    code: "ROOM01",
    phase: "lobby",
    hostId: "a",
    settings: { categoryId: "countries", mode: "race", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    players: [player({ id: "a", slot: "p1", name: "Alice" })],
    ...over,
  };
}

function renderLobby({ strict = false, path = "/room/ROOM01" }: { strict?: boolean; path?: string } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:code" element={<Lobby />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function joinEmits() {
  return socket.__emitted.filter((e) => e.event === "join_room");
}

describe("<Lobby>", () => {
  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
    setIdentitySpy.mockClear();
  });

  it("emits join_room on mount and renders the room code", () => {
    renderLobby();
    expect(socket.__lastEmit("join_room")).toMatchObject({ code: "ROOM01" });
    expect(screen.getByText("ROOM01")).toBeInTheDocument();
  });

  it("re-emits join_room on (re)connect so joining doesn't need a refresh", () => {
    renderLobby();
    expect(joinEmits()).toHaveLength(1);
    // A socket (re)connect after the initial emit re-claims the seat.
    socket.__server("connect");
    expect(joinEmits()).toHaveLength(2);
    expect(socket.__lastEmit("join_room")).toMatchObject({ code: "ROOM01" });
  });

  it("clears a transient error once the room state finally arrives", () => {
    renderLobby();
    socket.__server("error_msg", { code: "room_not_found", message: "No room with code ROOM01." });
    expect(screen.getByText("No room with code ROOM01.")).toBeInTheDocument();

    // A later successful (re)join resolves the error without a manual refresh.
    socket.__server("room_state", roomState());
    expect(screen.queryByText("No room with code ROOM01.")).toBeNull();
    expect(screen.getByText("ROOM01")).toBeInTheDocument();
  });

  it("the Ready button emits set_ready with the toggled value", async () => {
    const user = userEvent.setup();
    renderLobby();
    // Ready-up only appears in versus (2 players) — solo has no opponent.
    socket.__server("room_state", roomState({
      players: [
        player({ id: "a", slot: "p1", name: "Alice" }),
        player({ id: "b", slot: "p2", name: "Bob" }),
      ],
    }));

    await user.click(screen.getByRole("button", { name: "Ready up" }));
    expect(socket.__lastEmit("set_ready")).toEqual({ ready: true });

    // Reflect ready → button toggles, next click sets false.
    socket.__server("room_state", roomState({
      players: [
        player({ id: "a", slot: "p1", name: "Alice", ready: true }),
        player({ id: "b", slot: "p2", name: "Bob" }),
      ],
    }));
    await user.click(screen.getByRole("button", { name: "Not ready" }));
    expect(socket.__lastEmit("set_ready")).toEqual({ ready: false });
  });

  it("host time presets emit update_settings and offer nothing above the cap", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());

    await user.click(screen.getByRole("button", { name: "10 min" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ timeLimitSeconds: 600 });

    // No preset exceeds the 15-min (900s) cap.
    expect(screen.queryByRole("button", { name: "30 min" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "15 min" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ timeLimitSeconds: 900 });
  });

  it("the mode toggle emits update_settings with the chosen mode", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());

    await user.click(screen.getByRole("button", { name: "Last Standing" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ mode: "last_standing" });

    await user.click(screen.getByRole("button", { name: "Race" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ mode: "race" });
  });

  it("offers Gauntlet for a country set and emits update_settings{mode:'gauntlet'}", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());

    await user.click(screen.getByRole("button", { name: "Gauntlet" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ mode: "gauntlet" });
  });

  it("does NOT offer Gauntlet for the us-states set", () => {
    renderLobby();
    socket.__server("room_state", roomState({
      settings: { categoryId: "us-states", mode: "race", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    }));
    // Race / Last Standing stay; Gauntlet is hidden (no prompt pool for states).
    expect(screen.getByRole("button", { name: "Race" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last Standing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gauntlet" })).toBeNull();
  });

  it("in gauntlet, shows the turn-time AND lives pickers", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState({
      settings: { categoryId: "countries", mode: "gauntlet", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    }));

    // Round-length presets give way to the per-turn + lives pickers.
    expect(screen.queryByRole("button", { name: "5 min" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "30s" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ turnSeconds: 30 });

    await user.click(screen.getByRole("button", { name: "3" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ lives: 3 });
  });

  it("the set picker emits update_settings with the chosen categoryId", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());

    await user.click(screen.getByRole("button", { name: "US states" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ categoryId: "us-states" });

    await user.click(screen.getByRole("button", { name: "Countries" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ categoryId: "countries" });
  });

  it("the set picker offers the region sets and emits their categoryId", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());

    await user.click(screen.getByRole("button", { name: "Europe" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ categoryId: "europe" });

    await user.click(screen.getByRole("button", { name: "Middle East" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ categoryId: "middle-east" });

    await user.click(screen.getByRole("button", { name: "Americas" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ categoryId: "americas" });
  });

  it("in last_standing, shows the turn-time picker but no lives (sudden death)", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState({
      settings: { categoryId: "countries", mode: "last_standing", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    }));

    // Round-length presets are replaced by the per-turn picker.
    expect(screen.queryByRole("button", { name: "5 min" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "30s" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ turnSeconds: 30 });

    // No lives picker — Last Standing is sudden death.
    expect(screen.queryByText("Lives")).toBeNull();
  });

  it("a solo room offers Race + Gauntlet (not Last Standing)", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState({ solo: true }));
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    // Last Standing is multiplayer-only; Gauntlet works solo.
    expect(screen.queryByRole("button", { name: "Last Standing" })).toBeNull();
    expect(screen.getByRole("button", { name: "Race" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Gauntlet" }));
    expect(socket.__lastEmit("update_settings")).toEqual({ mode: "gauntlet" });
  });

  it("a solo us-states room has no Mode toggle (Gauntlet needs a prompt pool)", () => {
    renderLobby();
    socket.__server("room_state", roomState({
      solo: true,
      settings: { categoryId: "us-states", mode: "race", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    }));
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gauntlet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Race" })).toBeNull();
    expect(screen.getByRole("button", { name: "5 min" })).toBeEnabled();
  });

  it("non-host sees settings presets disabled (read-only)", () => {
    identity = { playerId: "b", slot: "p2", reconnectToken: "tok2" };
    renderLobby();
    socket.__server("room_state", roomState({
      hostId: "a",
      players: [
        player({ id: "a", slot: "p1", name: "Alice" }),
        player({ id: "b", slot: "p2", name: "Bob" }),
      ],
    }));
    expect(screen.getByRole("button", { name: "5 min" })).toBeDisabled();
    expect(screen.getByText("Only the host can change settings.")).toBeInTheDocument();
  });

  it("Start is disabled until there are 2 players and both are ready, then emits start_game", async () => {
    const user = userEvent.setup();
    renderLobby();

    // One player → start is present but disabled (waiting for a player to join).
    socket.__server("room_state", roomState());
    expect(screen.getByRole("button", { name: /Waiting for a player/ })).toBeDisabled();

    // Two players but not both ready → still disabled.
    socket.__server("room_state", roomState({
      players: [
        player({ id: "a", slot: "p1", name: "Alice", ready: true }),
        player({ id: "b", slot: "p2", name: "Bob", ready: false }),
      ],
    }));
    expect(screen.getByRole("button", { name: /Waiting for everyone/ })).toBeDisabled();

    // Both ready → enabled, emits start_game.
    socket.__server("room_state", roomState({
      players: [
        player({ id: "a", slot: "p1", name: "Alice", ready: true }),
        player({ id: "b", slot: "p2", name: "Bob", ready: true }),
      ],
    }));
    const start = screen.getByRole("button", { name: "Start game" });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(socket.__emitted.some((e) => e.event === "start_game")).toBe(true);
  });

  it("never auto-starts on arrival", () => {
    renderLobby();
    socket.__server("room_state", roomState());
    expect(socket.__emitted.some((e) => e.event === "start_game")).toBe(false);
  });

  it("renders a solo setup (Start, no seats/share/ready-up) for a solo room", () => {
    renderLobby();
    socket.__server("room_state", roomState({ solo: true }));
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByText("Room code")).toBeNull();
    expect(screen.queryByText("Player 2")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ready up" })).toBeNull();
    // Time presets are still there (you're the host of your solo room).
    expect(screen.getByRole("button", { name: "5 min" })).toBeEnabled();
  });

  it("solo Start emits start_game", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState({ solo: true }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(socket.__emitted.some((e) => e.event === "start_game")).toBe(true);
  });

  it("shows up to 4 seats, with empty seats waiting until they join", () => {
    renderLobby();
    socket.__server("room_state", roomState());
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Race lobby has 4 seats: one host + three empty "Waiting…" seats.
    expect(screen.getByText("Player 2")).toBeInTheDocument();
    expect(screen.getByText("Player 4")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting…")).toHaveLength(3);
  });

  it("navigates to the game on a countdown event", () => {
    renderLobby();
    socket.__server("room_state", roomState());
    socket.__server("countdown", { seconds: 3 });
    expect(navigate).toHaveBeenCalledWith("/game/ROOM01");
  });

  it("emits join_room only once under StrictMode's double effect", () => {
    identity = null;
    renderLobby({ strict: true });
    expect(joinEmits()).toHaveLength(1);
    expect(joinEmits()[0].payload).toMatchObject({ code: "ROOM01", reconnectToken: undefined });
  });

  it("sends the reconnect token only when it belongs to this room", () => {
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok", roomCode: "ROOM01" };
    renderLobby();
    expect(socket.__lastEmit("join_room")).toMatchObject({ reconnectToken: "tok" });

    socket = createMockSocket();
    identity = { playerId: "z", slot: "p1", reconnectToken: "old", roomCode: "OTHER1" };
    renderLobby();
    expect(socket.__lastEmit("join_room")).toMatchObject({ reconnectToken: undefined });
  });

  it("sets identity with roomCode from the joined payload", () => {
    identity = null;
    renderLobby();
    socket.__server("joined", {
      playerId: "b",
      slot: "p2",
      reconnectToken: "tok-b",
      state: roomState(),
    });
    expect(setIdentitySpy).toHaveBeenCalledWith({
      playerId: "b",
      slot: "p2",
      reconnectToken: "tok-b",
      roomCode: "ROOM01",
    });
  });

  it("ignores room_full once already joined to this room", () => {
    identity = null;
    renderLobby({ strict: true });
    socket.__server("joined", {
      playerId: "b",
      slot: "p2",
      reconnectToken: "tok-b",
      state: roomState(),
    });
    socket.__server("error_msg", { code: "room_full", message: "That room is already full." });
    expect(screen.queryByText("That room is already full.")).toBeNull();
    expect(screen.getByText("ROOM01")).toBeInTheDocument();
  });

  it("shows room_full as an error when we never joined", () => {
    identity = null;
    renderLobby();
    socket.__server("error_msg", { code: "room_full", message: "That room is already full." });
    expect(screen.getByText("That room is already full.")).toBeInTheDocument();
  });

  it("Leave emits leave_room, clears identity and navigates home", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(socket.__emitted.some((e) => e.event === "leave_room")).toBe(true);
    expect(setIdentitySpy).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("'Back to home' on the error screen clears identity and emits leave_room", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("error_msg", { code: "room_not_found", message: "No such room." });
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(socket.__emitted.some((e) => e.event === "leave_room")).toBe(true);
    expect(setIdentitySpy).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it.each(["room_not_found", "room_full", "in_progress", "not_joinable"])(
    "shows the error screen for fatal join error %s before being seated",
    (errCode) => {
      identity = null;
      renderLobby();
      socket.__server("error_msg", { code: errCode, message: `fatal ${errCode}` });
      expect(screen.getByText(`fatal ${errCode}`)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Back to home" })).toBeInTheDocument();
    },
  );

  it.each([
    "not_ready",
    "no_prompts",
    "needs_two",
    "not_host",
    "locked",
    "bad_mode",
    "bad_category",
    "internal",
  ])("shows recoverable error %s inline without replacing the lobby", (errCode) => {
    renderLobby();
    socket.__server("room_state", roomState());
    socket.__server("error_msg", { code: errCode, message: `oops ${errCode}` });
    expect(screen.getByRole("status")).toHaveTextContent(`oops ${errCode}`);
    expect(screen.queryByRole("button", { name: "Back to home" })).toBeNull();
    // The lobby itself is still rendered.
    expect(screen.getByText("ROOM01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
  });

  it("treats any error as recoverable once seated in this room", () => {
    identity = null;
    renderLobby();
    socket.__server("joined", {
      playerId: "a",
      slot: "p1",
      reconnectToken: "tok",
      state: roomState(),
    });
    socket.__server("error_msg", { code: "room_not_found", message: "Weird glitch." });
    expect(screen.getByRole("status")).toHaveTextContent("Weird glitch.");
    expect(screen.queryByRole("button", { name: "Back to home" })).toBeNull();
  });

  it("auto-dismisses the inline error after a few seconds", () => {
    vi.useFakeTimers();
    try {
      renderLobby();
      socket.__server("room_state", roomState());
      socket.__server("error_msg", { code: "not_ready", message: "Not everyone is ready." });
      expect(screen.getByText("Not everyone is ready.")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.queryByText("Not everyone is ready.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the server's mode as-is (no local fallback)", () => {
    // Server says showdown even though the category lacks a prompt pool; we
    // display the server's truth rather than faking "race".
    renderLobby();
    socket.__server("room_state", roomState({
      settings: { categoryId: "us-states", mode: "showdown", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    }));
    expect(screen.getByText("Round time")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "5 min" })).toBeNull();
  });

  it("emits leave_room when the lobby unmounts via other navigation (e.g. browser back)", async () => {
    const { unmount } = renderLobby();
    socket.__server("room_state", roomState());
    expect(socket.__emitted.some((e) => e.event === "leave_room")).toBe(false);
    unmount();
    await flushMicrotasks();
    expect(socket.__emitted.filter((e) => e.event === "leave_room")).toHaveLength(1);
  });

  it("does not emit leave_room on StrictMode's simulated unmount", async () => {
    renderLobby({ strict: true });
    await flushMicrotasks();
    socket.__server("room_state", roomState());
    expect(socket.__emitted.some((e) => e.event === "leave_room")).toBe(false);
  });

  it("does not emit leave_room when unmounting to go into the game", async () => {
    const { unmount } = renderLobby();
    socket.__server("room_state", roomState());
    socket.__server("countdown", { seconds: 3 });
    unmount();
    await flushMicrotasks();
    expect(socket.__emitted.some((e) => e.event === "leave_room")).toBe(false);
  });

  it("Leave emits leave_room only once (not again on unmount)", async () => {
    const user = userEvent.setup();
    const { unmount } = renderLobby();
    socket.__server("room_state", roomState());
    await user.click(screen.getByRole("button", { name: "Leave" }));
    unmount();
    await flushMicrotasks();
    expect(socket.__emitted.filter((e) => e.event === "leave_room")).toHaveLength(1);
  });

  it("normalizes a lowercase room code from the URL", () => {
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok", roomCode: "ROOM01" };
    renderLobby({ path: "/room/room01" });
    expect(socket.__lastEmit("join_room")).toMatchObject({ code: "ROOM01", reconnectToken: "tok" });
    expect(screen.getByText("ROOM01")).toBeInTheDocument();

    // Seated via the uppercase server code → a later room_full is ignored.
    socket.__server("joined", {
      playerId: "a",
      slot: "p1",
      reconnectToken: "tok",
      state: roomState(),
    });
    socket.__server("error_msg", { code: "room_full", message: "That room is already full." });
    expect(screen.queryByText("That room is already full.")).toBeNull();
    socket.__server("countdown", { seconds: 3 });
    expect(navigate).toHaveBeenCalledWith("/game/ROOM01");
  });

  it("shows ready state with a word + icon, not colour alone, and marks the active setting", () => {
    renderLobby();
    socket.__server("room_state", roomState({
      players: [
        player({ id: "a", slot: "p1", name: "Alice", ready: true }),
        player({ id: "b", slot: "p2", name: "Bob" }),
      ],
    }));
    expect(screen.getByText("Ready", { selector: "span" }).textContent).toBe("✓ Ready");
    expect(screen.getByText("Not ready", { selector: "span" }).textContent).toBe("○ Not ready");
    expect(screen.getByRole("button", { name: "Race" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Gauntlet" })).toHaveAttribute("aria-pressed", "false");
  });

  it("'Copied!' resets after a moment and its timer is cleared on unmount", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const { unmount } = renderLobby();
      socket.__server("room_state", roomState());
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Share link" }));
      });
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/room/ROOM01"));
      expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByRole("button", { name: "Share link" })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Share link" }));
      });
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

