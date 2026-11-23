/**
 * Real-server integration harness.
 *
 * Boots the actual game server (server/src) in-process on an ephemeral port,
 * renders the real app routes in jsdom against it, and drives the other seats
 * with raw socket.io-client sockets. Unlike the page tests (mockSocket), event
 * ORDER and payload shapes here are exactly what the server produces.
 */
import { StrictMode, useLayoutEffect } from "react";
import type { AddressInfo } from "node:net";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { io as ioClient, type Socket } from "socket.io-client";
import { createServer, type CreateServerOptions } from "../../../../server/src/index.ts";
import { rooms, clearRoomTimers } from "../../../../server/src/rooms.ts";
import { canonicalFor, totalFor } from "../../../../server/src/sets.ts";
import { promptById, validIdsFor } from "../../../../server/src/prompts.ts";
import { SocketProvider } from "../../lib/socket";
import { SessionProvider, IDENTITY_KEY, type Identity } from "../../lib/session";
import { resetServerClock } from "../../lib/serverClock";
import type { ClientToServerEvents, ServerToClientEvents } from "../../lib/protocol";
import { AppRoutes } from "../../App";

export type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Fast-but-safe timings: every scenario stays well under a second per phase. */
export const FAST: CreateServerOptions = {
  countdownTickMs: 40,
  rateLimits: { answer: false, events: false },
};

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(options: CreateServerOptions = FAST): Promise<TestServer> {
  const server = createServer(options);
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = server.httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const room of rooms.values()) clearRoomTimers(room);
      rooms.clear();
      await new Promise<void>((resolve) => server.io.close(() => resolve()));
      await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
    },
  };
}

// Real sockets deliver events outside React's act(); React must not expect
// every update to be wrapped (testing-library's waitFor/findBy poll instead).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

// jsdom doesn't implement scrollTo (App's ScrollToTop calls it on navigation).
window.scrollTo = () => {};

/** Server-side view of a room (in-process, so tests can peek at e.g. the prompt). */
export function serverRoom(code: string) {
  const room = rooms.get(code);
  if (!room) throw new Error(`no server room ${code}`);
  return room;
}

/** Size of the countries set, as the server counts it. */
export const COUNTRIES_TOTAL = totalFor("countries");

/** The canonical (accepted) answer text for a country ISO code. */
export function countryNamed(iso: string): string {
  const name = canonicalFor("countries").get(iso);
  if (!name) throw new Error(`unknown iso ${iso}`);
  return name;
}

/** The room's active prompt as the client should see it (label + answer count). */
export function currentPrompt(code: string): { id: string; label: string; total: number } {
  const room = serverRoom(code);
  const prompt = room.currentPromptId ? promptById(room.currentPromptId) : undefined;
  if (!prompt) throw new Error(`room ${code} has no active prompt`);
  return { id: prompt.id, label: prompt.label, total: validIdsFor(prompt, room.settings.categoryId).size };
}

/** ISO codes that satisfy the room's active prompt and nobody has claimed yet. */
export function openPromptAnswers(code: string): string[] {
  const room = serverRoom(code);
  const prompt = room.currentPromptId ? promptById(room.currentPromptId) : undefined;
  if (!prompt) throw new Error(`room ${code} has no active prompt`);
  const taken = new Set<string>([
    ...(room.claimedThisPrompt ?? []),
    ...room.players.flatMap((p) => [...(p.filledThisPrompt ?? [])]),
  ]);
  return [...validIdsFor(prompt, room.settings.categoryId)].filter((iso) => !taken.has(iso)).sort();
}

/* ------------------------------------------------------------------ */
/* The app under test                                                  */
/* ------------------------------------------------------------------ */

let currentPath = "/";
function LocationProbe() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    currentPath = pathname;
  }, [pathname]);
  return null;
}

export interface AppHandle {
  unmount: () => void;
}

/**
 * Render the real app (StrictMode, real providers, real socket) at `path`.
 * `sessionStorage` / `localStorage` persist across renders, so unmount +
 * renderApp again is a page refresh.
 */
export function renderApp(url: string, path = "/"): AppHandle {
  currentPath = path;
  const r = render(
    <StrictMode>
      <SocketProvider url={url}>
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            <LocationProbe />
            <AppRoutes />
          </MemoryRouter>
        </SessionProvider>
      </SocketProvider>
    </StrictMode>,
  );
  return { unmount: () => act(() => r.unmount()) };
}

export async function waitForPath(re: RegExp, timeout = 5000): Promise<string> {
  await waitFor(() => expect(currentPath).toMatch(re), { timeout });
  return currentPath;
}

/** The identity the app persisted for this tab (what a refresh restores). */
export function storedIdentity(): Identity | null {
  const raw = sessionStorage.getItem(IDENTITY_KEY);
  return raw ? (JSON.parse(raw) as Identity) : null;
}

