/**
 * Share landing page for a Daily Trek score.
 *
 * Reached via a vercel.json rewrite: /s/:payload -> /api/share?p=:payload.
 * Crawlers (iMessage, Discord, X, Slack, Facebook…) don't run JS, so this
 * returns a tiny HTML doc carrying Open Graph + Twitter tags whose image points
 * at /api/og. A real visitor is bounced to the homepage.
 *
 * SINGLE-FILE ON PURPOSE: Vercel does not bundle this project's /api functions'
 * relative imports (not ../src, not even a sibling ./file) — only node_modules.
 * So the decode helpers are inlined here; keep them in sync with the client
 * encoder in src/features/daily/shareLink.ts (stable v1 wire format).
 *
 * Node.js runtime, Web-handler GET.
 */

const LANDING = "/";
const SHARE_VERSION = 1;
const VALID_JOURNEYS = new Set(["short", "medium", "long"]);

interface ShareData {
  date: string;
  journey: "short" | "medium" | "long";
  outcome: "arrived" | "died";
  points: number;
  category?: string;
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
    return {
      date: w.d,
      journey: w.j as ShareData["journey"],
      outcome: w.o === "a" ? "arrived" : "died",
      points: Math.max(0, (w.p as number) | 0),
      category: typeof w.c === "string" ? w.c : undefined,
    };
  } catch {
    return null;
  }
}

const journeyLabel = (j: ShareData["journey"]): string =>
  j === "short" ? "Short" : j === "medium" ? "Medium" : "Long";
const outcomeLabel = (o: ShareData["outcome"]): string => (o === "arrived" ? "Arrived" : "Died");
const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function GET(req: Request): Response {
  try {
    // req.url can be host-less on Vercel's Node Web-handler — give it a base.
    const url = new URL(req.url, "http://localhost");
    const payload = url.searchParams.get("p") ?? "";
    const data = decode(payload);

    const host = req.headers.get("host") ?? "www.geofight.io";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const origin = `${proto}://${host}`;

    const title = data
      ? `${data.category ? data.category + " — " : ""}${group(data.points)} pts on GEOFIGHT Daily`
      : "GEOFIGHT — Daily Trek";
    const description = data
      ? `${journeyLabel(data.journey)} journey · ${outcomeLabel(data.outcome)}. Can you beat it? Play today's trek.`
      : "A daily geography trek. Play today's trek.";
    const image = `${origin}/api/og?d=${encodeURIComponent(payload)}`;
    const shareUrl = `${origin}/s/${encodeURIComponent(payload)}`;

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="GEOFIGHT" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(shareUrl)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(image)}" />

    <meta http-equiv="refresh" content="0; url=${LANDING}" />
    <link rel="canonical" href="${esc(shareUrl)}" />
  </head>
  <body>
    <p>Taking you to <a href="${LANDING}">GEOFIGHT</a>…</p>
    <script>location.replace(${JSON.stringify(LANDING)});</script>
  </body>
</html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=86400",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return new Response(`SHARE_ERROR\n${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
