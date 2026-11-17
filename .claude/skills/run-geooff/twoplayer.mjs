// Two-player headless smoke test for geooff: two separate Chromium instances
// play a full match (lobby → countdown → play → refresh/reconnect → game over
// → rematch → leave → solo). Requires server (:3001) and web (:5173) running.
// Exit code 1 if any check fails.
import fs from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SHOTS = (process.env.SHOTS_DIR ?? "./shots").replace(/\/?$/, "/");
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

// Two fully separate browser instances = two players.
const launch = async (label) => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.errors = [];
  page.on("console", (m) => m.type() === "error" && page.errors.push(`[${label}] ${m.text()}`));
  page.on("pageerror", (e) => page.errors.push(`[${label}] ${e.message}`));
  return { browser, page };
};
const A = await launch("Alice");
const B = await launch("Bob");
const a = A.page, b = B.page;
const shot = (p, n) => p.screenshot({ path: `${SHOTS}${n}.png` });
const maps = (p) => p.locator('[data-testid="world-map"]:visible');
const filled = (p, idx, iso) =>
  maps(p).nth(idx).locator(`path[data-iso="${iso}"]`).getAttribute("data-filled");
const guess = async (p, text) => {
  const input = p.getByLabel("Country guess");
  await input.fill(text);
  await input.press("Enter");
};

