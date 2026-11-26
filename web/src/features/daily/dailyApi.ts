/**
 * Daily Trek — REST client.
 *
 * Thin typed `fetch` wrappers over the three stateless daily routes. The server
 * base URL is derived the SAME way as the socket client (`socket.tsx`): the
 * `VITE_WS_URL` env, falling back to the local dev server. Daily Trek is REST,
 * not Socket.IO, but it talks to the same backend origin.
 *
 * Dev-friendliness: a failed `GET /daily` falls back to `FIXTURE_DAILY_SET` so
 * the UI is fully developable without the server running (a warning is logged).
 * A 429 from `POST /daily/answer` is surfaced as a soft "slow down" signal
 * rather than throwing — the answer route is rate-limited per IP.
 */

import type {
  DailySet,
  DailyAnswerReq,
  DailyAnswerRes,
  DailyFinishReq,
  DailyFinishRes,
} from "./contract";
import { FIXTURE_DAILY_SET, todayIso } from "./contract";

/** Same origin as the socket client (socket.tsx). Daily Trek is REST on it. */
const BASE_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";

/** Timeout (ms) for the initial daily set fetch and the finish submission. */
const TIMEOUT_FETCH_MS = 10_000;
/** Timeout (ms) for interactive answer validation — kept shorter for responsiveness. */
const TIMEOUT_ANSWER_MS = 6_000;

/** Build an absolute URL to a daily route on the server origin. */
function url(path: string): string {
  return `${BASE_URL.replace(/\/$/, "")}${path}`;
}

/**
 * Returns an AbortSignal that fires after `ms` milliseconds.
 * Uses `AbortSignal.timeout` where available (modern browsers/Node 17+) and
 * falls back to `AbortController + setTimeout` for environments (e.g. jsdom in
 * tests) that do not expose `AbortSignal.timeout`.
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Request timed out after ${ms} ms`)), ms);
  return controller.signal;
}

/** A rejected answer response the UI can treat as a soft "slow down". */
export class RateLimitedError extends Error {
  constructor() {
    super("Too many answers — slow down a moment.");
    this.name = "RateLimitedError";
  }
}

async function postJSON(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetch(url(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * GET /daily — today's set (labels only; validIds stay server-side).
 *
 * On any network/HTTP failure, fall back to the static fixture so the client is
 * developable without the server. The fallback is dev-ergonomics only; a real
 * failure in production simply yields the fixture day, which is harmless (no
 * secret is involved) and keeps the UI from hard-crashing.
 */
export async function fetchDailySet(): Promise<DailySet> {
  try {
    const res = await fetch(url("/daily"), {
      headers: { accept: "application/json" },
      signal: timeoutSignal(TIMEOUT_FETCH_MS),
    });
    if (!res.ok) throw new Error(`GET /daily -> ${res.status}`);
    return (await res.json()) as DailySet;
  } catch (err) {
    console.warn(
      "[dailyApi] GET /daily failed — falling back to FIXTURE_DAILY_SET.",
      err,
    );
    // Re-stamp with today: FIXTURE_DAILY_SET.dailyDate is frozen at module load,
    // so a long-lived tab that crosses midnight before this fallback fires would
    // otherwise carry yesterday's date and misfire the one-and-done lock.
    return { ...FIXTURE_DAILY_SET, dailyDate: todayIso() };
  }
}

/**
 * POST /daily/answer — validate ONE guess against ONE prompt. This is the only
 * call that reads the secret valid set (hence rate-limited server-side).
 *
 * A 429 is surfaced as `RateLimitedError` so the caller can show a soft "slow
 * down" hint instead of crashing. Any other HTTP failure throws.
 */
export async function postAnswer(req: DailyAnswerReq): Promise<DailyAnswerRes> {
  const res = await postJSON("/daily/answer", req, timeoutSignal(TIMEOUT_ANSWER_MS));
  if (res.status === 429) {
    throw new RateLimitedError();
  }
  if (!res.ok) throw new Error(`POST /daily/answer -> ${res.status}`);
  return (await res.json()) as DailyAnswerRes;
}

/**
 * POST /daily/finish — hand the completed run to the server, which reconciles
 * completion bonuses + outcome and returns the synthetic percentile.
 */
export async function postFinish(req: DailyFinishReq): Promise<DailyFinishRes> {
  const res = await postJSON("/daily/finish", req, timeoutSignal(TIMEOUT_FETCH_MS));
  if (!res.ok) throw new Error(`POST /daily/finish -> ${res.status}`);
  return (await res.json()) as DailyFinishRes;
}
