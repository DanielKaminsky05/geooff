// Three-player race: Alice hosts, Bob + Carol join; Bob refreshes mid-game and
// rehydrates; Carol leaves mid-game (closes her browser) and the other two play
// on; game over; Alice + Bob rematch into a 2-seat lobby. ~90s (1-minute round).
import {
  check, launch, shot, btn, maps, filledCount, resultHeading,
  guessOk, waitEnabled, waitFilled, createLobby, joinLobby, emptySeats,
  readyAndStart, pickSetting, until, finish, onError,
} from "./lib.mjs";

const A = await launch("Alice");
const B = await launch("Bob");
const C = await launch("Carol");
const a = A.page, b = B.page, c = C.page;
const all = [a, b, c];

/** The race leaderboard (3-4 players) as [{ name, count, focused }], in rank order. */
const board = async (p) => {
  const rows = p.locator('[data-testid^="leaderboard-row-"]');
  const out = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const [, name, count] = (await rows.nth(i).innerText()).split("\n").map((s) => s.trim());
    out.push({ name, count: Number(count), focused: (await rows.nth(i).getAttribute("aria-pressed")) === "true" });
  }
  return out;
};
const fmt = (rows) => rows.map((r) => `${r.name}=${r.count}${r.focused ? "*" : ""}`).join(" ");
const row = (p, name) => p.locator('[data-testid^="leaderboard-row-"]').filter({ hasText: name });

