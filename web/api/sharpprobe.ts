// Probe: does sharp import + rasterize an SVG to PNG on this function?
import sharp from "sharp";
export async function GET(): Promise<Response> {
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#b5362b"/></svg>';
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return new Response(png as unknown as ArrayBuffer, { headers: { "content-type": "image/png" } });
  } catch (e) {
    return new Response("SHARP_ERR\n" + (e instanceof Error ? e.stack : String(e)), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
