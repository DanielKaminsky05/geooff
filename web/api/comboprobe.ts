// Probe: satori + sharp together in a .ts (no JSX) doing the full pipeline.
import satori from "satori";
import sharp from "sharp";
export async function GET(): Promise<Response> {
  try {
    const font = await fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-800-normal.woff").then((r) => r.arrayBuffer());
    const el = {
      type: "div",
      props: {
        style: { display: "flex", width: "100%", height: "100%", backgroundColor: "#e6d7b4", color: "#262019", fontFamily: "Inter", fontSize: 64, fontWeight: 800, alignItems: "center", justifyContent: "center" },
        children: "844 pts",
      },
    };
    const svg = await satori(el as unknown as React.ReactNode, { width: 1200, height: 630, fonts: [{ name: "Inter", data: font, weight: 800, style: "normal" }] });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return new Response(png as unknown as ArrayBuffer, { headers: { "content-type": "image/png" } });
  } catch (e) {
    return new Response("COMBO_ERR\n" + (e instanceof Error ? e.stack : String(e)), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
