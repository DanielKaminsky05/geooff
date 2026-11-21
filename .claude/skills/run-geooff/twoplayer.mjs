// Two-player headless smoke test for geooff: two separate Chromium instances
// play a full race (lobby → countdown → play → refresh/reconnect → game over
// → rematch → leave), then both solo entry points. Requires the server and the
// web dev server running. Exit code 1 if any check fails. ~90s (1-minute round).
import {
  APP, check, launch, shot, btn, input, maps, filled, scoreBar, resultHeading,
  guess, guessOk, waitEnabled, waitFilled, createLobby, joinLobby, emptySeats,
  pickSetting, until, finish, onError,
} from "./lib.mjs";

const A = await launch("Alice");
const B = await launch("Bob");
const a = A.page, b = B.page;

try {
  // --- Home → create, Bob joins by code ---
  const code = await createLobby(a, "Alice");
  check("Alice creates a room", true, code);
  check("Host alone: start is 'Waiting for a player…' and disabled",
    await btn(a, "Waiting for a player…").isDisabled());

  await joinLobby(b, "Bob", code);
  await a.getByText("Bob", { exact: true }).waitFor({ timeout: 5000 });
  await b.getByText("Alice", { exact: true }).waitFor({ timeout: 5000 });
  check("Both players see each other in lobby", true);
  check("Lobby shows 4 seats, 2 empty", (await emptySeats(a)) === 2);
  check("Bob did NOT get 'room full'", !(await b.getByText(/already full/).isVisible()));

  // --- Settings + ready + start ---
  await pickSetting(a, b, "Race");
  await pickSetting(a, b, "1 min");
  check("Guest sees settings read-only",
    (await b.getByText("Only the host can change settings.").isVisible()) && (await btn(b, "3 min").isDisabled()));
  await btn(b, "Ready up").click();
  await btn(a, "Waiting for everyone to ready up…").waitFor({ timeout: 5000 });
  check("Host start disabled until everyone is ready", await btn(a, "Waiting for everyone to ready up…").isDisabled());
  await shot(a, "1-lobby-alice");
  await shot(b, "1-lobby-bob");
  await btn(a, "Ready up").click();
  await btn(a, "Start game").click();
  await Promise.all([a.waitForURL(/\/game\//), b.waitForURL(/\/game\//)]);
  await shot(b, "2-countdown-bob");
  check("Input disabled during countdown", await input(a).isDisabled());
  await Promise.all([waitEnabled(a), waitEnabled(b)]);
  check("Both inputs enabled after 3-2-1", true);

  // --- Play ---
  await guessOk(a, "france");
  check("Correct guess clears input", true);
  await waitFilled(a, "fr", 3000);
  check("France filled on Alice's own map", (await filled(a, 0, "fr")) === "true");
  await waitFilled(b, "fr", 3000);
  check("France appears live on Bob's opponent map",
    (await filled(b, 1, "fr")) === "true" && (await filled(b, 0, "fr")) === "false");

  await guess(a, "atlantis");
  await a.getByText("Not a match").waitFor({ timeout: 3000 });
  check("Wrong guess rejected, text kept", (await input(a).inputValue()) === "atlantis");
  await guess(a, "France");
  await a.getByText("Already named").waitFor({ timeout: 3000 });
  check("Duplicate rejected", true);

  for (const g of ["usa", "Côte d'Ivoire", "japan"]) await guessOk(b, g);
  await waitFilled(b, "jp", 3000).catch(() => {}); // the field clears before the map repaints
  check("Bob's aliases accepted (usa, Côte d'Ivoire)",
    (await filled(b, 0, "us")) === "true" && (await filled(b, 0, "ci")) === "true");
  await until(async () => /3\s*\/\s*197/.test(await scoreBar(a).innerText()), 3000);
  const scoreText = await scoreBar(a).innerText();
  check("Score bar shows 1 vs 3", /1\s*\/\s*197/.test(scoreText) && /3\s*\/\s*197/.test(scoreText), scoreText.replace(/\n/g, " | "));
  check("Unguessed country has no answer tooltip", (await maps(a).nth(0).locator('path[data-iso="de"] title').count()) === 0);
  check("Opponent's map reveals no names", (await maps(b).nth(1).locator('path[data-iso="fr"] title').count()) === 0);
  await shot(a, "3-playing-alice");
  await shot(b, "3-playing-bob");

  // --- Bob refreshes mid-match (reconnect token) ---
  await b.reload();
  await waitFilled(b, "jp");
  check("Bob's refresh rehydrates his map (reconnect token)",
    (await filled(b, 0, "jp")) === "true" && (await filled(b, 1, "fr")) === "true");
  const bScore = await scoreBar(b).innerText();
  check("Total survives refresh (not '/ 0')", /\/\s*197/.test(bScore), bScore.replace(/\n/g, " | "));
  await waitEnabled(b);
  await guessOk(b, "germany");
  await waitFilled(b, "de", 3000).catch(() => {});
  check("Bob can still score after refresh", (await filled(b, 0, "de")) === "true");
  await shot(b, "4-after-refresh-bob");

  const secs = async (p) => {
    const [m, s] = (await p.getByTestId("timer").innerText()).split(":").map(Number);
    return m * 60 + s;
  };
  const t0 = await secs(a);
  await a.waitForTimeout(2500);
  const t1 = await secs(a);
  check("Round timer counts down", t1 <= t0 - 2 && t1 > 0, `${t0}s → ${t1}s`);

  // --- Wait for the 1-minute timer to end ---
  console.log("…waiting for round timer to expire (~1 min)");
  await Promise.all([resultHeading(a).waitFor({ timeout: 75000 }), resultHeading(b).waitFor({ timeout: 75000 })]);
  const ra = await resultHeading(a).innerText();
  const rb = await resultHeading(b).innerText();
  check("Game over: Bob wins", ra === "You lose" && rb === "You win!", `Alice="${ra}" Bob="${rb}"`);
  const fa = await a.getByTestId("my-final-score").innerText();
  const fo = await a.getByTestId("opp-final-score").innerText();
  check("Final scores 1 vs 4", fa === "1" && fo === "4", `Alice=${fa} Bob=${fo}`);
  check("Input disabled after game over", await input(a).isDisabled());
  await shot(a, "5-gameover-alice");
  await shot(b, "5-gameover-bob");

  // --- Rematch: Bob asks first ---
  await btn(b, "Rematch").click();
  await btn(b, "Waiting for opponent…").waitFor({ timeout: 3000 });
  await btn(a, "Accept rematch").waitFor({ timeout: 3000 });
  check("Alice sees 'Accept rematch'", await btn(a, "Accept rematch").isEnabled());
  await btn(a, "Accept rematch").click();
  await Promise.all([a.waitForURL(new RegExp(`/room/${code}$`)), b.waitForURL(new RegExp(`/room/${code}$`))]);
  await btn(a, "Ready up").waitFor({ timeout: 5000 });
  check("Both back in lobby for rematch, unready", await btn(b, "Ready up").isVisible());
  await shot(a, "6-rematch-lobby-alice");

  // --- Leave ---
  await btn(b, "Leave").click();
  await b.waitForURL(APP + "/");
  await btn(a, "Waiting for a player…").waitFor({ timeout: 5000 });
  check("Bob leaves → Alice sees 3 empty seats and is alone",
    (await emptySeats(a)) === 3 && !(await a.getByText("Bob", { exact: true }).isVisible()));
  await shot(a, "7-after-leave-alice");

  // --- Solo from Home: solo setup → Start → play → give up → play again ---
  await btn(b, "Play solo").click();
  await b.waitForURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 8000 });
  await btn(b, "Start").waitFor({ timeout: 5000 });
  check("Play solo opens a solo setup (no room code / seats)",
    !(await b.getByText("Room code").isVisible()) && (await emptySeats(b)) === 0);
  check("Solo modes: Race + Gauntlet only",
    (await btn(b, "Gauntlet").isVisible()) && !(await btn(b, "Last Standing").isVisible()) && !(await btn(b, "Showdown").isVisible()));
  await btn(b, "Start").click();
  await b.waitForURL(/\/game\//, { timeout: 8000 });
  await waitEnabled(b);
  check("Solo Start drops into a round", true);
  check("Solo shows a single map", (await maps(b).count()) === 1);
  await guessOk(b, "brazil");
  await shot(b, "8-solo-playing-bob");
  await btn(b, "Give up").click();
  await b.getByRole("heading", { name: "Round over" }).waitFor({ timeout: 3000 });
  const soloScore = await b.getByTestId("my-final-score").innerText();
  check("Solo results show score out of total", /1\s*\/\s*197/.test(soloScore), soloScore.replace(/\n/g, " "));
  await shot(b, "9-solo-over-bob");
  await btn(b, "Play again").click();
  await waitEnabled(b);
  check("Play again restarts the solo round in place",
    /\/game\//.test(b.url()) && (await filled(b, 0, "br")) === "false");
  await btn(b, "Give up").click();
  await btn(b, "Back to home").click();
  await b.waitForURL(APP + "/");
  check("Solo 'Back to home' returns to Home", true);
} catch (e) {
  await onError(e, [A, B]);
} finally {
  await finish([A, B]);
}
