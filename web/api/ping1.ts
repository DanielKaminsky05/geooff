// Probe: classic Vercel Node handler (req, res).
export default function handler(_req: unknown, res: { status: (n: number) => { send: (s: string) => void } }) {
  res.status(200).send("ping1-node-req-res");
}
