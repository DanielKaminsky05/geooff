// Two-player smoke runs of the turn/round-based modes, back to back in one room
// (~45s): Last Standing (5s turns, sudden death) → rematch → Showdown (Europe,
// 10s rounds, 1 life). Exit code 1 if any check fails.
import {
  check, launch, shot, btn, input, maps, filled, filledCount, resultHeading,
  guess, guessOk, waitEnabled, waitFilled, createLobby, joinLobby,
  readyAndStart, pickSetting, until, finish, onError,
} from "./lib.mjs";

const A = await launch("Alice");
const B = await launch("Bob");
const a = A.page, b = B.page;
const turnLabel = (p) => p.getByText(/^(Your turn|\w+'s turn)$/);

// Every European country: whatever the showdown prompt, some of these match it
// (prompts guarantee ≥ 8 valid answers in the category).
const EUROPE = [
  "france", "germany", "italy", "spain", "portugal", "united kingdom", "ireland", "netherlands",
  "belgium", "luxembourg", "switzerland", "austria", "poland", "czechia", "slovakia", "hungary",
  "romania", "bulgaria", "greece", "croatia", "slovenia", "serbia", "bosnia and herzegovina",
  "montenegro", "albania", "north macedonia", "kosovo", "moldova", "ukraine", "belarus",
  "lithuania", "latvia", "estonia", "finland", "sweden", "norway", "denmark", "iceland", "russia",
  "malta", "cyprus", "monaco", "andorra", "liechtenstein", "san marino", "vatican city",
];

try {
  const code = await createLobby(a, "Alice");
  await joinLobby(b, "Bob", code);
  await a.getByText("Bob", { exact: true }).waitFor({ timeout: 5000 });

  // ---------------- Last Standing ----------------
  await pickSetting(a, b, "Last Standing");
  check("Last Standing: lobby swaps time limit for turn time",
    (await a.getByText("Turn time", { exact: true }).isVisible()) && !(await btn(a, "1 min").isVisible()) &&
      !(await a.getByText("Lives", { exact: true }).isVisible()));
  await pickSetting(a, b, "5s");
  await shot(b, "m1-lobby-laststanding-bob");
  await readyAndStart(a, [a, b]);
  await turnLabel(a).waitFor({ timeout: 8000 });
  check("Host moves first", (await turnLabel(a).innerText()) === "Your turn" && (await turnLabel(b).innerText()) === "Alice's turn",
    `Alice sees "${await turnLabel(a).innerText()}", Bob sees "${await turnLabel(b).innerText()}"`);
  check("One shared map", (await maps(a).count()) === 1);
  await waitEnabled(a);
  await guessOk(a, "france");
  await waitFilled(b, "fr", 3000);
  check("Alice's claim shows on Bob's shared map", (await filled(b, 0, "fr")) === "true");
  await until(async () => (await turnLabel(b).innerText()) === "Your turn", 3000);
  check("Turn passes to Bob", (await turnLabel(b).innerText()) === "Your turn");
  await waitEnabled(b);
  await guess(b, "France");
  const dupMsg = await b.getByText("Already named", { exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false);
  check("Bob can't re-claim France ('Already named', turn stays his)", dupMsg && (await turnLabel(b).innerText()) === "Your turn");
  await shot(b, "m2-laststanding-bob-turn");
  console.log("…Bob lets his 5s turn run out");
  await Promise.all([resultHeading(a).waitFor({ timeout: 12000 }), resultHeading(b).waitFor({ timeout: 12000 })]);
  const la = await resultHeading(a).innerText(), lb = await resultHeading(b).innerText();
  check("Bob times out → eliminated, Alice wins", la === "You win!" && lb === "You lose", `Alice="${la}" Bob="${lb}"`);
  await shot(a, "m3-laststanding-over-alice");

  // ---------------- Rematch → Showdown ----------------
  await btn(a, "Rematch").click();
  await btn(b, "Accept rematch").click();
  await Promise.all([a.waitForURL(new RegExp(`/room/${code}$`)), b.waitForURL(new RegExp(`/room/${code}$`))]);
  await pickSetting(a, b, "Showdown");
  await pickSetting(a, b, "Europe");
  check("Showdown: lobby shows Round time + Lives",
    (await a.getByText("Round time", { exact: true }).isVisible()) && (await a.getByText("Lives", { exact: true }).isVisible()));
  await pickSetting(a, b, "10s");
  await pickSetting(a, b, "1");
  await pickSetting(a, b, "Showdown"); // still selected after the set change
  await shot(a, "m4-lobby-showdown-alice");
  await readyAndStart(a, [a, b]);
  await Promise.all([waitEnabled(a), waitEnabled(b)]);
  const banner = b.getByTestId("prompt-banner");
  await banner.waitFor({ timeout: 3000 });
  const prompt = (await banner.innerText()).replace(/\n/g, " ");
  check("Prompt banner shown to both", await a.getByTestId("prompt-banner").isVisible(), prompt);

  // Bob sprays European countries (≤ 6/s to stay under the answer rate limit)
  // until one matches the prompt; Alice names nothing.
  let tried = 0;
  for (const g of EUROPE) {
    if ((await filledCount(b)) > 0) break;
    await guess(b, g);
    tried++;
    await b.waitForTimeout(200);
  }
  const bobCount = await filledCount(b);
  check("Bob names at least one answer to the prompt", bobCount > 0, `after ${tried} tries`);
  check("Alice's own board stays empty (opponents' answers are hidden)", (await filledCount(a)) === 0);
  await shot(b, "m5-showdown-playing-bob");
  await shot(a, "m5-showdown-playing-alice");
  console.log("…waiting for the 10s round to end");
  await Promise.all([resultHeading(a).waitFor({ timeout: 20000 }), resultHeading(b).waitFor({ timeout: 20000 })]);
  const sa = await resultHeading(a).innerText(), sb = await resultHeading(b).innerText();
  check("Fewest answers loses the only heart → Bob wins", sa === "You lose" && sb === "You win!", `Alice="${sa}" Bob="${sb}"`);
  await shot(a, "m6-showdown-over-alice");
  check("Input disabled after game over", await input(b).isDisabled());
} catch (e) {
  await onError(e, [A, B]);
} finally {
  await finish([A, B]);
}