try {
  // --- Lobby with three ---
  const code = await createLobby(a, "Alice");
  await joinLobby(b, "Bob", code);
  await joinLobby(c, "Carol", code);
  for (const p of all) for (const n of ["Alice", "Bob", "Carol"]) await p.getByText(n, { exact: true }).waitFor({ timeout: 5000 });
  check("Three players see each other in lobby", true, code);
  check("One empty seat left", (await emptySeats(a)) === 1);
  await pickSetting(a, c, "Race");
  await pickSetting(a, c, "1 min");
  await btn(b, "Ready up").click();
  await btn(c, "Ready up").click();
  check("Host can't start until host is ready too",
    await btn(a, "Waiting for everyone to ready up…").isDisabled());
  await shot(c, "1-lobby3-carol");
  await btn(a, "Ready up").click();
  await btn(a, "Start game").click();
  await Promise.all(all.map((p) => p.waitForURL(/\/game\//, { timeout: 8000 })));
  await Promise.all(all.map((p) => waitEnabled(p)));
  check("All three inputs enabled after countdown", true);
  check("3-player race shows one focused map + leaderboard",
    (await maps(a).count()) === 1 && (await board(a)).length === 3);

  // --- Play: Alice 1, Bob 2, Carol 3 ---
  await guessOk(a, "france");
  for (const g of ["usa", "japan"]) await guessOk(b, g);
  for (const g of ["brazil", "india", "china"]) await guessOk(c, g);
  const ok = await until(async () => fmt(await board(a)) === "Carol=3 Bob=2 You=1*", 4000);
  check("Alice's leaderboard ranks Carol 3, Bob 2, You 1", ok, fmt(await board(a)));
  await row(a, "Bob").click();
  await waitFilled(a, "us", 3000);
  check("Clicking Bob's row focuses his map",
    (await row(a, "Bob").getAttribute("aria-pressed")) === "true" &&
      (await maps(a).locator('path[data-iso="fr"]').getAttribute("data-filled")) === "false");
  check("Other players' maps reveal no names", (await maps(a).locator('path[data-iso="us"] title').count()) === 0);
  await shot(a, "2-focus-bob-alice");
  await row(a, "You").click();
  await waitFilled(a, "fr", 3000);
  await shot(c, "2-playing-carol");

  // --- Bob refreshes mid-game ---
  const bBefore = await filledCount(b); // a country can fill territories too (us → pr, gu, …)
  await b.reload();
  await waitFilled(b, "jp");
  await until(async () => (await board(b)).length === 3, 4000);
  check("Bob's refresh rehydrates his map and the leaderboard",
    (await filledCount(b)) === bBefore && fmt(await board(b)) === "Carol=3 You=2* Alice=1",
    `${fmt(await board(b))} filled ${bBefore} → ${await filledCount(b)}`);
  await waitEnabled(b);
  await guessOk(b, "germany");
  check("Bob scores after refresh, others see it",
    await until(async () => (await board(a)).find((r) => r.name === "Bob")?.count === 3, 3000));
  await shot(b, "3-after-refresh-bob");

  // --- Carol leaves mid-game (closes her browser) ---
  await C.browser.close();
  C.closed = true;
  const banner = a.getByRole("status").filter({ hasText: "Carol disconnected" });
  await banner.waitFor({ timeout: 5000 });
  const graceLeft = async () => Number((await banner.innerText()).match(/(\d+)s/)?.[1] ?? NaN);
  await until(async () => !Number.isNaN(await graceLeft()), 3000);
  const g0 = await graceLeft();
  check("Alice sees 'Carol disconnected — waiting …' banner", true, await banner.innerText());
  check("Bob sees it too", await b.getByRole("status").filter({ hasText: "Carol disconnected" }).isVisible());
  await guessOk(a, "italy");
  await guessOk(a, "spain");
  await guessOk(b, "canada");
  const ok2 = await until(async () => fmt(await board(a)) === "Bob=4 You=3* Carol=3", 3000);
  check("Remaining two keep playing (Bob 4, Alice 3, Carol frozen at 3)", ok2, fmt(await board(a)));
  await shot(a, "4-after-carol-left-alice");
  await a.waitForTimeout(1500);
  const g1 = await graceLeft();
  check("Grace countdown starts at ≤60s (server grace) and ticks down", g0 <= 60 && g1 < g0, `${g0}s → ${g1}s`);

  // --- Game over ---
  console.log("…waiting for round timer to expire (~1 min)");
  await Promise.all([resultHeading(a).waitFor({ timeout: 75000 }), resultHeading(b).waitFor({ timeout: 75000 })]);
  const ra = await resultHeading(a).innerText();
  const rb = await resultHeading(b).innerText();
  check("Game over: Bob wins", ra === "You lose" && rb === "You win!", `Alice="${ra}" Bob="${rb}"`);
  await a.waitForTimeout(500); // let the post-game room_state (Carol swept) land
  const dialogA = (await a.getByRole("dialog").innerText()).replace(/\n+/g, " | ");
  console.log(`      (Alice's game-over card: ${dialogA})`);
  check("Final card has Alice 3 and Bob 4", /Alice \| 3/.test(dialogA) && /Bob \| 4/.test(dialogA));
  await shot(a, "5-gameover-alice");
  await shot(b, "5-gameover-bob");

  // --- Rematch between the remaining two ---
  await btn(a, "Rematch").click();
  await btn(b, "Accept rematch").waitFor({ timeout: 3000 });
  check("Bob sees 'Accept rematch' (Carol doesn't block it)", true);
  await btn(b, "Accept rematch").click();
  await Promise.all([a.waitForURL(new RegExp(`/room/${code}$`)), b.waitForURL(new RegExp(`/room/${code}$`))]);
  await btn(a, "Ready up").waitFor({ timeout: 5000 });
  await shot(a, "6-rematch-lobby-alice");
  const seatsOk = await until(async () => (await emptySeats(a)) === 2, 3000);
  const carolShown = await a.getByText("Carol", { exact: true }).isVisible();
  check("Rematch lobby has Alice + Bob, Carol gone (2 empty seats)",
    seatsOk && !carolShown && (await b.getByText("Alice", { exact: true }).isVisible()),
    `empty seats=${await emptySeats(a)} carolShown=${carolShown}`);
  await readyAndStart(a, [a, b]);
  await Promise.all([waitEnabled(a), waitEnabled(b)]);
  check("Rematch starts as a 1-v-1 (two maps side by side)", (await maps(a).count()) === 2);
  await shot(a, "7-rematch-playing-alice");
} catch (e) {
  await onError(e, [A, B, C]);
} finally {
  await finish([A, B, C]);
}
