// Probe: does satori import + render (text->paths) on this function?
import satori from "satori";
export async function GET(): Promise<Response> {
  try {
    const font = await fetch("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-400-normal.woff").then((r) => r.arrayBuffer());
    const svg = await satori(
      { type: "div", props: { style: { display: "flex", fontFamily: "Inter", fontSize: 40, color: "#000" }, children: "hi 844" } },
      { width: 400, height: 200, fonts: [{ name: "Inter", data: font, weight: 400, style: "normal" }] },
    );
    return new Response("SATORI_OK len=" + svg.length + " head=" + svg.slice(0, 40), { headers: { "content-type": "text/plain" } });
  } catch (e) {
    return new Response("SATORI_ERR\n" + (e instanceof Error ? e.stack : String(e)), { status: 500, headers: { "content-type": "text/plain" } });
  }
}
