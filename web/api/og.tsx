/**
 * Dynamic Open Graph card for a shared Daily Trek score (/api/og?d=<payload>).
 *
 * Renders a 1200x630 "atlas/journal" card from a stateless share payload.
 *
 * Uses satori (JSX -> SVG) + @resvg/resvg-wasm (SVG -> PNG) DIRECTLY rather than
 * @vercel/og: @vercel/og crashes at module-load in this project's functions
 * (its bundled wasm/font init). Driving the two pieces ourselves lets us init
 * the wasm explicitly and catch every error. The font (Inter) is fetched over
 * HTTP since relative asset files don't bundle into the function.
 *
 * SINGLE-FILE ON PURPOSE: Vercel doesn't bundle this project's /api functions'
 * relative imports — only node_modules. Decode helpers are inlined (kept in
 * sync with the client encoder in src/features/daily/shareLink.ts, v1 format).
 */
import satori from "satori";
import sharp from "sharp";

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
// bundle into the function). Cached across warm invocations.
const FONT_BASE = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files";
type SatoriFont = { name: string; data: ArrayBuffer; weight: 400 | 800; style: "normal" };
let fontsPromise: Promise<SatoriFont[]> | null = null;
function loadFonts(): Promise<SatoriFont[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      fetch(`${FONT_BASE}/inter-latin-400-normal.woff`).then((r) => r.arrayBuffer()),
      fetch(`${FONT_BASE}/inter-latin-800-normal.woff`).then((r) => r.arrayBuffer()),
    ])
      .then(
        ([d4, d8]): SatoriFont[] => [
          { name: "Inter", data: d4, weight: 400, style: "normal" },
          { name: "Inter", data: d8, weight: 800, style: "normal" },
        ],
      )
      .catch((e) => {
        fontsPromise = null; // allow a retry on the next request
        throw e;
      });
  }
  return fontsPromise;
}

export async function GET(req: Request): Promise<Response> {
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

    const fonts = await loadFonts();
    const svg = await satori(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            padding: 40,
            backgroundColor: PAPER,
            color: INK,
            fontFamily: "Inter",
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
            {/* Header */}
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

            {/* Centre */}
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

              <div style={{ display: "flex", fontSize: 88, fontWeight: 800, color: accent }}>{headline}</div>

              <div style={{ display: "flex", alignItems: "flex-end", marginTop: 20 }}>
                <div style={{ display: "flex", fontSize: 128, fontWeight: 800 }}>{group(points)}</div>
                <div style={{ display: "flex", fontSize: 36, color: FADE, marginLeft: 14, marginBottom: 16 }}>pts</div>
              </div>

              <div style={{ display: "flex", fontSize: 28, color: SEPIA, marginTop: 14 }}>{subtitle}</div>
            </div>

            {/* Footer */}
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
      { width: 1200, height: 630, fonts },
    );

    // satori rendered text as vector paths, so sharp can rasterise the SVG
    // without needing any system fonts.
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
