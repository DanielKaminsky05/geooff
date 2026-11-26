/**
 * Dynamic Open Graph card for a shared Daily Trek score (/api/og?d=<payload>).
 *
 * Renders a 1200x630 "atlas/journal" card from a stateless share payload using
 * @vercel/og (Satori). No fonts are bundled — the default sans is used — so the
 * brand comes from the kraft-paper palette, the drawn route line, and the
 * capture grid.
 *
 * Node.js runtime (Edge rejects @vercel/og here as an "unsupported module").
 * SINGLE-FILE ON PURPOSE: Vercel doesn't bundle this project's /api functions'
 * relative imports, so the decode helpers are inlined (kept in sync with the
 * client encoder in src/features/daily/shareLink.ts, stable v1 wire format).
 * Only node_modules imports (@vercel/og) survive bundling.
 */
import { ImageResponse } from "@vercel/og";

// Journal/atlas palette (mirrors index.css map + chrome tokens).
const PAPER = "#e6d7b4";
const INK = "#262019";
const SEPIA = "#5a3d1c";
const GOLD = "#c9a24e";
const RED = "#b5362b";
const FADE = "#8a6d3b";

const SHARE_VERSION = 1;
const VALID_JOURNEYS = new Set(["short", "medium", "long"]);
const DAILY_EPOCH = "2026-11-26";
const MS_PER_DAY = 86_400_000;

type Journey = "short" | "medium" | "long";
interface ShareData {
  date: string;
  journey: Journey;
  outcome: "arrived" | "died";
  points: number;
  category?: string;
  grid: { named: number; total: number }[];
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decode(payload: string): ShareData | null {
  if (!payload) return null;
  try {
    const w = JSON.parse(b64urlDecode(payload)) as Record<string, unknown>;
    if (w.v !== SHARE_VERSION) return null;
    if (typeof w.d !== "string" || !VALID_JOURNEYS.has(w.j as string)) return null;
    if (w.o !== "a" && w.o !== "d") return null;
    const grid = Array.isArray(w.g)
      ? (w.g as unknown[])
          .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2)
          .map(([named, total]) => ({ named: Math.max(0, named | 0), total: Math.max(0, total | 0) }))
      : [];
    return {
      date: w.d,
      journey: w.j as Journey,
      outcome: w.o === "a" ? "arrived" : "died",
      points: Math.max(0, (w.p as number) | 0),
      category: typeof w.c === "string" ? w.c : undefined,
      grid,
    };
  } catch {
    return null;
  }
}

const journeyLabel = (j: Journey): string =>
  j === "short" ? "Short" : j === "medium" ? "Medium" : "Long";
const outcomeLabel = (o: ShareData["outcome"]): string => (o === "arrived" ? "Arrived" : "Died");

function tierColor(named: number, total: number): string {
  const r = total <= 0 ? 1 : Math.max(0, Math.min(1, named / total));
  if (r >= 1) return "#ffd23f";
  if (r >= 0.75) return "#c084fc";
  if (r >= 0.4) return "#4ade80";
  if (r > 0) return "#fb923c";
  return "#9ca3af";
}

function utcMidnight(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}
const trekNumber = (d: string): number =>
  Math.floor((utcMidnight(d) - utcMidnight(DAILY_EPOCH)) / MS_PER_DAY) + 1;

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function GET(req: Request): Response {
  try {
    // req.url can be host-less on Vercel's Node Web-handler — give it a base.
    const url = new URL(req.url, "http://localhost");
    const data = decode(url.searchParams.get("d") ?? "");

    const arrived = data?.outcome === "arrived";
    const points = data?.points ?? 0;
    const headline = (data?.category ?? (data ? outcomeLabel(data.outcome) : "Daily Trek")).toUpperCase();
    const subtitle = data
      ? `${journeyLabel(data.journey)} journey  ·  ${outcomeLabel(data.outcome)}`
      : "A daily geography trek";
    const grid = data?.grid ?? [];
    const trek = data ? trekNumber(data.date) : null;
    const accent = arrived ? GOLD : RED;

    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            padding: 40,
            backgroundColor: PAPER,
            color: INK,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              width: "100%",
              height: "100%",
              padding: 52,
              borderWidth: 3,
              borderStyle: "solid",
              borderColor: SEPIA,
              borderRadius: 16,
            }}
          >
            {/* Header: wordmark + date/trek number */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: 2 }}>GEOFIGHT</div>
                <div style={{ display: "flex", fontSize: 20, letterSpacing: 8, color: FADE, marginTop: 6 }}>
                  DAILY TREK
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  color: FADE,
                  fontSize: 24,
                }}
              >
                {trek != null && trek > 0 ? <div style={{ display: "flex" }}>TREK #{trek}</div> : null}
                {data?.date ? <div style={{ display: "flex", marginTop: 6 }}>{data.date}</div> : null}
              </div>
            </div>

            {/* Centre: route line, headline, points */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", width: "66%", marginBottom: 30 }}>
                <div style={{ display: "flex", width: 24, height: 24, borderRadius: 12, backgroundColor: SEPIA }} />
                <div
                  style={{
                    display: "flex",
                    flexGrow: 1,
                    height: 4,
                    backgroundColor: SEPIA,
                    marginLeft: 12,
                    marginRight: 12,
                  }}
                />
                <div style={{ display: "flex", width: 26, height: 26, backgroundColor: accent }} />
              </div>

              <div style={{ display: "flex", fontSize: 88, fontWeight: 800, color: accent, lineHeight: 1 }}>
                {headline}
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", marginTop: 20 }}>
                <div style={{ display: "flex", fontSize: 128, fontWeight: 800, lineHeight: 1 }}>{group(points)}</div>
                <div style={{ display: "flex", fontSize: 36, color: FADE, marginLeft: 14, marginBottom: 16 }}>pts</div>
              </div>

              <div style={{ display: "flex", fontSize: 28, color: SEPIA, marginTop: 14 }}>{subtitle}</div>
            </div>

            {/* Footer: capture grid + tagline */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {grid.slice(0, 12).map((cell, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      width: 30,
                      height: 44,
                      borderRadius: 7,
                      marginRight: 9,
                      backgroundColor: tierColor(cell.named, cell.total),
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", fontSize: 22, color: FADE }}>geofight — play today&apos;s trek</div>
            </div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    );
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return new Response(`OG_RENDER_ERROR\n${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
