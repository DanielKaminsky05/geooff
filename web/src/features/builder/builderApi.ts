/**
 * Trek Builder — admin REST client (Phase 3, dev-only).
 *
 * Talks to the server's token-guarded `/daily/admin/*` routes on the same origin
 * as the game API. The admin token is supplied by the caller (stored in
 * localStorage by the builder page) and sent as `x-admin-token`; it never ships
 * in the bundle. This module is only imported by the dev-only /builder route.
 */

import { DAILY_PROMPT_COUNT } from "../daily/contract";
import type { DailySet, JourneyId, DailyLandmark } from "../daily/contract";

const BASE_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";

export { DAILY_PROMPT_COUNT };

function url(path: string): string {
  return `${BASE_URL.replace(/\/$/, "")}${path}`;
}

/** One pickable prompt plus the dates it has already been used on (de-dup). */
export interface CatalogPrompt {
  id: string;
  label: string;
  usedOn: string[];
}

export interface BuilderCatalog {
  prompts: CatalogPrompt[];
  destinations: string[];
}

/** The authored payload the server validates, compiles, and stores. */
export interface AuthoredDailySet {
  dailyDate: string;
  destinationName: string;
  promptIds: string[];
  landmarks?: Partial<Record<JourneyId, DailyLandmark[]>>;
}

export interface SaveResult {
  ok: true;
  persisted: boolean;
  set: DailySet;
}

async function adminFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url(path), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "x-admin-token": token,
      ...init?.headers,
    },
  });
}

/** Load the prompt catalog (with usage) and destination names. */
export async function fetchCatalog(token: string): Promise<BuilderCatalog> {
  const res = await adminFetch("/daily/admin/catalog", token);
  if (res.status === 401) throw new Error("Unauthorized — check the admin token.");
  if (!res.ok) throw new Error(`GET /daily/admin/catalog -> ${res.status}`);
  return (await res.json()) as BuilderCatalog;
}

/** Save an authored trek. Throws with the server's reason on a 400. */
export async function saveSet(token: string, authored: AuthoredDailySet): Promise<SaveResult> {
  const res = await adminFetch("/daily/admin/sets", token, {
    method: "POST",
    body: JSON.stringify(authored),
  });
  if (res.status === 401) throw new Error("Unauthorized — check the admin token.");
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Invalid trek.");
  }
  if (!res.ok) throw new Error(`POST /daily/admin/sets -> ${res.status}`);
  return (await res.json()) as SaveResult;
}
