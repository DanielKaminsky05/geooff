/**
 * Dynamic Open Graph card for a shared Daily Trek score (/api/og?d=<payload>).
 *
 * Renders a 1200x630 "atlas/journal" card from a stateless share payload.
 *
 * Pipeline: satori (element tree -> SVG, text rendered as vector PATHS using the
 * fetched Inter font) + sharp (SVG -> PNG). We avoid @vercel/og and
 * @resvg/resvg-wasm entirely: both crash at module-load here because their .wasm
 * assets aren't bundled into the function. satori + sharp import cleanly.
 *
 * NOT .tsx ON PURPOSE: the JSX transform breaks sharp's native bundling in this
 * project's functions (proved by probes — a .ts combo renders, the .tsx one
 * crashes at load). So the element tree is built with plain objects via h().
 *
 * SINGLE-FILE ON PURPOSE: Vercel doesn't bundle this project's /api functions'
 * relative imports — only node_modules. Decode helpers are inlined (kept in sync
 * with the client encoder in src/features/daily/shareLink.ts, v1 format).
 */
import satori from "satori";
import sharp from "sharp";
import type { ReactNode } from "react";

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

// Satori needs an explicit font; fetch Inter (woff) over HTTP (assets don't
// bundle into the function). satori renders the text to vector paths with it.
const FONT_BASE = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files";
type SatoriFont = { name: string; data: ArrayBuffer; weight: 400 | 800; style: "normal" };
let fontsPromise: Promise<SatoriFont[]> | null = null;
function loadFonts(): Promise<SatoriFont[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      fetch(`${FONT_BASE}/inter-latin-400-normal.woff`).then((r) => r.arrayBuffer()),
      fetch(`${FONT_BASE}/inter-latin-800-normal.woff`).then((r) => r.arrayBuffer()),
    ])
      .then(([d4, d8]): SatoriFont[] => [
        { name: "Inter", data: d4, weight: 400, style: "normal" },
        { name: "Inter", data: d8, weight: 800, style: "normal" },
      ])
      .catch((e) => {
        fontsPromise = null; // allow a retry next request
        throw e;
      });
  }
  return fontsPromise;
}

// Minimal hyperscript for satori element trees (every node here is a <div>).
type Style = Record<string, unknown>;
type El = { type: "div"; props: { style: Style; children?: unknown } };
const h = (style: Style, children?: unknown): El => ({ type: "div", props: { style, children } });
// Text node: tight line-height so box height == fontSize (predictable layout).
const t = (style: Style, children?: unknown): El => h({ ...style, lineHeight: 1 }, children);

function card(data: ShareData | null): El {
  const arrived = data?.outcome === "arrived";
  const points = data?.points ?? 0;
  const headline = (data?.category ?? (data ? outcomeLabel(data.outcome) : "Daily Trek")).toUpperCase();
  const subtitle = data
    ? `${journeyLabel(data.journey)} journey  ·  ${outcomeLabel(data.outcome)}`
    : "A daily geography trek";
  const grid = data?.grid ?? [];
  const trek = data ? trekNumber(data.date) : null;
  const accent = arrived ? GOLD : RED;

  const headerRight: El[] = [];
  if (trek != null && trek > 0) headerRight.push(t({ display: "flex" }, `TREK #${trek}`));
  if (data?.date) headerRight.push(t({ display: "flex", marginTop: 8 }, data.date));

  const cells = grid.slice(0, 12).map((c) =>
    h({
      display: "flex",
      width: 30,
      height: 40,
      borderRadius: 7,
      marginRight: 9,
      backgroundColor: tierColor(c.named, c.total),
    }),
  );

  return h(
    {
      display: "flex",
      boxSizing: "border-box",
      width: "100%",
      height: "100%",
      padding: 24,
      backgroundColor: PAPER,
      color: INK,
      fontFamily: "Inter",
    },
    h(
      {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        padding: 34,
        borderWidth: 3,
        borderStyle: "solid",
        borderColor: SEPIA,
        borderRadius: 16,
      },
      [
        // Header
        h({ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }, [
          h({ display: "flex", flexDirection: "column" }, [
            t({ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: 2 }, "GEOFIGHT"),
            t({ display: "flex", fontSize: 18, letterSpacing: 8, color: FADE, marginTop: 8 }, "DAILY TREK"),
          ]),
          h(
            { display: "flex", flexDirection: "column", alignItems: "flex-end", color: FADE, fontSize: 22 },
            headerRight,
          ),
        ]),
        // Centre
        h({ display: "flex", flexDirection: "column", alignItems: "center" }, [
          h({ display: "flex", alignItems: "center", width: "66%", marginBottom: 20 }, [
            h({ display: "flex", width: 24, height: 24, borderRadius: 12, backgroundColor: SEPIA }),
            h({ display: "flex", flexGrow: 1, height: 4, backgroundColor: SEPIA, marginLeft: 12, marginRight: 12 }),
            h({ display: "flex", width: 26, height: 26, backgroundColor: accent }),
          ]),
          t({ display: "flex", fontSize: 60, fontWeight: 800, color: accent }, headline),
          h({ display: "flex", alignItems: "flex-end", marginTop: 12 }, [
            t({ display: "flex", fontSize: 96, fontWeight: 800 }, group(points)),
            t({ display: "flex", fontSize: 30, color: FADE, marginLeft: 14, marginBottom: 10 }, "pts"),
          ]),
          t({ display: "flex", fontSize: 26, color: SEPIA, marginTop: 10 }, subtitle),
        ]),
        // Footer
        h({ display: "flex", justifyContent: "space-between", alignItems: "center" }, [
          h({ display: "flex", alignItems: "center" }, cells),
          t({ display: "flex", fontSize: 20, color: FADE }, "geofight — play today's trek"),
        ]),
      ],
    ),
  );
}

export async function GET(req: Request): Promise<Response> {
  try {
    // req.url can be host-less on Vercel's Node Web-handler — give it a base.
    const url = new URL(req.url, "http://localhost");
    const data = decode(url.searchParams.get("d") ?? "");
    const fonts = await loadFonts();

    const svg = await satori(card(data) as unknown as ReactNode, { width: 1200, height: 630, fonts });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    return new Response(png as unknown as ArrayBuffer, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=0, s-maxage=86400, immutable",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return new Response(`OG_RENDER_ERROR\n${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
