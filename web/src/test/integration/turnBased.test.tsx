import { screen, waitFor } from "@testing-library/react";
import {
  FAST,
  countryNamed,
  connectBot,
  currentPrompt,
  filledIsos,
  guess,
  hostLobbyWithBot,
  nextEvent,
  openPromptAnswers,
  readyAndStart,
  serverRoom,
  startServer,
  teardown,
  waitForPlaying,
  type TestServer,
} from "./harness";

let server: TestServer | undefined;
afterEach(async () => {
  await teardown(server);
  server = undefined;
});

/** The whose-turn label next to the per-turn clock in the HUD. */
function turnLabel(): string {
  const timer = screen.getByTestId("turn-timer");
  // <div><span style=color>{turnName}</span><TurnTimer/></div>
  return timer.closest("span.inline-flex")?.previousElementSibling?.textContent ?? "";
}

describe("last standing against the real server", () => {
  it("passes the turn on each accepted answer and pauses it while the current player is away", async () => {
    server = await startServer({ ...FAST, turnMsOverride: 8000, graceMs: 15_000 });
    const { code, myId, bob, bobId, bobToken } = await hostLobbyWithBot(server.url, "Last Standing");
    await readyAndStart(bob);
    await waitForPlaying();

    // The host opens.
    await waitFor(() => expect(turnLabel()).toBe("Your turn"));
    await guess(countryNamed("br"));
    await waitFor(() => expect(turnLabel()).toBe("Bob's turn"));
    expect(filledIsos()).toEqual(["br"]);

    // Off-turn: the guess is held in the field, not sent.
    const input = screen.getByLabelText("Country guess") as HTMLInputElement;
    await guess(countryNamed("eg"));
    expect(input.value).toBe(countryNamed("eg"));
    expect(serverRoom(code).players.find((p) => p.id === myId)?.score).toBe(1);

    // Bob answers → back to us; the shared map shows both claims.
    const mineAgain = nextEvent(bob, "turn_started", (p) => p.playerId === myId);
    bob.emit("submit_answer", { text: countryNamed("jp") });
    await mineAgain;
    await waitFor(() => expect(turnLabel()).toBe("Your turn"));
    await waitFor(() => expect(filledIsos()).toEqual(["br", "jp"]));

    // The held guess goes out on our turn.
    const toBob = nextEvent(bob, "turn_started", (p) => p.playerId === bobId);
    await guess(countryNamed("eg"));
    await toBob;
    await waitFor(() => expect(turnLabel()).toBe("Bob's turn"));
    expect(screen.queryByText("paused")).not.toBeInTheDocument();

    // Bob drops on his own turn → the clock freezes and the banner shows.
    bob.disconnect();
    expect(await screen.findByText("paused")).toBeInTheDocument();
    expect(await screen.findByText(/Opponent disconnected — waiting \d+s/)).toBeInTheDocument();
    expect(serverRoom(code).pausedTurnMs).toBeGreaterThan(0);
    // The frozen value holds (no countdown, no life lost).
    const frozen = screen.getByTestId("turn-timer").textContent;
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.getByTestId("turn-timer").textContent).toBe(frozen);
    expect(serverRoom(code).lives?.[bobId]).toBe(1);

    // Bob comes back with his token → his turn resumes, unpaused.
    const bob2 = connectBot(server.url);
    const rejoined = nextEvent(bob2, "joined");
    bob2.emit("join_room", { code, playerName: "Bob", reconnectToken: bobToken });
    expect(await rejoined).toMatchObject({ playerId: bobId });
    await waitFor(() => expect(screen.queryByText("paused")).not.toBeInTheDocument());
    expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument();
    expect(turnLabel()).toBe("Bob's turn");

    // Play continues: Bob answers, the turn comes back to us.
    const mine3 = nextEvent(bob2, "turn_started", (p) => p.playerId === myId);
    bob2.emit("submit_answer", { text: countryNamed("ke") });
    await mine3;
    await waitFor(() => expect(turnLabel()).toBe("Your turn"));
    await waitFor(() => expect(filledIsos()).toEqual(["br", "eg", "jp", "ke"]));
  });
});

