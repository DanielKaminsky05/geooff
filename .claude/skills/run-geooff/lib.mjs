// Shared helpers for the geooff Playwright drivers (twoplayer / threeplayer / modes).
// Selectors prefer roles, labels and data-testids over layout/CSS.
import fs from "node:fs";
import { chromium } from "playwright";

export const APP = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
export const SHOTS = (process.env.SHOTS_DIR ?? "./shots").replace(/[\\/]?$/, "/");
fs.mkdirSync(SHOTS, { recursive: true });

export const results = [];
export function check(name, ok, extra = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  return !!ok;
}

/** One fully separate browser instance per player (own sessionStorage + socket). */
export async function launch(label) {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.label = label;
  page.errors = [];
  page.on("console", (m) => m.type() === "error" && page.errors.push(`[${label}] ${m.text()}`));
  page.on("pageerror", (e) => page.errors.push(`[${label}] ${e.message}`));
  return { browser, page, label };
}

export const shot = (p, n) => p.screenshot({ path: `${SHOTS}${n}.png` }).catch(() => {});
export const btn = (p, name) => p.getByRole("button", { name, exact: true });
export const input = (p) => p.getByLabel("Country guess");
/** Visible world maps (1-v-1 race on desktop: nth(0) = mine, nth(1) = opponent). */
export const maps = (p) => p.locator('[data-testid="world-map"]:visible');
export const filled = (p, idx, iso) =>
  maps(p).nth(idx).locator(`path[data-iso="${iso}"]`).getAttribute("data-filled");
/** Distinct filled isos on a visible map (one country can be several paths). */
export const filledCount = async (p, idx = 0) =>
  new Set(await maps(p).nth(idx).locator('path[data-filled="true"]').evaluateAll((els) => els.map((e) => e.dataset.iso))).size;
/** The 1-v-1 / solo score row (the element around the round timer). */
export const scoreBar = (p) => p.getByTestId("timer").locator("xpath=../..");
export const resultHeading = (p) => p.getByRole("dialog").getByRole("heading", { name: /You win|You lose|tie/ });

export async function guess(p, text) {
  const i = input(p);
  await i.fill(text);
  await i.press("Enter");
}
/** Guess and wait until the field clears (= accepted). */
export async function guessOk(p, text, timeout = 3000) {
  await guess(p, text);
  await p.waitForFunction(
    () => document.querySelector('[aria-label="Country guess"]')?.value === "",
    null,
    { timeout },
  );
}
export const waitEnabled = (p, timeout = 8000) =>
  p.waitForFunction(() => document.querySelector('[aria-label="Country guess"]')?.disabled === false, null, {
    timeout,
  });
/** Wait until a visible map shows `iso` filled. */
export const waitFilled = (p, iso, timeout = 8000) =>
  p.waitForFunction(
    (iso) =>
      [...document.querySelectorAll('[data-testid="world-map"]')].some(
        (m) => m.offsetParent && m.querySelector(`path[data-iso="${iso}"][data-filled="true"]`),
      ),
    iso,
    { timeout },
  );

/** Home → "Start a lobby". Returns the room code. */
export async function createLobby(p, name) {
  await p.goto(APP);
  await p.getByLabel("Your name").fill(name);
  await btn(p, "Start a lobby").click();
  await p.waitForURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 10000 });
  return p.url().split("/").pop();
}

/** Home → room code → Join. */
export async function joinLobby(p, name, code) {
  await p.goto(APP);
  await p.getByLabel("Your name").fill(name);
  await p.getByPlaceholder("ROOM CODE").fill(code);
  await btn(p, "Join").click();
  await p.waitForURL(new RegExp(`/room/${code}$`));
  await btn(p, "Ready up").waitFor({ timeout: 5000 });
}

/** Seat cards with nobody in them (the lobby always renders 4 seats). */
export const emptySeats = (p) => p.getByText("Empty seat", { exact: true }).count();

/** Everyone readies up, then the host starts; waits for every page to reach /game/. */
export async function readyAndStart(host, pages) {
  for (const p of pages) await btn(p, "Ready up").click();
  await btn(host, "Start game").waitFor({ timeout: 5000 });
  await btn(host, "Start game").click();
  await Promise.all(pages.map((p) => p.waitForURL(/\/game\//, { timeout: 8000 })));
}

/** Click a lobby setting button (host) and wait until another player sees it selected. */
export async function pickSetting(host, other, name) {
  await btn(host, name).click();
  await other.waitForFunction(
    (name) =>
      [...document.querySelectorAll("button[aria-pressed]")].some(
        (b) => b.textContent.trim() === name && b.getAttribute("aria-pressed") === "true",
      ),
    name,
    { timeout: 5000 },
  );
}

/** Print the summary, close browsers, set the exit code. */
export async function finish(players) {
  const errs = players.flatMap((pl) => pl.page.errors);
  check("No browser console errors", errs.length === 0, errs.slice(0, 5).join(" ; "));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  for (const pl of players) await pl.browser.close().catch(() => {});
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

export async function onError(e, players) {
  check("Unexpected error", false, e.message.split("\n")[0]);
  for (const pl of players) if (!pl.closed) await shot(pl.page, `error-${pl.label.toLowerCase()}`);
}

/** Poll an async predicate until it's truthy (returns false on timeout, never throws). */
export async function until(fn, timeout = 5000, every = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* element not there yet */
    }
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}
