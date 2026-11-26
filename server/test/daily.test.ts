import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

import { getDailySet, todayUtc } from "../src/daily/window.js";
import { answerPoints, promptFullPoints, completionBonus, promptBasePoints, dailyScoreMax } from "../src/daily/scoring.js";
import { capturePercentile } from "../src/daily/percentile.js";
import { registerDailyRoutes } from "../src/daily/routes.js";
import { validIdsFor } from "../src/prompts.js";
import { DAILY_NAME_BONUS, DAILY_PROMPT_MAX } from "../src/protocol.js";
import type {
  DailySet,
  DailyAnswerRes,
  DailyFinishRes,
  DailyRunResult,
} from "../src/protocol.js";

/** A fresh Express app with the daily routes mounted, pinned to one date. */
function makeApp(opts: Parameters<typeof registerDailyRoutes>[1] = {}) {
  const app = express();
  app.use(express.json());
  registerDailyRoutes(app, opts);
  return app;
}

const DATE = "2026-01-15";

describe("daily/window — deterministic selection", () => {
  it("same date yields an identical set (prompts + destination)", () => {
    const a = getDailySet(DATE)!;
    const b = getDailySet(DATE)!;
    expect(a).not.toBeNull();
    expect(a.prompts.map((p) => p.id)).toEqual(b.prompts.map((p) => p.id));
    expect(a.destination).toEqual(b.destination);
  });

  it("picks exactly 5 DISTINCT prompts", () => {
    const set = getDailySet(DATE)!;
    expect(set.prompts).toHaveLength(5);
    const ids = set.prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("different dates differ in their prompt selection", () => {
    const a = getDailySet("2026-01-15")!.prompts.map((p) => p.id);
    const b = getDailySet("2026-02-20")!.prompts.map((p) => p.id);
    const c = getDailySet("2026-07-04")!.prompts.map((p) => p.id);
    // At least two of three days should differ (not all identical).
    const allSame = JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c);
    expect(allSame).toBe(false);
  });

  it("rejects a malformed date with null", () => {
    expect(getDailySet("not-a-date")).toBeNull();
    expect(getDailySet("2026-13-40")).toBeNull();
  });

  it("todayUtc formats a fixed clock as YYYY-MM-DD (UTC)", () => {
    const fixed = Date.UTC(2026, 0, 15, 23, 30);
    expect(todayUtc(() => fixed)).toBe("2026-01-15");
  });

  it("resolves three journeys with per-day distances as a fraction of the score max", () => {
    const set = getDailySet(DATE)!;
    expect(set.journeys.map((j) => j.id)).toEqual(["short", "medium", "long"]);
    const [s, m, l] = set.journeys.map((j) => j.distance);
    // Strictly increasing, and the long road is a big share of the day's max.
    expect(s).toBeLessThan(m);
    expect(m).toBeLessThan(l);
    expect(l).toBeLessThan(dailyScoreMax(set.prompts));
  });
});

describe("daily/scoring — rarity weighting", () => {
  it("a tiny country scores higher than a giant", () => {
    expect(answerPoints("nr")).toBeGreaterThan(answerPoints("cn")); // Nauru > China
    expect(answerPoints("tv")).toBeGreaterThan(answerPoints("us")); // Tuvalu > USA
  });

  it("mean answer points across all valid answers of a prompt ≈ base 10", () => {
    // Sum / count over a broad prompt should be in a sane band around 10.
    const set = getDailySet(DATE)!;
    const prompt = set.prompts[0];
    const ids = [...validIdsFor(prompt, "countries")];
    const mean = ids.reduce((s, iso) => s + answerPoints(iso), 0) / ids.length;
    expect(mean).toBeGreaterThan(4);
    expect(mean).toBeLessThan(25);
  });

  it("completion bonus is 50% of the prompt's base pool and adds to full points", () => {
    const set = getDailySet(DATE)!;
    const p = set.prompts[0];
    const base = [...validIdsFor(p, "countries")].reduce((s, iso) => s + answerPoints(iso), 0);
    expect(completionBonus(p)).toBe(Math.round(0.5 * base));
    expect(promptFullPoints(p)).toBe(base + completionBonus(p));
  });

  it("unknown iso scores an average answer (~base 10)", () => {
    expect(answerPoints("zz")).toBe(10);
  });
});

describe("daily/percentile — hardcoded monotonic curve", () => {
  it("hits the anchor shape (low / mid / high)", () => {
    expect(capturePercentile(0)).toBeLessThan(10);
    expect(capturePercentile(0.5)).toBeGreaterThan(60);
    expect(capturePercentile(0.5)).toBeLessThan(80);
    expect(capturePercentile(1)).toBeGreaterThanOrEqual(95);
  });

  it("is monotonic and clamps out-of-range input", () => {
    let prev = -1;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const p = capturePercentile(r);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(capturePercentile(-5)).toBe(capturePercentile(0));
    expect(capturePercentile(5)).toBe(capturePercentile(1));
  });
});

describe("GET /daily — public set, no secrets", () => {
  it("returns the public set with NO validIds / no secret arrays", async () => {
    const app = makeApp({ today: () => DATE });
    const res = await request(app).get("/daily");
    expect(res.status).toBe(200);
    const body = res.body as DailySet;
    expect(body.dailyDate).toBe(DATE);
    expect(body.prompts).toHaveLength(5);
    // Each prompt is exactly {id, label} — nothing else leaks.
    for (const p of body.prompts) {
      expect(Object.keys(p).sort()).toEqual(["id", "label"]);
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("validIds");
    // No country iso list smuggled in: a known valid answer name must not appear.
    expect(raw).not.toContain("Nauru");
  });
});

describe("POST /daily/answer — validation + scoring", () => {
  // starts-with-u is in the 2026-01-15 set; United Kingdom (gb) is valid.
  it("accepts a correct answer and scores it", async () => {
    const app = makeApp({ today: () => DATE });
    const res = await request(app)
      .post("/daily/answer")
      .send({ dailyDate: DATE, promptId: "starts-with-u", answer: "United Kingdom" });
    expect(res.status).toBe(200);
    const body = res.body as DailyAnswerRes;
    expect(body.valid).toBe(true);
    expect(body.iso).toBe("gb");
    expect(body.points).toBe(answerPoints("gb"));
    expect(body.timeBonusSec).toBe(2);
    const uPrompt = getDailySet(DATE)!.prompts.find((p) => p.id === "starts-with-u")!;
    expect(body.promptTotal).toBe(validIdsFor(uPrompt, "countries").size);
    // promptMax = the prompt's full weighted pool (the client's normalizer).
    expect(body.promptMax).toBe(promptBasePoints(uPrompt));
  });

  it("rejects a wrong answer (country not in the prompt's set)", async () => {
    const app = makeApp({ today: () => DATE });
    const res = await request(app)
      .post("/daily/answer")
      .send({ dailyDate: DATE, promptId: "starts-with-u", answer: "France" });
    expect((res.body as DailyAnswerRes).valid).toBe(false);
    expect((res.body as DailyAnswerRes).reason).toBe("wrong");
  });

  it("rejects an empty answer with reason empty", async () => {
    const app = makeApp({ today: () => DATE });
    const res = await request(app)
      .post("/daily/answer")
      .send({ dailyDate: DATE, promptId: "starts-with-u", answer: "   " });
    expect((res.body as DailyAnswerRes).valid).toBe(false);
    expect((res.body as DailyAnswerRes).reason).toBe("empty");
  });

  it("rejects a prompt id that is not in the day's set", async () => {
    const app = makeApp({ today: () => DATE });
    const res = await request(app)
      .post("/daily/answer")
      .send({ dailyDate: DATE, promptId: "not-a-real-prompt", answer: "France" });
    expect((res.body as DailyAnswerRes).valid).toBe(false);
  });

  it("rate-limits per IP: a burst eventually returns 429", async () => {
    // Fixed clock (no refill) + tiny burst → the (burst+1)th call is throttled.
    const app = makeApp({ today: () => DATE, now: () => 1000, answerLimit: { burst: 3, refillPerSec: 0 } });
    const send = () =>
      request(app)
        .post("/daily/answer")
        .send({ dailyDate: DATE, promptId: "starts-with-u", answer: "Uganda" });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect((limited.body as DailyAnswerRes).valid).toBe(false);
  });
});

describe("POST /daily/finish — reconciliation", () => {
  const set = getDailySet(DATE)!;
  const journeyShort = set.journeys.find((j) => j.id === "short")!;
  const journeyLong = set.journeys.find((j) => j.id === "long")!;

  function baseResult(over: Partial<DailyRunResult>): DailyRunResult {
    return {
      runId: "run-1",
      dailyDate: DATE,
      journey: "short",
      points: 0,
      perPrompt: set.prompts.map((p) => ({ promptId: p.id, named: 0, total: 0, points: 0 })),
      gold: 0,
      outcome: "died",
      playerId: null,
      ...over,
    };
  }

  it("arrives when run points clear the journey distance and banks the gold", async () => {
    const app = makeApp({ today: () => DATE });
    // Fully clear every prompt: capture base 150 + a bonus for every name → the max.
    const perPrompt = set.prompts.map((p) => {
      const total = validIdsFor(p, "countries").size;
      return { promptId: p.id, named: total, total, points: DAILY_PROMPT_MAX };
    });
    const res = await request(app)
      .post("/daily/finish")
      .send({ result: baseResult({ journey: "short", perPrompt }) });
    const body = res.body as DailyFinishRes;
    expect(body.result.points).toBe(dailyScoreMax(set.prompts));
    expect(body.result.outcome).toBe("arrived");
    const expectedGold = journeyShort.landmarks.reduce((s, l) => s + l.gold, 0);
    expect(body.result.gold).toBe(expectedGold);
    expect(body.percentile).toBeGreaterThanOrEqual(0);
    expect(body.percentile).toBeLessThanOrEqual(100);
  });

  it("clamps the capture base to DAILY_PROMPT_MAX and `named` to the pool size", async () => {
    const app = makeApp({ today: () => DATE });
    const prompt = set.prompts[0];
    const total = validIdsFor(prompt, "countries").size;
    // Over-report both base (999) and named (total + 50) on one prompt.
    const perPrompt = set.prompts.map((p, i) =>
      i === 0
        ? { promptId: p.id, named: total + 50, total, points: 999 }
        : { promptId: p.id, named: 0, total: 0, points: 0 },
    );
    const res = await request(app)
      .post("/daily/finish")
      .send({ result: baseResult({ journey: "short", perPrompt }) });
    const body = res.body as DailyFinishRes;
    // Capped: base 150 + the pool size × the per-name bonus (named clamped to pool).
    expect(body.result.points).toBe(DAILY_PROMPT_MAX + total * DAILY_NAME_BONUS);
  });

  it("adds the flat per-name bonus on top of the capture base", async () => {
    const app = makeApp({ today: () => DATE });
    const prompt = set.prompts[0];
    const total = validIdsFor(prompt, "countries").size;
    const named = Math.min(4, total);
    // Base 60 + `named` bonuses on one prompt, nothing elsewhere.
    const perPrompt = set.prompts.map((p, i) =>
      i === 0
        ? { promptId: p.id, named, total, points: 60 }
        : { promptId: p.id, named: 0, total: 0, points: 0 },
    );
    const res = await request(app)
      .post("/daily/finish")
      .send({ result: baseResult({ journey: "short", perPrompt }) });
    const body = res.body as DailyFinishRes;
    expect(body.result.points).toBe(60 + named * DAILY_NAME_BONUS);
  });

  it("dies when points fall short, and banks no gold if no landmark was reached", async () => {
    const app = makeApp({ today: () => DATE });
    // 10 base, 0 names on each prompt → 50 total, short of even the first landmark.
    const perPrompt = set.prompts.map((p) => ({ promptId: p.id, named: 0, total: 0, points: 10 }));
    const res = await request(app)
      .post("/daily/finish")
      .send({ result: baseResult({ journey: "long", perPrompt, gold: 175 }) });
    const body = res.body as DailyFinishRes;
    expect(body.result.points).toBe(50); // 5 × (10 + 0)
    expect(body.result.outcome).toBe("died");
    expect(body.result.gold).toBe(0); // reached no landmark → nothing to keep
    expect(journeyLong.distance).toBeGreaterThan(50);
  });

  it("forfeits collected gold on a death: banks 0 and reports goldLost in red", async () => {
    const app = makeApp({ today: () => DATE });
    const longDist = journeyLong.distance;
    const target = Math.round(0.3 * longDist); // ~30% in → died, but past early landmarks
    let remaining = target;
    const perPrompt = set.prompts.map((p) => {
      const points = Math.min(DAILY_PROMPT_MAX, remaining);
      remaining -= points;
      return { promptId: p.id, named: 0, total: 0, points };
    });
    const res = await request(app)
      .post("/daily/finish")
      .send({ result: baseResult({ journey: "long", perPrompt }) });
    const body = res.body as DailyFinishRes;
    const progress = body.result.points / longDist;
    const reached = journeyLong.landmarks
      .filter((l) => l.atFraction <= progress + 1e-9)
      .reduce((s, l) => s + l.gold, 0);
    expect(body.result.outcome).toBe("died");
    expect(body.result.gold).toBe(0); // all-or-nothing: banked nothing
    expect(body.goldLost).toBe(reached); // what was collected but forfeited
    expect(reached).toBeGreaterThan(0);
  });
});
