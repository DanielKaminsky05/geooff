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
  default: ({
    filledIso,
    color,
    revealNames = true,
  }: {
    filledIso: Set<string>;
    color: string;
    revealNames?: boolean;
  }) => (
    <div
      data-testid="world-map"
      data-color={color}
      data-reveal={revealNames ? "true" : "false"}
      data-filled={[...filledIso].sort().join(",")}
    />
  ),
}));

import Match from "./Match";

function player(
  over: Partial<PlayerPublic> & { id: string; slot: PlayerPublic["slot"] },
): PlayerPublic {
  return { name: "P", connected: true, ready: true, score: 0, ...over };
}

function roomState(over: Partial<RoomState> = {}): RoomState {
  return {
    code: "ROOM01",
    phase: "playing",
    hostId: "a",
    settings: { categoryId: "countries", mode: "race", timeLimitSeconds: 300, turnSeconds: 15, lives: 5 },
    players: [
      player({ id: "a", slot: "p1", name: "Alice" }),
      player({ id: "b", slot: "p2", name: "Bob" }),
    ],
    total: 196,
    ...over,
  };
}

/** Three-player race roster (exercises the focused-map + leaderboard UI). */
const THREE = [
  player({ id: "a", slot: "p1", name: "Alice" }),
  player({ id: "b", slot: "p2", name: "Bob" }),
  player({ id: "c", slot: "p3", name: "Cara" }),
];

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

  it("fills my focused map on an accepted answer_result, and the opponent's when focused", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState({ players: THREE }));

    socket.__server("answer_result", { accepted: true, isoCode: "fr", canonical: "France" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "us", filled: ["us"] });

    // Race focuses my own map by default — and it reveals name tooltips.
    const focusedMap = () => screen.getByTestId("world-map");
    expect(focusedMap().getAttribute("data-filled")).toContain("fr");
    expect(focusedMap().getAttribute("data-reveal")).toBe("true");

    // Focusing the opponent swaps the big map to their fills, tooltips hidden.
    await user.click(screen.getByTestId("leaderboard-row-b"));
    expect(focusedMap().getAttribute("data-filled")).toContain("us");
    expect(focusedMap().getAttribute("data-reveal")).toBe("false");
  });

  it("self-heals the opponent map by replacing from `filled` (a dropped event can't strand a country)", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState({ players: THREE }));

    // First opponent fill arrives.
    socket.__server("opponent_progress", { playerId: "b", isoCode: "us", filled: ["us"] });
    // Pretend the "jp" event was dropped: the NEXT event carries the full set,
    // so the opponent map repairs to include both without ever seeing jp alone.
    socket.__server("opponent_progress", { playerId: "b", isoCode: "br", filled: ["us", "jp", "br"] });

    await user.click(screen.getByTestId("leaderboard-row-b"));
    const filled = screen.getByTestId("world-map").getAttribute("data-filled");
    expect(filled).toContain("us");
    expect(filled).toContain("jp");
    expect(filled).toContain("br");
  });

  it("race: hides the opponent's named list during play, reveals both columns at game over", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("answer_result", { accepted: true, isoCode: "fr", canonical: "France" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "jp", filled: ["jp"] });

    // During a RACE, only my own (grouped) list shows — the opponent's columns
    // are withheld so they can't be watched live.
    expect(screen.queryByTestId("named-Bob")).toBeNull();
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.queryByText("Japan")).toBeNull();

    // At game over the per-player columns are revealed.
    socket.__server("game_over", { winnerId: "a", scores: { a: 1, b: 1 } });
    const list = screen.getByRole("region", { name: "Named countries" });
    const alice = within(list).getByTestId("named-Alice");
    const bob = within(list).getByTestId("named-Bob");
    expect(within(alice).getByText("France")).toBeInTheDocument();
    expect(within(alice).queryByText("Japan")).toBeNull();
    expect(within(bob).getByText("Japan")).toBeInTheDocument();
  });

  it("updates scores on score_update", () => {
    renderMatch();
    socket.__server("room_state", roomState({ players: THREE }));
    socket.__server("score_update", { scores: { a: 5, b: 2, c: 0 } });
    // The score shows in both the score bar and the race leaderboard; assert it
    // reached the leaderboard rows (scoped, since bare counts collide).
    expect(screen.getByTestId("leaderboard-row-a")).toHaveTextContent("5");
    expect(screen.getByTestId("leaderboard-row-b")).toHaveTextContent("2");
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

  it("2-player race keeps the side-by-side maps (no leaderboard)", () => {
    renderMatch();
    socket.__server("room_state", roomState()); // default 2 players
    // Both maps are shown at once; there's no focus leaderboard for a duel.
    expect(screen.getAllByTestId("world-map").length).toBeGreaterThan(1);
    expect(screen.queryByTestId("leaderboard-row-a")).toBeNull();
  });

  it("race: both opponents' progress appears in the leaderboard (3 players)", () => {
    renderMatch();
    socket.__server(
      "room_state",
      roomState({
        players: [
          player({ id: "a", slot: "p1", name: "Alice" }),
          player({ id: "b", slot: "p2", name: "Bob" }),
          player({ id: "c", slot: "p3", name: "Cara" }),
        ],
      }),
    );
    socket.__server("score_update", { scores: { a: 1, b: 3, c: 2 } });

    // Every player has a leaderboard row (me shown as "You").
    expect(screen.getByTestId("leaderboard-row-a")).toHaveTextContent("You");
    expect(screen.getByTestId("leaderboard-row-b")).toHaveTextContent("Bob");
    expect(screen.getByTestId("leaderboard-row-c")).toHaveTextContent("Cara");

    // Ranked by score desc: Bob (3), Cara (2), You (1).
    const rows = screen.getAllByTestId(/^leaderboard-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "leaderboard-row-b",
      "leaderboard-row-c",
      "leaderboard-row-a",
    ]);
  });

  it("race: selecting another player focuses their map (3 players)", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server(
      "room_state",
      roomState({
        players: [
          player({ id: "a", slot: "p1", name: "Alice" }),
          player({ id: "b", slot: "p2", name: "Bob" }),
          player({ id: "c", slot: "p3", name: "Cara" }),
        ],
      }),
    );
    socket.__server("answer_result", { accepted: true, isoCode: "fr" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "us", filled: ["us"] });
    socket.__server("opponent_progress", { playerId: "c", isoCode: "jp", filled: ["jp"] });

    const focusedMap = () => screen.getByTestId("world-map");
    // Default focus: me.
    expect(focusedMap().getAttribute("data-filled")).toContain("fr");

    await user.click(screen.getByTestId("leaderboard-row-c"));
    expect(focusedMap().getAttribute("data-filled")).toBe("jp");
    expect(focusedMap().getAttribute("data-reveal")).toBe("false");

    await user.click(screen.getByTestId("leaderboard-row-b"));
    expect(focusedMap().getAttribute("data-filled")).toBe("us");
  });

  it("race game-over reveals every player's named column (3 players)", () => {
    renderMatch();
    socket.__server(
      "room_state",
      roomState({
        players: [
          player({ id: "a", slot: "p1", name: "Alice" }),
          player({ id: "b", slot: "p2", name: "Bob" }),
          player({ id: "c", slot: "p3", name: "Cara" }),
        ],
      }),
    );
    socket.__server("answer_result", { accepted: true, isoCode: "fr" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "jp", filled: ["jp"] });
    socket.__server("opponent_progress", { playerId: "c", isoCode: "br", filled: ["br"] });

    socket.__server("game_over", { winnerId: "b", scores: { a: 1, b: 1, c: 1 } });

    // Final standings list everyone, ranked, with the winner marked.
    expect(screen.getByTestId("final-rank-a")).toHaveTextContent("You");
    expect(screen.getByTestId("final-rank-b")).toHaveTextContent("Bob");
    expect(screen.getByTestId("final-rank-c")).toHaveTextContent("Cara");

    // The named sheet now reveals a column per player.
    const list = screen.getByRole("region", { name: "Named countries" });
    expect(within(within(list).getByTestId("named-Alice")).getByText("France")).toBeInTheDocument();
    expect(within(within(list).getByTestId("named-Bob")).getByText("Japan")).toBeInTheDocument();
    expect(within(within(list).getByTestId("named-Cara")).getByText("Brazil")).toBeInTheDocument();
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

  it("shows game-over scores in neutral colors (you vs opponent), not player green/amber", () => {
    identity = { playerId: "b", slot: "p2", reconnectToken: "tok" };
    renderMatch();
    socket.__server("room_state", roomState());
    socket.__server("game_over", { winnerId: "b", scores: { a: 4, b: 10 } });

    expect(screen.getByText("You win!")).toBeInTheDocument();
    const mine = screen.getByTestId("my-final-score");
    const theirs = screen.getByTestId("opp-final-score");
    expect(mine.textContent).toBe("10");
    expect(mine.getAttribute("style")).toContain("var(--color-foreground)");
    expect(theirs.textContent).toBe("4");
    expect(theirs.getAttribute("style")).toContain("var(--color-muted)");
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

  it("re-claims the seat with join_room on reconnect (so inputs keep working)", () => {
    renderMatch();
    socket.__server("room_state", roomState());
    socket.emit.mockClear();

    socket.__server("disconnect", "transport close");
    socket.__server("connect");

    expect(socket.__lastEmit("join_room")).toMatchObject({
      code: "ROOM01",
      reconnectToken: "tok",
    });
  });

  it("surfaces a fatal error and offers home when the room is gone", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", roomState());

    socket.__server("error_msg", { code: "room_not_found", message: "No room with code ROOM01." });
    expect(screen.getByText("Game unavailable")).toBeInTheDocument();
    expect(screen.getByText("No room with code ROOM01.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(setIdentity).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith("/");
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

describe("<Match> last_standing", () => {
  const lsSettings = {
    categoryId: "countries" as const,
    mode: "last_standing" as const,
    timeLimitSeconds: 300,
    turnSeconds: 15,
    lives: 5,
  };
  const lsState = (over: Partial<RoomState> = {}) =>
    roomState({
      settings: lsSettings,
      turn: { currentPlayerId: "b", endsAt: Date.now() + 15_000 },
      lives: { a: 5, b: 5 },
      ...over,
    });

  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
    setIdentity.mockClear();
  });

  it("keeps the input usable off-turn but does not submit, and shows whose turn it is", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", lsState());
    const input = screen.getByLabelText("Country guess");
    expect(input).toBeEnabled();
    expect(screen.getByText("Bob's turn")).toBeInTheDocument();

    await user.type(input, "France{Enter}");
    // Off-turn: no submit, and the typed text is retained to fire later.
    expect(socket.__emitted.some((e) => e.event === "submit_answer")).toBe(false);
    expect(input).toHaveValue("France");
  });

  it("submits only once it is my turn (turn_started naming me)", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", lsState());
    const input = screen.getByLabelText("Country guess");

    await user.type(input, "France{Enter}");
    expect(socket.__emitted.some((e) => e.event === "submit_answer")).toBe(false);

    socket.__server("turn_started", { playerId: "a", endsAt: Date.now() + 15_000 });
    await user.type(input, "{Enter}");
    expect(socket.__emitted.some((e) => e.event === "submit_answer")).toBe(true);
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it("shows no hearts — Last Standing is sudden death", () => {
    renderMatch();
    socket.__server("room_state", lsState());
    expect(screen.queryByTestId("hearts")).toBeNull();
  });

  it("surfaces a not_your_turn rejection gracefully", () => {
    renderMatch();
    socket.__server("room_state", lsState());
    socket.__server("answer_result", { accepted: false, reason: "not_your_turn" });
    expect(screen.getByText("Not your turn")).toBeInTheDocument();
  });

  it("3-player last_standing shows a lives bar for every player, current highlighted", () => {
    renderMatch();
    socket.__server(
      "room_state",
      lsState({
        players: [
          player({ id: "a", slot: "p1", name: "Alice" }),
          player({ id: "b", slot: "p2", name: "Bob" }),
          player({ id: "c", slot: "p3", name: "Cara" }),
        ],
        turn: { currentPlayerId: "c", endsAt: Date.now() + 15_000 },
        lives: { a: 5, b: 5, c: 5 },
      }),
    );
    expect(screen.getByTestId("lives-a")).toBeInTheDocument();
    expect(screen.getByTestId("lives-b")).toBeInTheDocument();
    expect(screen.getByTestId("lives-c")).toBeInTheDocument();
    // The current player's chip is highlighted.
    expect(screen.getByTestId("lives-c").className).toContain("border-foreground");
  });
});

describe("<Match> gauntlet", () => {
  const gSettings = {
    categoryId: "countries" as const,
    mode: "gauntlet" as const,
    timeLimitSeconds: 300,
    turnSeconds: 15,
    lives: 5,
  };
  const gState = (over: Partial<RoomState> = {}) =>
    roomState({
      settings: gSettings,
      turn: { currentPlayerId: "b", endsAt: Date.now() + 15_000 },
      lives: { a: 5, b: 5 },
      prompt: { id: "landlocked", label: "Landlocked countries", total: 44 },
      ...over,
    });

  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
    setIdentity.mockClear();
  });

  it("renders the prompt banner from room.prompt", () => {
    renderMatch();
    socket.__server("room_state", gState());
    const banner = screen.getByTestId("prompt-banner");
    expect(within(banner).getByText("Landlocked countries")).toBeInTheDocument();
  });

  it("keeps hearts and decrements them on life_lost (Gauntlet)", () => {
    renderMatch();
    socket.__server("room_state", gState());
    const heartsFor = (name: string) =>
      screen.getByRole("img", { name: new RegExp(`^${name}:`) });
    expect(heartsFor("Bob")).toHaveAttribute("data-lives", "5");

    socket.__server("life_lost", { playerId: "b", livesLeft: 4 });
    expect(heartsFor("Bob")).toHaveAttribute("data-lives", "4");
  });

  it("updates the prompt banner on prompt_changed", () => {
    renderMatch();
    socket.__server("room_state", gState());
    expect(screen.getByText("Landlocked countries")).toBeInTheDocument();

    socket.__server("prompt_changed", { id: "island", label: "Island nations", total: 46 });
    expect(screen.getByText("Island nations")).toBeInTheDocument();
    expect(screen.queryByText("Landlocked countries")).toBeNull();
  });

  it("clears the board (claimed countries) on a new prompt", () => {
    renderMatch();
    socket.__server("room_state", gState());
    socket.__server("answer_result", { accepted: true, isoCode: "fr", canonical: "France" });
    socket.__server("opponent_progress", { playerId: "b", isoCode: "jp" });
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByText("Japan")).toBeInTheDocument();

    // A fresh prompt is a clean slate — both players' claims clear.
    socket.__server("prompt_changed", { id: "island", label: "Island nations", total: 46 });
    expect(screen.queryByText("France")).toBeNull();
    expect(screen.queryByText("Japan")).toBeNull();
  });

  it("shows a brief 'Opponent named …' toast when the opponent names a country", () => {
    renderMatch();
    socket.__server("room_state", gState());
    socket.__server("opponent_progress", { playerId: "b", isoCode: "jp" });
    expect(screen.getByText("Opponent named Japan")).toBeInTheDocument();
  });

  it("gates submission to my turn (usable off-turn, submits on my turn)", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", gState());
    const input = screen.getByLabelText("Country guess");
    expect(input).toBeEnabled();
    expect(screen.getByText("Bob's turn")).toBeInTheDocument();

    await user.type(input, "France{Enter}");
    expect(socket.__emitted.some((e) => e.event === "submit_answer")).toBe(false);

    socket.__server("turn_started", { playerId: "a", endsAt: Date.now() + 15_000 });
    await user.type(input, "{Enter}");
    expect(socket.__emitted.some((e) => e.event === "submit_answer")).toBe(true);
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it("surfaces an off_prompt rejection gracefully", () => {
    renderMatch();
    socket.__server("room_state", gState());
    socket.__server("answer_result", { accepted: false, reason: "off_prompt" });
    expect(screen.getByText("Doesn't match the prompt")).toBeInTheDocument();
  });

  it("reuses the Last Standing shell: lives in the score bar + per-turn timer", () => {
    renderMatch();
    socket.__server("room_state", gState());
    expect(screen.getByRole("img", { name: /^Bob:/ })).toHaveAttribute("data-lives", "5");
    expect(screen.getByTestId("turn-timer")).toBeInTheDocument();
  });
});

describe("<Match> solo", () => {
  const soloState = (over: Partial<RoomState> = {}) =>
    roomState({ solo: true, players: [player({ id: "a", slot: "p1", name: "Alice" })], ...over });

  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
    setIdentity.mockClear();
  });

  it("shows only my map and no opponent column", () => {
    renderMatch();
    socket.__server("room_state", soloState());
    expect(screen.getAllByTestId("world-map").filter((m) => !m.closest(".hidden"))).toHaveLength(1);
    expect(screen.queryByText(/Opponent/)).toBeNull();
    expect(screen.queryByText("Waiting…")).toBeNull();
  });

  it("Give up emits give_up while playing", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", soloState());
    await user.click(screen.getByRole("button", { name: "Give up" }));
    expect(socket.__emitted.some((e) => e.event === "give_up")).toBe(true);
  });

  it("game over shows my score out of total and Play again restarts in place", async () => {
    const user = userEvent.setup();
    renderMatch();
    socket.__server("room_state", soloState());
    socket.__server("game_over", { winnerId: "a", scores: { a: 12 } });

    expect(screen.getByText("Round over")).toBeInTheDocument();
    expect(screen.queryByText("You win!")).toBeNull();
    expect(screen.getByTestId("my-final-score").textContent).toContain("12");
    expect(screen.getByTestId("my-final-score").textContent).toContain("/ 196");

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(socket.__emitted.some((e) => e.event === "request_rematch")).toBe(true);

    // Server restarts the round: overlay gives way to the countdown.
    socket.__server("room_state", soloState({ phase: "countdown" }));
    socket.__server("countdown", { seconds: 3 });
    expect(screen.queryByText("Round over")).toBeNull();
    expect(screen.getByTestId("countdown-overlay")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("<Match> showdown", () => {
  const sdState = (over: Partial<RoomState> = {}) =>
    roomState({
      settings: { categoryId: "countries", mode: "showdown", timeLimitSeconds: 300, turnSeconds: 30, lives: 3 },
      players: THREE,
      lives: { a: 3, b: 3, c: 3 },
      endsAt: Date.now() + 30_000,
      prompt: { id: "island", label: "Island nations", total: 46 },
      ...over,
    });

  beforeEach(() => {
    socket = createMockSocket();
    identity = { playerId: "a", slot: "p1", reconnectToken: "tok" };
    navigate.mockClear();
    setIdentity.mockClear();
  });

  it("shows every player's live count and the prompt", () => {
    renderMatch();
    socket.__server("room_state", sdState());
    socket.__server("round_started", { endsAt: Date.now() + 30_000, round: 1 });
    socket.__server("score_update", { scores: { a: 2, b: 5, c: 1 } });
    expect(screen.getByTestId("lives-a")).toHaveTextContent("2");
    expect(screen.getByTestId("lives-b")).toHaveTextContent("5");
    expect(screen.getByText("Island nations")).toBeInTheDocument();
  });

  it("shows the round-result overlay marking who lost a heart", () => {
    renderMatch();
    socket.__server("room_state", sdState());
    socket.__server("round_started", { endsAt: Date.now() + 30_000, round: 1 });
    socket.__server("round_result", {
      counts: { a: 5, b: 5, c: 1 },
      losers: ["c"],
      eliminated: [],
      tie: false,
      nextInMs: 3000,
    });
    expect(screen.getByText("Round over")).toBeInTheDocument();
    expect(screen.getByTestId("round-row-c")).toHaveTextContent("♥"); // "−1 ♥"
  });

  it("disables the input between rounds and re-enables it on a new round", () => {
    renderMatch();
    socket.__server("room_state", sdState());
    socket.__server("round_started", { endsAt: Date.now() + 30_000, round: 1 });
    expect(screen.getByLabelText("Country guess")).toBeEnabled();

    // Round ends → pause → input off.
    socket.__server("round_result", {
      counts: { a: 1, b: 1, c: 1 },
      losers: [],
      eliminated: [],
      tie: true,
      nextInMs: 3000,
    });
    expect(screen.getByLabelText("Country guess")).toBeDisabled();

    // Next round → input back on.
    socket.__server("round_started", { endsAt: Date.now() + 30_000, round: 2 });
    expect(screen.getByLabelText("Country guess")).toBeEnabled();
  });
});
