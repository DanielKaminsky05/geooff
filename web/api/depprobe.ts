// Probe: can a function import ANY node_modules dependency?
import { version } from "react";
export function GET(): Response {
  return new Response("react-version:" + version, { headers: { "content-type": "text/plain" } });
}
