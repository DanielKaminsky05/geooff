import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { createMockSocket, type MockSocket } from "../test/mockSocket";
import type { Identity } from "../lib/session";
import type { RoomState, PlayerPublic } from "../lib/protocol";

let socket: MockSocket;
let identity: Identity | null;
const navigate = vi.fn();

vi.mock("../lib/socket", () => ({
  useSocket: () => socket,
}));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    playerName: "Alice",
    setPlayerName: vi.fn(),
    identity,
    setIdentity: vi.fn((id: Identity | null) => {
      identity = id;
    }),
    identityRef: { current: identity },
  }),
  defaultName: () => "Player 1234",
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

import Lobby from "./Lobby";

function player(over: Partial<PlayerPublic> & { id: string; slot: "p1" | "p2" }): PlayerPublic {
  return { name: "P", connected: true, ready: false, score: 0, ...over };
}

function roomState(over: Partial<RoomState> = {}): RoomState {
  return {
    code: "ROOM01",
    phase: "lobby",
    hostId: "a",
    settings: { categoryId: "countries", timeLimitSeconds: 300 },
    players: [player({ id: "a", slot: "p1", name: "Alice" })],
    ...over,
  };
}

function renderLobby() {
  return render(
    <MemoryRouter initialEntries={["/room/ROOM01"]}>
      <Routes>
        <Route path="/room/:code" element={<Lobby />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<Lobby>", () => {
  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
  });

  it("emits join_room on mount and renders the room code", () => {
    renderLobby();
    expect(socket.__lastEmit("join_room")).toMatchObject({ code: "ROOM01" });
    expect(screen.getByText("ROOM01")).toBeInTheDocument();
  });

  it("the Ready button emits set_ready with the toggled value", async () => {
    const user = userEvent.setup();
    renderLobby();
    socket.__server("room_state", roomState());

    await user.click(screen.getByRole("button", { name: "Ready up" }));
    expect(socket.__lastEmit("set_ready")).toEqual({ ready: true });

    // Reflect ready → button toggles, next click sets false.
    socket.__server("room_state", roomState({
      players: [player({ id: "a", slot: "p1", name: "Alice", ready: true })],
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

    // One player → no/disabled start.
    socket.__server("room_state", roomState());
    expect(screen.getByRole("button", { name: /Waiting for both players/ })).toBeDisabled();

    // Two players but not both ready → still disabled.
    socket.__server("room_state", roomState({
      players: [
        player({ id: "a", slot: "p1", name: "Alice", ready: true }),
        player({ id: "b", slot: "p2", name: "Bob", ready: false }),
      ],
    }));
    expect(screen.getByRole("button", { name: /Waiting for both players/ })).toBeDisabled();

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

  it("renders only one player when the opponent hasn't joined", () => {
    renderLobby();
    socket.__server("room_state", roomState());
    const seats = screen.getAllByText(/Player [12]/);
    expect(seats).toHaveLength(2);
    expect(screen.getByText("Waiting…")).toBeInTheDocument();
    // host-only — avoid lint on unused import
    expect(within(document.body).getByText("Alice")).toBeInTheDocument();
  });

  it("navigates to the game on a countdown event", () => {
    renderLobby();
    socket.__server("room_state", roomState());
    socket.__server("countdown", { seconds: 3 });
    expect(navigate).toHaveBeenCalledWith("/game/ROOM01");
  });
});
