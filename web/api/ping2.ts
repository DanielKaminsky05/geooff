// Probe: Web handler (Request -> Response).
export function GET(): Response {
  return new Response("ping2-web-GET");
}
