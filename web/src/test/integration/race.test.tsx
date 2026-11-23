import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  COUNTRIES_TOTAL,
  FAST,
  countryNamed,
  raceScore,
  filledIsos,
  guess,
  hostLobbyWithBot,
  nextEvent,
  readyAndStart,
  renderApp,
  serverRoom,
  startServer,
  storedIdentity,
  teardown,
  waitForPath,
  waitForPlaying,
  type TestServer,
} from "./harness";

let server: TestServer | undefined;
afterEach(async () => {
  await teardown(server);
  server = undefined;
});

describe("race against the real server", () => {
  it("lobby → ready → countdown → play → game over → rematch → lobby", async () => {
    // Slow enough ticks that the 3-2-1 overlay is observable; a short round so
    // the clock (not a forfeit) ends the game.
    server = await startServer({ ...FAST, countdownTickMs: 400, raceMsOverride: 2500 });
    const { code, myId, bob, bobId } = await hostLobbyWithBot(server.url);

    // Lobby reflects the bot's ready flag from the server's broadcast.
    const bobReady = nextEvent(bob, "player_ready", (p) => p.playerId === bobId && p.ready);
    await readyAndStart(bob);
    await bobReady;
    expect(storedIdentity()).toMatchObject({ playerId: myId, roomCode: code });

    // Countdown overlay, then the live game.
    expect(await screen.findByTestId("countdown-overlay")).toBeInTheDocument();
    await waitForPlaying();
    expect(screen.queryByTestId("countdown-overlay")).not.toBeInTheDocument();

    await guess(countryNamed("br"));
    await waitFor(() => expect(filledIsos(0)).toEqual(["br"]));
    await guess(countryNamed("eg"));
    await waitFor(() => expect(filledIsos(0)).toEqual(["br", "eg"]));

    // The opponent scores once; our map never shows their claims.
    const bobAccepted = nextEvent(bob, "answer_result");
    bob.emit("submit_answer", { text: countryNamed("jp") });
    expect(await bobAccepted).toMatchObject({ accepted: true, isoCode: "jp" });
    await waitFor(() => expect(raceScore("Bob")).toBe(1));
    expect(raceScore("Alice")).toBe(2);
    expect(screen.getByRole("progressbar", { name: "Alice progress" })).toHaveAttribute(
      "aria-valuemax",
      String(COUNTRIES_TOTAL),
    );
    expect(filledIsos(0)).toEqual(["br", "eg"]);
    // ...but the opponent's pane does.
    await waitFor(() => expect(filledIsos(1)).toEqual(["jp"]));

    // The race clock runs out → game over, decided by score.
    expect(await screen.findByText("You win!", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(serverRoom(code).phase).toBe("ended");

    // Rematch: we ask, the opponent accepts → both land back in the lobby.
    fireEvent.click(screen.getByRole("button", { name: "Rematch" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Waiting for opponent…" })).toBeInTheDocument());
    const rematch = nextEvent(bob, "rematch_start");
    bob.emit("request_rematch");
    await rematch;
    await waitForPath(new RegExp(`^/room/${code}$`));
    const readyUp = await screen.findByRole("button", { name: "Ready up" });
    await waitFor(() => expect(readyUp).toBeEnabled());
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // Same seat, nobody ready, back in the lobby phase.
    expect(storedIdentity()).toMatchObject({ playerId: myId, roomCode: code });
    expect(serverRoom(code).phase).toBe("lobby");
    expect(screen.getAllByText("Not ready")).toHaveLength(2);
    // The lobby's unmount safety net must not have dropped our seat on the way.
    expect(serverRoom(code).players.map((p) => p.id).sort()).toEqual([myId, bobId].sort());
  });

  it("restores the board after a refresh mid-race (remount with stored identity)", async () => {
    server = await startServer({ ...FAST, graceMs: 10_000 });
    const { code, myId, bob, bobId } = await hostLobbyWithBot(server.url);
    await readyAndStart(bob);
    await waitForPlaying();

    await guess(countryNamed("br"));
    await waitFor(() => expect(filledIsos(0)).toEqual(["br"]));

    // "Refresh": tear the whole app down (socket closes) ...
    const away = nextEvent(bob, "opponent_disconnected", (p) => p.playerId === myId);
    act(() => cleanup());
    await away;
    // ... the opponent keeps playing while we're gone ...
    const bobAccepted = nextEvent(bob, "answer_result");
    bob.emit("submit_answer", { text: countryNamed("jp") });
    await bobAccepted;

    // ... and the page comes back on /game/:code with only sessionStorage.
    expect(storedIdentity()).toMatchObject({ playerId: myId, roomCode: code });
    const back = nextEvent(bob, "opponent_reconnected", (p) => p.playerId === myId);
    renderApp(server.url, `/game/${code}`);
    await back;
    await waitForPlaying();
    await waitFor(() => expect(filledIsos(0)).toEqual(["br"]));
    expect(filledIsos(1)).toEqual(["jp"]);
    // Both scores rehydrated from the snapshot.
    expect(raceScore("Alice")).toBe(1);
    expect(raceScore("Bob")).toBe(1);
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
    expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument();
    // Same seat (not a fresh one) and still playable.
    expect(serverRoom(code).players.map((p) => p.id).sort()).toEqual([myId, bobId].sort());
    await guess(countryNamed("eg"));
    await waitFor(() => expect(filledIsos(0)).toEqual(["br", "eg"]));
    expect(serverRoom(code).players.find((p) => p.id === myId)?.score).toBe(2);
  });

  it('shows "Slow down!" when the server rate-limits a guess', async () => {
    // Two answers back-to-back, then (practically) no refill.
    server = await startServer({
      ...FAST,
      rateLimits: { answer: { burst: 2, refillPerSec: 0.01 }, events: false },
    });
    const { code, myId, bob } = await hostLobbyWithBot(server.url);
    await readyAndStart(bob);
    const input = await waitForPlaying();

    // Three guesses fired without waiting: the third is dropped server-side.
    await guess(countryNamed("br"));
    await guess(countryNamed("eg"));
    await guess(countryNamed("ke"));
    expect(await screen.findByText("Slow down!")).toBeInTheDocument();
    await waitFor(() => expect(filledIsos(0)).toEqual(["br", "eg"]));
    // The dropped guess is handed back (the field was empty), nothing scored.
    await waitFor(() => expect(input.value).toBe(countryNamed("ke")));
    expect(serverRoom(code).players.find((p) => p.id === myId)?.score).toBe(2);
    // A rate limit is transient: no fatal overlay, the game stays live.
    expect(screen.queryByText("Game unavailable")).not.toBeInTheDocument();
    expect(input).toBeEnabled();
  });
});
