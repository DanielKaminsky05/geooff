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
    setIdentity: vi.fn(),
    identityRef: { current: identity },
  }),
  defaultName: () => "Player 1234",
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

// react-zoom-pan-pinch brings a lot of DOM machinery; keep WorldMap cheap &
// deterministic by stubbing it to a simple element exposing the filled isos.
vi.mock("../components/WorldMap", () => ({
  default: ({ filledIso, color }: { filledIso: Set<string>; color: string }) => (
    <div
      data-testid="world-map"
      data-color={color}
      data-filled={[...filledIso].sort().join(",")}
    />
  ),
}));

import Match from "./Match";

function player(over: Partial<PlayerPublic> & { id: string; slot: "p1" | "p2" }): PlayerPublic {
  return { name: "P", connected: true, ready: true, score: 0, ...over };
}

function roomState(over: Partial<RoomState> = {}): RoomState {
  return {
    code: "ROOM01",
    phase: "playing",
    hostId: "a",
    settings: { categoryId: "countries", timeLimitSeconds: 300 },
    players: [
      player({ id: "a", slot: "p1", name: "Alice" }),
      player({ id: "b", slot: "p2", name: "Bob" }),
    ],
    total: 196,
    ...over,
  };
}

function renderMatch() {
  return render(
    <MemoryRouter initialEntries={["/game/ROOM01"]}>
      <Routes>
        <Route path="/game/:code" element={<Match />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<Match>", () => {
  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
  });

  it("submits a guess via submit_answer", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState());

    await user.type(screen.getByLabelText("Country guess"), "france");
    await user.keyboard("{Enter}");
    expect(socket.__lastEmit("submit_answer")).toEqual({ text: "france" });
  });

  it("fills my map on an accepted answer_result and the opponent map on opponent_progress", () => {
    renderMatch();
    socket.__server("room_state", roomState());

    socket.__server("answer_result", { accepted: true, isoCode: "fr", canonical: "France" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "us" });

    const maps = screen.getAllByTestId("world-map");
    // Desktop layout: [mine, opponent].
    expect(maps[0].getAttribute("data-filled")).toContain("fr");
    expect(maps[1].getAttribute("data-filled")).toContain("us");
  });

  it("updates scores on score_update", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("score_update", { scores: { a: 5, b: 2 } });
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows the game-over overlay with winner + final scores", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "a", scores: { a: 10, b: 4 } });

    const overlay = screen.getByText("You win!").closest("div")!.parentElement!;
    expect(within(overlay).getByText("10")).toBeInTheDocument();
    expect(within(overlay).getByText("4")).toBeInTheDocument();
  });

  it("announces a tie when winnerId is null", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: null, scores: { a: 3, b: 3 } });
    expect(screen.getByText("It's a tie!")).toBeInTheDocument();
  });

  it("the Rematch button emits request_rematch", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "b", scores: { a: 2, b: 9 } });

    await user.click(screen.getByRole("button", { name: "Rematch" }));
    expect(socket.__emitted.some((e) => e.event === "request_rematch")).toBe(true);
    expect(screen.getByText("Waiting for opponent…")).toBeInTheDocument();
  });

  it("the mobile 'View opponent' toggle swaps the visible map", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("answer_result", { accepted: true, isoCode: "fr" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "us" });

    // Mobile map is the 3rd world-map (desktop grid has 2).
    const mobileMap = () => screen.getAllByTestId("world-map")[2];
    expect(mobileMap().getAttribute("data-filled")).toContain("fr");

    await user.click(screen.getByRole("button", { name: "View opponent" }));
    expect(mobileMap().getAttribute("data-filled")).toContain("us");
  });
});
