// Probe: does @vercel/og import AND render on this project's Node function?
import { ImageResponse } from "@vercel/og";

export async function GET(): Promise<Response> {
  try {
    const r = await fetch(
      "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-400-normal.woff",
    );
    const font = await r.arrayBuffer();
    const img = new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            backgroundColor: "#fff",
            color: "#000",
            fontFamily: "Inter",
            fontSize: 48,
          }}
        >
          hi {typeof ImageResponse}
        </div>
      ),
      { width: 600, height: 300, fonts: [{ name: "Inter", data: font, weight: 400, style: "normal" }] },
    );
    const png = await img.arrayBuffer();
    return new Response(png, { headers: { "content-type": "image/png" } });
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    return new Response("PROBE_ERR\n" + msg, { status: 500, headers: { "content-type": "text/plain" } });
  }
}
