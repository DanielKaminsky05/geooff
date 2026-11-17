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
const setIdentity = vi.fn();

vi.mock("../lib/socket", () => ({
  useSocket: () => socket,
}));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    playerName: "Alice",
    setPlayerName: vi.fn(),
    identity,
    setIdentity,
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
    setIdentity.mockClear();
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

  it("an opponent's rematch request does not disable my button, and I can accept", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "a", scores: { a: 5, b: 3 } });

    // Server broadcasts the opponent's request to the whole room.
    socket.__server("rematch_requested", { playerId: "b" });
    expect(screen.getByText("Opponent wants a rematch")).toBeInTheDocument();
    const accept = screen.getByRole("button", { name: "Accept rematch" });
    expect(accept).toBeEnabled();

    await user.click(accept);
    expect(socket.__emitted.some((e) => e.event === "request_rematch")).toBe(true);
    expect(screen.getByRole("button", { name: "Waiting for opponent…" })).toBeDisabled();
  });

  it("my own rematch_requested echo keeps my button in the waiting state", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "a", scores: { a: 5, b: 3 } });
    socket.__server("rematch_requested", { playerId: "a" });
    expect(screen.getByRole("button", { name: "Waiting for opponent…" })).toBeDisabled();
    expect(screen.queryByText("Opponent wants a rematch")).not.toBeInTheDocument();
  });

  it("colors game-over scores by slot for a p2 player", () => {
    identity = { playerId: "b", slot: "p2", reconnectToken: "tok" };
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "b", scores: { a: 4, b: 10 } });

    expect(screen.getByText("You win!")).toBeInTheDocument();
    const mine = screen.getByTestId("my-final-score");
    const theirs = screen.getByTestId("opp-final-score");
    expect(mine.textContent).toBe("10");
    expect(mine.getAttribute("style")).toContain("var(--color-player2)");
    expect(theirs.textContent).toBe("4");
    expect(theirs.getAttribute("style")).toContain("var(--color-player1)");
  });

  it("'Back to home' leaves the room, clears identity, and navigates home", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "a", scores: { a: 1, b: 0 } });

    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(socket.__emitted.some((e) => e.event === "leave_room")).toBe(true);
    expect(setIdentity).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("shows a Reconnecting overlay on own disconnect and hides it on reconnect", () => {
    renderMatch();
    socket.__server("room_state", roomState());

    socket.__server("disconnect", "transport close");
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    socket.__server("connect");
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
  });

  it("hides the Reconnecting overlay when joined arrives", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("disconnect", "transport close");
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

    socket.__server("joined", {
      playerId: "a",
      slot: "p1",
      reconnectToken: "tok2",
      state: roomState(),
    });
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
    expect(setIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: "a", reconnectToken: "tok2", roomCode: "ROOM01" }),
    );
  });

  it("shows an opponent-disconnected banner with a countdown, hidden on reconnect", () => {
    renderMatch();
    socket.__server("room_state", roomState());

    socket.__server("opponent_disconnected", { playerId: "b", graceSeconds: 30 });
    expect(screen.getByText(/Opponent disconnected — waiting 30s/)).toBeInTheDocument();

    socket.__server("opponent_reconnected", { playerId: "b" });
    expect(screen.queryByText(/Opponent disconnected/)).not.toBeInTheDocument();
  });

  it("shows a countdown overlay and disables input until game_started", () => {
    renderMatch();
    socket.__server("room_state", roomState({ phase: "countdown" }));

    // Lobby consumed the first tick, so we start at "Get ready".
    const overlay = () => screen.queryByTestId("countdown-overlay");
    expect(overlay()).toHaveTextContent("Get ready");
    expect(screen.getByLabelText("Country guess")).toBeDisabled();

    socket.__server("countdown", { seconds: 2 });
    expect(overlay()).toHaveTextContent("2");
    socket.__server("countdown", { seconds: 1 });
    expect(overlay()).toHaveTextContent("1");

    socket.__server("game_started", {
      categoryId: "countries",
      total: 196,
      endsAt: Date.now() + 300_000,
    });
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Country guess")).toBeEnabled();
  });

  it("disables the input after game over", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    expect(screen.getByLabelText("Country guess")).toBeEnabled();
    socket.__server("game_over", { winnerId: null, scores: { a: 0, b: 0 } });
    expect(screen.getByLabelText("Country guess")).toBeDisabled();
  });
});
