import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { createMockSocket, type MockSocket } from "../test/mockSocket";

let socket: MockSocket;
const navigate = vi.fn();

vi.mock("../lib/socket", () => ({
  useSocket: () => socket,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

// Real SessionProvider so playerName state works end-to-end.
import { SessionProvider, useSession, type Identity } from "../lib/session";
import Home from "./Home";

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("<Home>", () => {
  beforeEach(() => {
    socket = createMockSocket();
    navigate.mockClear();
  });

  it("renders Create and Join entry points", () => {
    renderHome();
    expect(screen.getByText("Create a game")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("'Create a game' emits create_room with the entered name", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByPlaceholderText("Enter a name"), "Zoe");
    await user.click(screen.getByText("Create a game"));

    const payload = socket.__lastEmit("create_room") as { playerName: string };
    expect(payload).toEqual({ playerName: "Zoe" });
  });

  it("navigates to /room/:code on a 'joined' event", async () => {
    renderHome();
    socket.__server("joined", {
      playerId: "x",
      slot: "p1",
      reconnectToken: "tok",
      state: { code: "ABC123" },
    });
    expect(navigate).toHaveBeenCalledWith("/room/ABC123");
  });

  it("'Play solo' creates a room and navigates to its lobby", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("button", { name: "Play solo" }));
    expect(socket.__lastEmit("create_room")).toBeDefined();
    socket.__server("joined", {
      playerId: "x",
      slot: "p1",
      reconnectToken: "tok",
      state: { code: "SOLO01" },
    });
    expect(navigate).toHaveBeenCalledWith("/room/SOLO01");
  });

  it("stores identity (with roomCode) from a 'joined' event", () => {
    let seen: Identity | null = null;
    function Probe() {
      seen = useSession().identity;
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider>
          <Home />
          <Probe />
        </SessionProvider>
      </MemoryRouter>,
    );
    socket.__server("joined", {
      playerId: "x",
      slot: "p1",
      reconnectToken: "tok",
      state: { code: "ABC123" },
    });
    expect(seen).toEqual({
      playerId: "x",
      slot: "p1",
      reconnectToken: "tok",
      roomCode: "ABC123",
    });
  });

  it("the join form navigates to /room/:code with an uppercased code", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByPlaceholderText("Enter a name"), "Zoe");
    const codeInput = screen.getByPlaceholderText("ROOM CODE");
    await user.type(codeInput, "abc123");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(navigate).toHaveBeenCalledWith("/room/ABC123");
  });

  it("disables the Join button when the code is empty", () => {
    renderHome();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });
});
