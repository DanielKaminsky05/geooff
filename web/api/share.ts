/**
 * Share landing page for a Daily Trek score.
 *
 * Reached via a vercel.json rewrite: /s/:payload -> /api/share?p=:payload
 * (a plain query param, not a [dynamic] route — those don't deploy reliably
 * for a non-Next project). Crawlers (iMessage, Discord, X, Slack, Facebook…)
 * don't run JS, so this returns a tiny HTML doc carrying Open Graph + Twitter
 * tags whose image points at /api/og. A real visitor is bounced to the homepage.
 *
 * Node.js runtime, Web-handler GET.
 */
import { decodeDailyShare, journeyLabel, outcomeLabel } from "../src/features/daily/shareLink";

/** Where a human who clicks the link ends up. */
const LANDING = "/";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Thousands separators without Intl. */
function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function GET(req: Request): Response {
  const url = new URL(req.url);
  const payload = url.searchParams.get("p") ?? "";
  const data = decodeDailyShare(payload);

  const title = data
    ? `${data.category ? data.category + " — " : ""}${group(data.points)} pts on GEOFIGHT Daily`
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
      "cache-control": "public, max-age=0, s-maxage=86400",
    },
  });
}
