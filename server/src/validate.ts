/**
 * Centralized, hand-written validation for client → server socket payloads.
 *
 * Every parse function takes the raw (untrusted) payload and returns either a
 * sanitized, fully-typed payload or `null` when the shape is invalid. The
 * socket layer answers `null` with `error_msg { code: "bad_payload" }`.
 *
 * Rules shared by every parser:
 *  - The payload must be a plain object (arrays / primitives are rejected),
 *    except where noted (create_room tolerates a missing payload).
 *  - Optional fields treat `undefined` and `null` as "absent".
 *  - A present field of the wrong type rejects the whole payload — nothing is
 *    coerced with `toString()`, so e.g. `{ code: {} }` can't sneak through.
 *
 * Domain checks that already have their own error codes (unknown category →
 * "bad_category", unknown mode → "bad_mode") stay in the handlers; the parsers
 * only guarantee the TYPES those handlers rely on.
 */

/** Max characters of a player name, after trimming surrounding whitespace. */
export const MAX_NAME_LENGTH = 40;
/** Max characters of a submitted answer; longer text is rejected as wrong. */
export const MAX_ANSWER_LENGTH = 100;
/** Room codes are 6 chars; anything far longer can't match, so reject early. */
export const MAX_CODE_LENGTH = 32;
/** Reconnect tokens are UUIDs (36 chars); allow a little headroom. */
export const MAX_TOKEN_LENGTH = 128;

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function absent(v: unknown): v is undefined | null {
  return v === undefined || v === null;
}

/** Sentinel for "field present but invalid". */
const INVALID = Symbol("invalid");

function optString(v: unknown): string | undefined | typeof INVALID {
  if (absent(v)) return undefined;
  return typeof v === "string" ? v : INVALID;
}

function optNumber(v: unknown): number | undefined | typeof INVALID {
  if (absent(v)) return undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : INVALID;
}

function optBoolean(v: unknown): boolean | undefined | typeof INVALID {
  if (absent(v)) return undefined;
  return typeof v === "boolean" ? v : INVALID;
}

/**
 * Sanitize a player name: trim, cap at MAX_NAME_LENGTH characters (by code
 * point, so a surrogate pair is never split), trim again; empty → fallback.
 */
export function sanitizeName(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  const capped = Array.from(raw.trim()).slice(0, MAX_NAME_LENGTH).join("").trim();
  return capped || fallback;
}

/* ------------------------------------------------------------------ */
/* Per-event parsers                                                   */
/* ------------------------------------------------------------------ */

export interface CreateRoomPayload {
  playerName: string;
  solo: boolean;
}

/** create_room: a missing payload is tolerated (default name, not solo). */
export function parseCreateRoom(payload: unknown): CreateRoomPayload | null {
  if (absent(payload)) return { playerName: sanitizeName(undefined, "Player 1"), solo: false };
  if (!isPlainObject(payload)) return null;
  const name = optString(payload.playerName);
  const solo = optBoolean(payload.solo);
  if (name === INVALID || solo === INVALID) return null;
  return { playerName: sanitizeName(name, "Player 1"), solo: solo ?? false };
}

export interface JoinRoomPayload {
  code: string; // upper-cased
  playerName: string;
  reconnectToken?: string;
}

export function parseJoinRoom(payload: unknown): JoinRoomPayload | null {
  if (!isPlainObject(payload)) return null;
  const { code, playerName, reconnectToken } = payload;
  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) return null;
  const name = optString(playerName);
  const token = optString(reconnectToken);
  if (name === INVALID || token === INVALID) return null;
  if (token !== undefined && token.length > MAX_TOKEN_LENGTH) return null;
  const out: JoinRoomPayload = {
    code: code.trim().toUpperCase(),
    playerName: sanitizeName(name, "Player 2"),
  };
  if (token) out.reconnectToken = token;
  return out;
}

export interface SetReadyPayload {
  ready: boolean;
}

export function parseSetReady(payload: unknown): SetReadyPayload | null {
  if (!isPlainObject(payload)) return null;
  if (typeof payload.ready !== "boolean") return null;
  return { ready: payload.ready };
}

/**
 * update_settings: every field optional. `categoryId` / `mode` are only
 * type-checked here (strings); the handler checks membership so it can keep
 * its specific "bad_category" / "bad_mode" errors.
 */
export interface UpdateSettingsPayload {
  timeLimitSeconds?: number;
  categoryId?: string;
  mode?: string;
  turnSeconds?: number;
  lives?: number;
}

export function parseUpdateSettings(payload: unknown): UpdateSettingsPayload | null {
  if (!isPlainObject(payload)) return null;
  const timeLimitSeconds = optNumber(payload.timeLimitSeconds);
  const turnSeconds = optNumber(payload.turnSeconds);
  const lives = optNumber(payload.lives);
  const categoryId = optString(payload.categoryId);
  const mode = optString(payload.mode);
  if (
    timeLimitSeconds === INVALID ||
    turnSeconds === INVALID ||
    lives === INVALID ||
    categoryId === INVALID ||
    mode === INVALID
  ) {
    return null;
  }
  const out: UpdateSettingsPayload = {};
  if (timeLimitSeconds !== undefined) out.timeLimitSeconds = timeLimitSeconds;
  if (turnSeconds !== undefined) out.turnSeconds = turnSeconds;
  if (lives !== undefined) out.lives = lives;
  if (categoryId !== undefined) out.categoryId = categoryId;
  if (mode !== undefined) out.mode = mode;
  return out;
}

export interface SubmitAnswerPayload {
  text: string;
}

/**
 * submit_answer: `text` must be a string. Length is NOT capped here — the
 * handler rejects over-long text as "wrong" (an answer_result, not an error).
 */
export function parseSubmitAnswer(payload: unknown): SubmitAnswerPayload | null {
  if (!isPlainObject(payload)) return null;
  if (typeof payload.text !== "string") return null;
  return { text: payload.text };
}