try {
  // --- Home → create ---
  await a.goto(APP);
  await a.getByPlaceholder("Enter a name").fill("Alice");
  await a.getByRole("button", { name: "Create a game" }).click();
  await a.waitForURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 10000 });
  const code = a.url().split("/").pop();
  check("Alice creates a room", true, code);

  // --- Bob joins by code ---
  await b.goto(APP);
  await b.getByPlaceholder("Enter a name").fill("Bob");
  await b.getByPlaceholder("ROOM CODE").fill(code);
  await b.getByRole("button", { name: "Join" }).click();
  await b.waitForURL(new RegExp(`/room/${code}$`));
  await a.getByText("Bob").waitFor({ timeout: 5000 });
  await b.getByText("Alice").waitFor({ timeout: 5000 });
  check("Both players see each other in lobby", true);
  check("Bob did NOT get 'room full' (StrictMode fix)", !(await b.getByText(/already full/).isVisible()));

  // --- Settings + ready + start ---
  await a.getByRole("button", { name: "1 min" }).click();
  await b.getByRole("button", { name: "Ready up" }).click();
  await a.getByRole("button", { name: "Ready up" }).click();
  await a.getByRole("button", { name: "Start game" }).waitFor({ timeout: 5000 });
  await shot(a, "1-lobby-alice");
  await shot(b, "1-lobby-bob");
  check("Guest sees settings read-only", await b.getByText("Only the host can change settings.").isVisible());
  await a.getByRole("button", { name: "Start game" }).click();

  await Promise.all([a.waitForURL(/\/game\//), b.waitForURL(/\/game\//)]);
  await shot(b, "2-countdown-bob");
  const input = (p) => p.getByLabel("Country guess");
  check("Input disabled during countdown", await input(a).isDisabled());
  await Promise.all([
    input(a).waitFor({ state: "visible" }).then(() => a.waitForFunction(() => !document.querySelector('[aria-label="Country guess"]').disabled, null, { timeout: 8000 })),
    b.waitForFunction(() => !document.querySelector('[aria-label="Country guess"]').disabled, null, { timeout: 8000 }),
  ]);
  check("Both inputs enabled after 3-2-1", true);

  // --- Play ---
  await guess(a, "france");
  await a.waitForFunction(() => document.querySelector('[aria-label="Country guess"]').value === "");
  check("Correct guess clears input", true);
  check("France filled on Alice's own map", (await filled(a, 0, "fr")) === "true");
  await b.waitForFunction(() => [...document.querySelectorAll('[data-testid="world-map"]')]
    .some((m) => m.offsetParent && m.querySelector('path[data-iso="fr"][data-filled="true"]')), null, { timeout: 3000 });
  check("France appears live on Bob's opponent map", (await filled(b, 1, "fr")) === "true" && (await filled(b, 0, "fr")) === "false");

  await guess(a, "atlantis");
  await a.getByText("Not a match").waitFor({ timeout: 3000 });
  check("Wrong guess rejected, text kept", (await input(a).inputValue()) === "atlantis");
  await guess(a, "France");
  await a.getByText("Already named").waitFor({ timeout: 3000 });
  check("Duplicate rejected", true);

  for (const g of ["usa", "Côte d'Ivoire", "japan"]) {
    await guess(b, g);
    await b.waitForFunction(() => document.querySelector('[aria-label="Country guess"]').value === "", null, { timeout: 3000 });
  }
  check("Bob's aliases accepted (usa, Côte d'Ivoire)", (await filled(b, 0, "us")) === "true" && (await filled(b, 0, "ci")) === "true");
  await a.waitForTimeout(300);
  const scoreText = await a.locator("main > div").first().innerText();
  check("Score bar shows 1 vs 3", /1\s*\/\s*197/.test(scoreText) && /3\s*\/\s*197/.test(scoreText), scoreText.replace(/\n/g, " | "));
  check("Unguessed country has no answer tooltip", (await maps(a).nth(0).locator('path[data-iso="de"] title').count()) === 0);
  await shot(a, "3-playing-alice");
  await shot(b, "3-playing-bob");

  // --- Bob refreshes mid-match (reconnect) ---
  await b.reload();
  await b.waitForFunction(() => [...document.querySelectorAll('[data-testid="world-map"]')]
    .some((m) => m.offsetParent && m.querySelector('path[data-iso="jp"][data-filled="true"]')), null, { timeout: 8000 });
  check("Bob's refresh rehydrates his map (reconnect token)", (await filled(b, 0, "jp")) === "true" && (await filled(b, 1, "fr")) === "true");
  const bScore = await b.locator("main > div").first().innerText();
  check("Total survives refresh (not '/ 0')", /\/\s*197/.test(bScore), bScore.replace(/\n/g, " | "));
  await guess(b, "germany");
  await b.waitForFunction(() => document.querySelector('[aria-label="Country guess"]').value === "", null, { timeout: 3000 });
  check("Bob can still score after refresh", (await filled(b, 0, "de")) === "true");
  await shot(b, "4-after-refresh-bob");

  // --- Wait for the 1-minute timer to end ---
  console.log("…waiting for round timer to expire (~1 min)");
  await Promise.all([
    a.getByRole("heading", { name: /You win|You lose|tie/ }).waitFor({ timeout: 75000 }),
    b.getByRole("heading", { name: /You win|You lose|tie/ }).waitFor({ timeout: 75000 }),
  ]);
  const ra = await a.getByRole("heading", { name: /You win|You lose|tie/ }).innerText();
  const rb = await b.getByRole("heading", { name: /You win|You lose|tie/ }).innerText();
  check("Game over: Bob wins 4-1", ra === "You lose" && rb === "You win!", `Alice="${ra}" Bob="${rb}"`);
  check("Input disabled after game over", await input(a).isDisabled());
  await shot(a, "5-gameover-alice");
  await shot(b, "5-gameover-bob");

  // --- Rematch: Bob asks first (was a deadlock) ---
  await b.getByRole("button", { name: "Rematch" }).click();
  await a.getByRole("button", { name: "Accept rematch" }).waitFor({ timeout: 3000 });
  check("Alice sees 'Accept rematch' (deadlock fixed)", await a.getByRole("button", { name: "Accept rematch" }).isEnabled());
  await a.getByRole("button", { name: "Accept rematch" }).click();
  await Promise.all([a.waitForURL(new RegExp(`/room/${code}$`)), b.waitForURL(new RegExp(`/room/${code}$`))]);
  await a.getByRole("button", { name: "Ready up" }).waitFor({ timeout: 5000 });
  check("Both back in lobby for rematch, unready", (await b.getByRole("button", { name: "Ready up" }).isVisible()));
  await shot(a, "6-rematch-lobby-alice");

  // --- Leave ---
  await b.getByRole("button", { name: "Leave" }).click();
  await b.waitForURL(APP + "/");
  await a.getByText("Waiting…").waitFor({ timeout: 5000 });
  check("Bob leaves → Alice sees empty seat", true);
  await shot(a, "7-after-leave-alice");

  // --- Solo: Bob from Home, Alice from her now-empty lobby ---
  const enabled = (p) => p.waitForFunction(
    () => document.querySelector('[aria-label="Country guess"]')?.disabled === false, null, { timeout: 8000 });
  await b.getByRole("button", { name: "Play solo" }).click();
  await b.waitForURL(/\/game\//, { timeout: 8000 });
  await enabled(b);
  check("Home → Play solo drops straight into a round", true);
  check("Solo shows a single map", (await maps(b).count()) === 1);
  await guess(b, "brazil");
  await b.waitForFunction(() => document.querySelector('[aria-label="Country guess"]').value === "", null, { timeout: 3000 });
  await shot(b, "8-solo-playing-bob");
  await b.getByRole("button", { name: "Give up" }).click();
  await b.getByRole("heading", { name: "Round over" }).waitFor({ timeout: 3000 });
  const soloScore = await b.getByTestId("my-final-score").innerText();
  check("Solo results show score out of total", /1\s*\/\s*197/.test(soloScore), soloScore);
  await shot(b, "9-solo-over-bob");
  await b.getByRole("button", { name: "Play again" }).click();
  await enabled(b);
  check("Play again restarts the solo round in place",
    /\/game\//.test(b.url()) && (await filled(b, 0, "br")) === "false");

  await a.getByRole("button", { name: "Play solo" }).click();
  await a.waitForURL(/\/game\//, { timeout: 8000 });
  await enabled(a);
  check("Lobby → Play solo works for a host left alone", (await maps(a).count()) === 1);
} catch (e) {
  check("Unexpected error", false, e.message.split("\n")[0]);
  await shot(a, "error-alice").catch(() => {});
  await shot(b, "error-bob").catch(() => {});
} finally {
  const errs = [...a.errors, ...b.errors];
  check("No browser console errors", errs.length === 0, errs.slice(0, 5).join(" ; "));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await A.browser.close();
  await B.browser.close();
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
