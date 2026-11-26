/**
 * Trek Builder — admin REST client (Phase 3, dev-only).
 *
 * Talks to the server's token-guarded `/daily/admin/*` routes on the same origin
 * as the game API. The admin token is supplied by the caller (stored in
 * localStorage by the builder page) and sent as `x-admin-token`; it never ships
 * in the bundle. This module is only imported by the dev-only /builder route.
 */

import { DAILY_PROMPT_COUNT } from "../daily/contract";
import type { DailySet, JourneyId, DailyLandmark, GeoPoint, DailyRoute } from "../daily/contract";

const BASE_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";

export { DAILY_PROMPT_COUNT };

function url(path: string): string {
  return `${BASE_URL.replace(/\/$/, "")}${path}`;
}

/** One pickable prompt: its label, correct answers, and the dates it's been used. */
export interface CatalogPrompt {
  id: string;
  label: string;
  usedOn: string[];
  answers: string[];
}

export interface BuilderCatalog {
  prompts: CatalogPrompt[];
  /** Default temple layout per journey — the gold editor seeds from this. */
  journeyDefaults: Record<JourneyId, DailyLandmark[]>;
}

/** The authored payload the server validates, compiles, and stores. Destination
 *  and routes are drawn geometry; prompts are catalog ids. */
export interface AuthoredDailySet {
  dailyDate: string;
  destination: { name: string; at: GeoPoint };
  routes: DailyRoute[];
  promptIds: string[];
  landmarks?: Partial<Record<JourneyId, DailyLandmark[]>>;
}

export interface SaveResult {
  ok: true;
  persisted: boolean;
  set: DailySet;
}

/** A currently-published authored day (what overrides the generator now). */
export interface PublishedDay {
  dailyDate: string;
  destinationName: string;
}

/** A full authored day loaded back for editing. Routes are in game order
 *  (origin → city); the builder re-derives its city-first editor waypoints. */
export interface LoadedDay {
  dailyDate: string;
  destination: { name: string; at: GeoPoint };
  routes: DailyRoute[];
  promptIds: string[];
  landmarks: Record<JourneyId, DailyLandmark[]>;
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

/** Load the prompt catalog (labels, answers, usage). */
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

/** List the currently-published authored days. */
export async function listSets(token: string): Promise<PublishedDay[]> {
  const res = await adminFetch("/daily/admin/sets", token);
  if (res.status === 401) throw new Error("Unauthorized — check the admin token.");
  if (!res.ok) throw new Error(`GET /daily/admin/sets -> ${res.status}`);
  return ((await res.json()) as { sets: PublishedDay[] }).sets;
}

/** Load a full authored day for editing. */
export async function getSet(token: string, dailyDate: string): Promise<LoadedDay> {
  const res = await adminFetch(`/daily/admin/sets/${dailyDate}`, token);
  if (res.status === 401) throw new Error("Unauthorized — check the admin token.");
  if (res.status === 404) throw new Error(`No authored day for ${dailyDate}.`);
  if (!res.ok) throw new Error(`GET /daily/admin/sets/${dailyDate} -> ${res.status}`);
  return (await res.json()) as LoadedDay;
}

/** Unpublish a day: removes it from the DB and the live server overlay. */
export async function deleteSet(token: string, dailyDate: string): Promise<void> {
  const res = await adminFetch(`/daily/admin/sets/${dailyDate}`, token, { method: "DELETE" });
  if (res.status === 401) throw new Error("Unauthorized — check the admin token.");
  if (!res.ok) throw new Error(`DELETE /daily/admin/sets -> ${res.status}`);
}
