/**
 * Share landing page for a Daily Trek score: /s/<payload>.
 *
 * Crawlers (iMessage, Discord, X, Slack, Facebook…) don't run JS, so this
 * function returns a tiny HTML doc carrying Open Graph + Twitter tags whose
 * image points at /api/og. A real visitor is bounced to the homepage, where
 * they can play today's trek.
 *
 * Reached via a vercel.json rewrite: /s/:payload -> /api/s/:payload.
 * Node.js runtime (Web-handler) to match the og function's bundling.
 */
import { decodeDailyShare, journeyLabel, outcomeLabel } from "../../src/features/daily/shareLink";

/** Where a human who clicks the link ends up. */
const LANDING = "/";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function GET(req: Request): Response {
  const url = new URL(req.url);
  // The payload is the last path segment, whether the function sees the
  // original (/s/<payload>) or rewritten (/api/s/<payload>) path.
  const segs = url.pathname.split("/").filter(Boolean);
  const payload = decodeURIComponent(segs[segs.length - 1] ?? "");
  const data = decodeDailyShare(payload);

  const title = data
    ? `${data.category ? data.category + " — " : ""}${data.points.toLocaleString()} pts on GEOFIGHT Daily`
    : "GEOFIGHT — Daily Trek";
  const description = data
    ? `${journeyLabel(data.journey)} journey · ${outcomeLabel(data.outcome)}. Can you beat it? Play today's trek.`
    : "A daily geography trek. Play today's trek.";
  const image = `${url.origin}/api/og?d=${encodeURIComponent(payload)}`;
  const shareUrl = `${url.origin}/s/${encodeURIComponent(payload)}`;

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
      // Let crawlers/CDN cache the unfurl briefly; the score is immutable.
      "cache-control": "public, max-age=0, s-maxage=86400",
    },
  });
}
