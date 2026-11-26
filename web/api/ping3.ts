// Probe: Web handler via default fetch-style.
export default {
  fetch(): Response {
    return new Response("ping3-web-default-fetch");
  },
};