/** Submit a guess through the real answer field. */
export async function guess(text: string): Promise<void> {
  const input = (await screen.findByLabelText("Country guess")) as HTMLInputElement;
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

/**
 * ISO codes painted as filled on the `index`-th map in the DOM (jsdom has no
 * matchMedia, so the duel renders the desktop layout: [mine, opponent's]).
 * With no index: every filled path on every map.
 */
export function filledIsos(index?: number): string[] {
  const maps = [...document.querySelectorAll('[data-testid="world-map"]')];
  const scope = index == null ? maps : maps.slice(index, index + 1);
  return [...new Set(scope.flatMap((m) =>
    [...m.querySelectorAll('[data-filled="true"]')].map((el) => el.getAttribute("data-iso") ?? ""),
  ))].sort();
}

/* ------------------------------------------------------------------ */
/* Bots: the other players, as raw sockets                             */
/* ------------------------------------------------------------------ */

const bots: BotSocket[] = [];

export function connectBot(url: string): BotSocket {
  const s: BotSocket = ioClient(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  bots.push(s);
  return s;
}

/** Resolve on the next `event` (optionally matching `pred`). */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: BotSocket,
  event: E,
  pred: (p: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
  timeoutMs = 5000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const loose = socket as unknown as {
      on(e: string, cb: (p: unknown) => void): void;
      off(e: string, cb: (p: unknown) => void): void;
    };
    const timer = setTimeout(() => {
      loose.off(event, handler);
      reject(new Error(`bot timed out waiting for "${String(event)}"`));
    }, timeoutMs);
    const handler = (p: unknown) => {
      const payload = p as Parameters<ServerToClientEvents[E]>[0];
      if (!pred(payload)) return;
      clearTimeout(timer);
      loose.off(event, handler);
      resolve(payload);
    };
    loose.on(event, handler);
  });
}

/** Join `code` as a bot; resolves with its `joined` payload. */
export async function botJoin(url: string, code: string, name: string) {
  const s = connectBot(url);
  const joined = nextEvent(s, "joined");
  s.emit("join_room", { code, playerName: name });
  return { socket: s, ...(await joined) };
}

/** Per-test teardown: close bots, unmount the app, stop the server. */
export async function teardown(server: TestServer | undefined): Promise<void> {
  for (const b of bots.splice(0)) {
    b.removeAllListeners();
    b.disconnect();
  }
  cleanup();
  resetServerClock();
  sessionStorage.clear();
  localStorage.clear();
  await server?.close();
}

/* ------------------------------------------------------------------ */
/* Common flows                                                        */
/* ------------------------------------------------------------------ */

export type ModeLabel = "Race" | "Last Standing" | "Gauntlet" | "Showdown";

/**
 * The app (as "Alice") creates a lobby from Home, a bot ("Bob") joins it, and
 * the host picks `mode` through the real lobby UI.
 */
export async function hostLobbyWithBot(url: string, mode: ModeLabel = "Race") {
  localStorage.setItem("geofight:name", "Alice");
  // The lobby preloads the match chunk while players ready up; do it up front
  // so a cold module transform can't swallow a short countdown under load.
  await import("../../pages/Match");
  renderApp(url);
  fireEvent.click(await screen.findByRole("button", { name: "Start a lobby" }));
  const path = await waitForPath(/^\/room\/[A-Z0-9]{6}$/);
  const code = path.slice("/room/".length);
  const myId = await waitFor(() => {
    const id = storedIdentity()?.playerId;
    if (!id) throw new Error("no identity yet");
    return id;
  });
  const bob = await botJoin(url, code, "Bob");
  await screen.findByText("Bob");
  if (mode !== "Race") {
    fireEvent.click(screen.getByRole("button", { name: mode }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: mode })).toHaveAttribute("aria-pressed", "true"),
    );
  }
  return { code, myId, bob: bob.socket, bobId: bob.playerId, bobToken: bob.reconnectToken };
}

/** Both ready up (app via the UI, bot via its socket); the host starts. */
export async function readyAndStart(bot: BotSocket): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Ready up" }));
  bot.emit("set_ready", { ready: true });
  const start = await screen.findByRole("button", { name: "Start game" });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await waitForPath(/^\/game\//);
}

/** Wait until the answer field is live (Match loaded, game playing). */
export async function waitForPlaying(): Promise<HTMLInputElement> {
  const input = (await screen.findByLabelText("Country guess", {}, { timeout: 5000 })) as HTMLInputElement;
  await waitFor(() => expect(input).toBeEnabled(), { timeout: 5000 });
  return input;
}

/** A race player's score, read from their accessible progress bar. */
export function raceScore(name: string): number {
  return Number(screen.getByRole("progressbar", { name: `${name} progress` }).getAttribute("aria-valuenow"));
}