describe("gauntlet against the real server", () => {
  it("applies prompt changes in server order (prompt before turn, board reset on cycle)", async () => {
    // Bob's turn must comfortably outlast the synchronous mid-turn assertions
    // below: a short turn lets a slow CI runner time Bob out first, and the
    // server then reveals the whole prompt — repainting the board — before we
    // read it. A generous turn keeps the mid-turn frame alive past any jitter;
    // phase B still waits exactly one of these out (well within the 20s budget).
    const TURN_MS = 8000;
    server = await startServer({ ...FAST, turnMsOverride: TURN_MS, revealMsOverride: 150 });
    const { code, myId, bob, bobId } = await hostLobbyWithBot(server.url, "Gauntlet");

    // Record the order the server emits the game's opening + cycling events.
    const seq: string[] = [];
    bob.on("prompt_changed", () => seq.push("prompt_changed"));
    bob.on("turn_started", (p) => seq.push(`turn_started:${p.playerId === myId ? "me" : "bob"}`));
    bob.on("life_lost", (p) => seq.push(`life_lost:${p.playerId === myId ? "me" : "bob"}`));

    await readyAndStart(bob);
    await waitForPlaying();

    // The opening prompt is announced before turn 1 starts. The banner render
    // and Bob's receipt of turn_started race slightly, so settle both together.
    const p1 = currentPrompt(code);
    await waitFor(() => {
      expect(screen.getByTestId("prompt-banner")).toHaveTextContent(p1.label);
      expect(seq).toEqual(["prompt_changed", "turn_started:me"]);
    });
    expect(screen.getByTestId("gauntlet-count")).toHaveTextContent(`0 / ${p1.total}`);
    await waitFor(() => expect(turnLabel()).toBe("Your turn"));

    // We claim one for prompt 1; the turn passes to Bob on the same prompt.
    const [answer] = openPromptAnswers(code);
    const toBob = nextEvent(bob, "turn_started", (p) => p.playerId === bobId);
    await guess(countryNamed(answer));
    await toBob;
    // The mid-turn state as one consistent frame: our single claim on the board,
    // the count at 1, Bob to act — all true together. A half-updated DOM (count
    // ticked but paint pending) just retries instead of failing.
    await waitFor(() => {
      expect(screen.getByTestId("gauntlet-count")).toHaveTextContent(`1 / ${p1.total}`);
      expect(filledIsos()).toEqual([answer]);
      expect(turnLabel()).toBe("Bob's turn");
    });

    // Bob times out: life_lost → prompt_changed → turn_started (to us).
    await nextEvent(bob, "turn_started", (p) => p.playerId === myId, TURN_MS + 3000);
    expect(seq).toEqual([
      "prompt_changed",
      "turn_started:me",
      "turn_started:bob",
      "life_lost:bob",
      "prompt_changed",
      "turn_started:me",
    ]);

    const p2 = currentPrompt(code);
    expect(p2.id).not.toBe(p1.id);
    // A fresh prompt is a clean slate: new banner, board + count reset, our turn,
    // Bob down a heart. Assert it as one settled frame, so the tail of the reveal
    // giving way to the next prompt can't catch us mid-transition.
    await waitFor(() => {
      expect(screen.getByTestId("prompt-banner")).toHaveTextContent(p2.label);
      expect(screen.getByTestId("gauntlet-count")).toHaveTextContent(`0 / ${p2.total}`);
      expect(filledIsos()).toEqual([]);
      expect(turnLabel()).toBe("Your turn");
      expect(screen.getByRole("img", { name: "Bob: 4 of 5 lives" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Alice: 5 of 5 lives" })).toBeInTheDocument();
    });

    // Claims now count against the new prompt.
    const [next] = openPromptAnswers(code);
    const toBob2 = nextEvent(bob, "turn_started", (p) => p.playerId === bobId);
    await guess(countryNamed(next));
    await toBob2;
    await waitFor(() => {
      expect(screen.getByTestId("gauntlet-count")).toHaveTextContent(`1 / ${p2.total}`);
      expect(filledIsos()).toEqual([next]);
    });
  });
});
