/**
 * Daily Trek — shareable result link (stateless).
 *
 * Encodes a finished run into a short, URL-safe string so a score can live in a
 * link: `/s/<payload>`. That link is served by a Vercel function that renders
 * Open Graph tags + a generated card image, so pasting it anywhere (iMessage,
 * Discord, X, Slack…) unfurls a preview of the score.
 *
 * The payload is just encoded data — it carries NO secret and is trivially
 * forgeable, which is fine for a casual score card. It is spoiler-free: only
 * per-prompt named/total COUNTS travel in it, never the answer isos/names.
 *
 * Dependency-free on purpose (only `import type`): this module is imported by
 * the edge/serverless share functions, which must not pull in app runtime code.
 */

import type { DailyRunResult, JourneyId, DailyOutcome } from "../../lib/protocol";

/** Bumped if the payload shape changes; decoders reject unknown majors. */
const SHARE_VERSION = 1;

/** Human journey labels (shared by the share text, link card, and recap). */
export const JOURNEY_LABEL: Record<JourneyId, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

export function journeyLabel(j: JourneyId): string {
  return JOURNEY_LABEL[j] ?? j;
}

export function outcomeLabel(o: DailyOutcome): string {
  return o === "arrived" ? "Arrived" : "Died";
}

/**
 * Five capture tiers, full → empty, as non-emoji block glyphs (shared with the
 * plain-text share grid). The thresholds mirror promptTier() in tiers.ts so the
 * grid, the recap grade, and the link card all agree.
 */
const TIER_GLYPHS = ["█", "▓", "▒", "░", "·"] as const;

/** 0..1 capture ratio for a prompt (safe for total === 0 → treated as full). */
function captureRatio(named: number, total: number): number {
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, named / total));
}

/** Map a named/total ratio to one of the five monochrome tier glyphs. */
export function tierGlyph(named: number, total: number): string {
  const ratio = captureRatio(named, total);
  if (ratio >= 1) return TIER_GLYPHS[0];
  if (ratio >= 0.75) return TIER_GLYPHS[1];
  if (ratio >= 0.4) return TIER_GLYPHS[2];
  if (ratio > 0) return TIER_GLYPHS[3];
  return TIER_GLYPHS[4];
}

/** The tier's colour, matching promptTier() in tiers.ts — for the link card. */
export function tierColor(named: number, total: number): string {
  const ratio = captureRatio(named, total);
  if (ratio >= 1) return "#ffd23f"; // Flawless
  if (ratio >= 0.75) return "#c084fc"; // Great
  if (ratio >= 0.4) return "#4ade80"; // Solid
  if (ratio > 0) return "#fb923c"; // Scraped
  return "#9ca3af"; // Blank
}

/** One prompt's capture, as it travels in a share link. */
export interface ShareGridCell {
  named: number;
  total: number;
}

/** A decoded share payload — everything the link card needs, nothing more. */
export interface DailyShareData {
  date: string;
  journey: JourneyId;
  outcome: DailyOutcome;
  points: number;
  /** The run's headline category (e.g. "Legendary"), precomputed at share time. */
  category?: string;
  grid: ShareGridCell[];
}

/** URL-safe base64 (no padding), UTF-8 clean, works in browser + edge + node. */
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The compact on-wire shape — short keys to keep the link tidy. */
interface Wire {
  v: number;
  d: string;
  j: JourneyId;
  o: "a" | "d";
  p: number;
  c?: string;
  g: [number, number][];
}

/**
 * Encode a finished run into a URL-safe payload. `category` is the recap's
 * headline keyword (it needs run progress to compute, which this module can't),
 * so the caller passes it through.
 */
export function encodeDailyShare(result: DailyRunResult, category?: string): string {
  const wire: Wire = {
    v: SHARE_VERSION,
    d: result.dailyDate,
    j: result.journey,
    o: result.outcome === "arrived" ? "a" : "d",
    p: Math.max(0, Math.round(result.points)),
    g: result.perPrompt.map((p) => [Math.max(0, p.named | 0), Math.max(0, p.total | 0)]),
  };
  if (category) wire.c = category;
  return b64urlEncode(JSON.stringify(wire));
}

const VALID_JOURNEYS: ReadonlySet<string> = new Set(["short", "medium", "long"]);

/** Decode a payload back to card data; returns null on anything malformed. */
export function decodeDailyShare(payload: string): DailyShareData | null {
  if (!payload) return null;
  try {
    const wire = JSON.parse(b64urlDecode(payload)) as Partial<Wire>;
    if (wire.v !== SHARE_VERSION) return null;
    if (typeof wire.d !== "string" || !VALID_JOURNEYS.has(wire.j as string)) return null;
    if (wire.o !== "a" && wire.o !== "d") return null;
    const grid = Array.isArray(wire.g)
      ? wire.g
          .filter((c) => Array.isArray(c) && c.length === 2)
          .map(([named, total]) => ({ named: Math.max(0, named | 0), total: Math.max(0, total | 0) }))
      : [];
    return {
      date: wire.d,
      journey: wire.j as JourneyId,
      outcome: wire.o === "a" ? "arrived" : "died",
      points: Math.max(0, (wire.p as number) | 0),
      category: typeof wire.c === "string" ? wire.c : undefined,
      grid,
    };
  } catch {
    return null;
  }
}

/** The app path for a run's share card, e.g. "/s/eyJ2Ijox...". */
export function dailySharePath(result: DailyRunResult, category?: string): string {
  return `/s/${encodeDailyShare(result, category)}`;
}

/** The absolute share URL for a run, given the current origin. */
export function dailyShareUrl(result: DailyRunResult, origin: string, category?: string): string {
  return `${origin.replace(/\/$/, "")}${dailySharePath(result, category)}`;
}
