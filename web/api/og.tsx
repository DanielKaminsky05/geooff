/**
 * Dynamic Open Graph card for a shared Daily Trek score (/api/og?d=<payload>).
 *
 * Renders a 1200x630 "atlas/journal" card from a stateless share payload (see
 * src/features/daily/shareLink.ts) using @vercel/og (Satori). No fonts are
 * bundled — the default sans is used — so the brand comes from the kraft-paper
 * palette, the drawn route line, and the capture grid. Drop TTFs in and pass
 * `fonts` later to get the Press Start 2P wordmark.
 *
 * Runs on the Node.js runtime (not Edge): @vercel/og's edge build doesn't
 * bundle cleanly in a non-Next project, so Vercel rejects it as an
 * "unsupported module". A Web-handler (GET) on Node bundles fine.
 */
import { ImageResponse } from "@vercel/og";
import { decodeDailyShare, journeyLabel, outcomeLabel, tierColor, trekNumber } from "./_share";

// Journal/atlas palette (mirrors index.css map + chrome tokens).
const PAPER = "#e6d7b4";
const INK = "#262019";
const SEPIA = "#5a3d1c";
const GOLD = "#c9a24e";
const RED = "#b5362b";
const FADE = "#8a6d3b";

/** Thousands separators without Intl (edge runtime has a thin Intl). */
function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function GET(req: Request): Response {
  try {
  // req.url can be host-less on Vercel's Node Web-handler — give it a base.
  const url = new URL(req.url, "http://localhost");
  const data = decodeDailyShare(url.searchParams.get("d") ?? "");

  const arrived = data?.outcome === "arrived";
  const points = data?.points ?? 0;
  const headline = (
    data?.category ?? (data ? outcomeLabel(data.outcome) : "Daily Trek")
  ).toUpperCase();
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
              {trek != null && trek > 0 && <div style={{ display: "flex" }}>TREK #{trek}</div>}
              {data?.date && <div style={{ display: "flex", marginTop: 6 }}>{data.date}</div>}
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
    // Surface Satori/render errors as readable text instead of an opaque 500.
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return new Response(`OG_RENDER_ERROR\n${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
