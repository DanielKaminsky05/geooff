/**
 * Daily Dive — Express routes (PHASE 0 STUB).
 *
 * `registerDailyRoutes(app)` is the single mount point wired from `index.ts`
 * (Phase 2). The SHAPES returned below are the frozen contract; Track A replaces
 * the stub bodies with the real module:
 *   - GET  /daily          -> today's set from `window.ts` (via toPublicDailySet)
 *   - POST /daily/answer    -> validate one guess (validate.ts / validIdsFor),
 *                              rate-limited PER IP (reuse TokenBucket), score it
 *   - POST /daily/finish     -> reconcile completion bonus + outcome, percentile
 *
 * ANTI-CHEAT: /daily/answer is the only route that reads `validIds`; it must be
 * rate-limited (unthrottled it is a brute-force oracle for the valid set).
 */

import type { Express, Request, Response } from "express";
import type {
  DailySet,
  DailyAnswerRes,
  DailyFinishReq,
  DailyFinishRes,
} from "../protocol.js";

/** PHASE 0 placeholder day — Track A generates this from the prompt pool. */
const STUB_SET: DailySet = {
  dailyDate: "1970-01-01",
  prompts: [
    { id: "starts-with-b", label: "Name a country starting with B" },
    { id: "island", label: "Name an island nation" },
    { id: "borders-country-de", label: "Name a country that borders Germany" },
    { id: "flag-star", label: "Name a country whose flag has a star" },
    { id: "name-ends-stan", label: "Name a country whose name ends in “-stan”" },
  ],
  journeys: [
    { id: "short", distance: 300, landmarks: [{ atFraction: 1, gold: 40 }] },
    {
      id: "medium",
      distance: 600,
      landmarks: [
        { atFraction: 0.5, gold: 25 },
        { atFraction: 1, gold: 60 },
      ],
    },
    {
      id: "long",
      distance: 1000,
      landmarks: [
        { atFraction: 0.33, gold: 30 },
        { atFraction: 0.66, gold: 45 },
        { atFraction: 1, gold: 100 },
      ],
    },
  ],
  destination: { name: "Istanbul", at: { lat: 41.01, lon: 28.98 } },
  routes: [
    {
      journeyId: "short",
      points: [
        { lat: 38.72, lon: -9.14 },
        { lat: 41.01, lon: 28.98 },
      ],
    },
    {
      journeyId: "medium",
      points: [
        { lat: 38.72, lon: -9.14 },
        { lat: 41.9, lon: 12.5 },
        { lat: 41.01, lon: 28.98 },
      ],
    },
    {
      journeyId: "long",
      points: [
        { lat: 38.72, lon: -9.14 },
        { lat: 48.85, lon: 2.35 },
        { lat: 52.52, lon: 13.4 },
        { lat: 41.01, lon: 28.98 },
      ],
    },
  ],
};

export function registerDailyRoutes(app: Express): void {
  app.get("/daily", (_req: Request, res: Response<DailySet>) => {
    res.json(STUB_SET);
  });

  app.post("/daily/answer", (_req: Request, res: Response<DailyAnswerRes>) => {
    // Stub: reject everything. Track A validates against validIds + scores.
    res.json({ valid: false, reason: "wrong" });
  });

  app.post("/daily/finish", (req: Request, res: Response<DailyFinishRes>) => {
    const body = req.body as DailyFinishReq;
    // Stub: echo the client's result, flat 50th percentile. Track A reconciles
    // completion bonus + recomputes outcome, then applies the percentile curve.
    res.json({ percentile: 50, result: body.result });
  });
}
