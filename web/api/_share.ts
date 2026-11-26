/**
 * Self-contained share helpers for the serverless functions in /api.
 *
 * Deliberately a copy of the decode half of src/features/daily/shareLink.ts:
 * Vercel does NOT bundle imports that reach outside the /api directory, so the
 * functions can't import from ../src at runtime. The wire format is a stable v1
 * — keep this in sync with shareLink.ts (the client-side encoder). The leading
 * underscore keeps this file from being treated as a route.
 */

export interface ShareGridCell {
  named: number;
  total: number;
}

export interface DailyShareData {
  date: string;
  journey: "short" | "medium" | "long";
  outcome: "arrived" | "died";
  points: number;
  category?: string;
  grid: ShareGridCell[];
}

const SHARE_VERSION = 1;
const VALID_JOURNEYS = new Set(["short", "medium", "long"]);

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decode a share payload back to card data; null on anything malformed. */
export function decodeDailyShare(payload: string): DailyShareData | null {
  if (!payload) return null;
  try {
    const w = JSON.parse(b64urlDecode(payload)) as {
      v?: number;
      d?: unknown;
      j?: unknown;
      o?: unknown;
      p?: unknown;
      c?: unknown;
      g?: unknown;
    };
    if (w.v !== SHARE_VERSION) return null;
    if (typeof w.d !== "string" || !VALID_JOURNEYS.has(w.j as string)) return null;
    if (w.o !== "a" && w.o !== "d") return null;
    const grid = Array.isArray(w.g)
      ? w.g
          .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2)
          .map(([named, total]) => ({ named: Math.max(0, named | 0), total: Math.max(0, total | 0) }))
      : [];
    return {
      date: w.d,
      journey: w.j as DailyShareData["journey"],
      outcome: w.o === "a" ? "arrived" : "died",
      points: Math.max(0, (w.p as number) | 0),
      category: typeof w.c === "string" ? w.c : undefined,
      grid,
    };
  } catch {
    return null;
  }
}

export function journeyLabel(j: DailyShareData["journey"]): string {
  return j === "short" ? "Short" : j === "medium" ? "Medium" : "Long";
}

export function outcomeLabel(o: DailyShareData["outcome"]): string {
  return o === "arrived" ? "Arrived" : "Died";
}

/** Tier colour matching promptTier() in tiers.ts — for the card's capture grid. */
export function tierColor(named: number, total: number): string {
  const r = total <= 0 ? 1 : Math.max(0, Math.min(1, named / total));
  if (r >= 1) return "#ffd23f";
  if (r >= 0.75) return "#c084fc";
  if (r >= 0.4) return "#4ade80";
  if (r > 0) return "#fb923c";
  return "#9ca3af";
}

// Trek number (epoch = launch day). Mirrors src/features/daily/trekNumber.ts.
const DAILY_EPOCH = "2026-11-26";
const MS_PER_DAY = 86_400_000;
function utcMidnight(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}
export function trekNumber(d: string): number {
  return Math.floor((utcMidnight(d) - utcMidnight(DAILY_EPOCH)) / MS_PER_DAY) + 1;
}

/** Thousands separators without Intl (thin on some runtimes). */
export function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Absolute origin from request headers (req.url can be host-less on Node). */
export function originFrom(req: Request): string {
  const host = req.headers.get("host") ?? "www.geofight.io";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
