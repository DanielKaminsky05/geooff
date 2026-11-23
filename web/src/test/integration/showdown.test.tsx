import { cleanup, screen, waitFor, within } from "@testing-library/react";
import {
  FAST,
  countryNamed,
  currentPrompt,
  filledIsos,
  guess,
  hostLobbyWithBot,
  nextEvent,
  openPromptAnswers,
  readyAndStart,
  renderApp,
  serverRoom,
  startServer,
  teardown,
  waitForPlaying,
  type BotSocket,
  type TestServer,
} from "./harness";

let server: TestServer | undefined;
afterEach(async () => {
  await teardown(server);
  server = undefined;
});

/** Bot names `isos` one by one, waiting for each to be accepted. */
async function botNames(bot: BotSocket, isos: string[]) {
  for (const iso of isos) {
    const res = nextEvent(bot, "answer_result");
    bot.emit("submit_answer", { text: countryNamed(iso) });
    expect(await res).toMatchObject({ accepted: true, isoCode: iso });
  }
}

const ROUND_MS = 3000;

describe("showdown against the real server", () => {
  it("restores round number + counts after a reconnect mid-round, never leaking the opponent's answers", async () => {
    // A comfortable reveal pause so the between-round screen is reliably observable
    // (prod is 10s; 150ms is too tight for findByText to catch the transient card).
    server = await startServer({ ...FAST, roundMsOverride: ROUND_MS, revealMsOverride: 600, graceMs: 10_000 });
    const { code, myId, bob, bobId } = await hostLobbyWithBot(server.url, "Showdown");
    const round1Result = nextEvent(bob, "round_result", () => true, ROUND_MS + 3000);
    const round2 = nextEvent(bob, "round_started", (p) => p.round === 2, ROUND_MS + 3000);
    await readyAndStart(bob);
    await waitForPlaying();
    expect(await screen.findByText("Round 1")).toBeInTheDocument();

    // Round 1: only the opponent scores → we lose a heart.
    await botNames(bob, openPromptAnswers(code).slice(0, 1));
    expect(await round1Result).toMatchObject({ losers: [myId], tie: false });
    expect(await screen.findByText("Round over")).toBeInTheDocument();
    await round2;
    expect(await screen.findByText("Round 2")).toBeInTheDocument();
    expect(screen.queryByText("Round over")).not.toBeInTheDocument();

    // Round 2: we name one, the opponent names two.
    const [mine, ...rest] = openPromptAnswers(code);
    const theirs = rest.slice(0, 2);
    await guess(countryNamed(mine));
    await waitFor(() => expect(filledIsos()).toEqual([mine]));
    await botNames(bob, theirs);
    await waitFor(() => expect(within(screen.getByTestId(`lives-${bobId}`)).getByText("2")).toBeInTheDocument());

    // Refresh mid-round.
    const away = nextEvent(bob, "opponent_disconnected", (p) => p.playerId === myId);
    cleanup();
    await away;
    const back = nextEvent(bob, "opponent_reconnected", (p) => p.playerId === myId);
    renderApp(server.url, `/game/${code}`);
    await back;
    await waitForPlaying();
    expect(serverRoom(code).round).toBe(2); // still the same round

    // Round number, both tallies, hearts and the prompt all come back.
    expect(await screen.findByText("Round 2")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByTestId(`lives-${myId}`)).getByText("1")).toBeInTheDocument();
      expect(within(screen.getByTestId(`lives-${bobId}`)).getByText("2")).toBeInTheDocument();
    });
    expect(screen.getByRole("img", { name: "You: 4 of 5 lives" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Bob: 5 of 5 lives" })).toBeInTheDocument();
    expect(screen.getByTestId("prompt-banner")).toHaveTextContent(currentPrompt(code).label);

    // Our board is ours alone: none of the opponent's answers anywhere.
    expect(filledIsos()).toEqual([mine]);
    const html = document.body.innerHTML;
    for (const iso of theirs) {
      expect(html).not.toMatch(new RegExp(`data-iso="${iso}"[^>]*data-filled="true"`));
      expect(screen.queryByText(countryNamed(iso))).not.toBeInTheDocument();
    }

    // The round still resolves normally for the reconnected client.
    expect(await screen.findByText("Round over", {}, { timeout: ROUND_MS + 2000 })).toBeInTheDocument();
    const myRow = screen.getByTestId(`round-row-${myId}`);
    expect(myRow).toHaveTextContent("You · −1 ♥");
    expect(myRow).toHaveTextContent("1");
    expect(screen.getByTestId(`round-row-${bobId}`)).toHaveTextContent("2");
  });
});
