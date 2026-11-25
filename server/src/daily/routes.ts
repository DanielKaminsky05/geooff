/**
 * Daily Dive — Express routes (Track A implementation).
 *
 * `registerDailyRoutes(app)` is the single mount point wired from `index.ts`:
 *   - GET  /daily          -> today's set from `window.ts` (via toPublicDailySet)
 *   - POST /daily/answer    -> validate ONE guess against validIds + score it,
 *                              rate-limited PER IP (reuse TokenBucket)
 *   - POST /daily/finish     -> reconcile completion bonus + outcome, percentile
 *
 * ANTI-CHEAT: /daily/answer is the ONLY route that reads `validIds`. Unthrottled
 * it is a brute-force oracle (POST all ~197 names → learn the secret valid set),
 * so it is rate-limited per IP with a TokenBucket (DEFAULT_ANSWER_LIMIT). The
 * public GET /daily is passed through `toPublicDailySet`, which strips validIds
 * to labels — the secret set NEVER leaves the server.
 */

import type { Express, Request, Response } from "express";
import type {
  DailySet,
  DailyAnswerReq,
  DailyAnswerRes,
  DailyFinishReq,
  DailyFinishRes,
  DailyRunResult,
  DailyJourney,
} from "../protocol.js";
import { DAILY_TIME_BONUS_SECONDS, normalizeAnswer } from "../protocol.js";
import { validIdsFor, promptById } from "../prompts.js";
import { matchAnswer } from "../matching.js";
import { lookupFor, canonicalFor } from "../sets.js";
import { TokenBucket, DEFAULT_ANSWER_LIMIT, type BucketConfig } from "../rateLimit.js";
import { getDailySet, todayUtc, JOURNEYS } from "./window.js";
import { answerPoints, completionBonus, promptFullPoints } from "./scoring.js";
import { capturePercentile } from "./percentile.js";

/** Options for wiring the daily routes — overridable so tests drive them
 *  deterministically (fake clock, tiny rate limit). Production uses defaults. */
export interface DailyRoutesOptions {
  /** Clock for the rate-limiter buckets (injectable for deterministic tests). */
  now?: () => number;
  /** Per-IP answer rate limit. Defaults to DEFAULT_ANSWER_LIMIT. */
  answerLimit?: BucketConfig;
  /** Override "today"'s date string (tests pin a specific day's set). */
  today?: () => string;
}

export function registerDailyRoutes(app: Express, options: DailyRoutesOptions = {}): void {
  const now = options.now ?? Date.now;
  const answerLimit = options.answerLimit ?? DEFAULT_ANSWER_LIMIT;
  const today = options.today ?? (() => todayUtc(now));

  // Per-IP token buckets for the answer oracle. In-memory; fine for phase 1
  // (no persistence) and unbounded growth is bounded in practice by the IP
  // space seen — acceptable for a single stateless mode.
  const answerBuckets = new Map<string, TokenBucket>();
  function bucketFor(ip: string): TokenBucket {
    let b = answerBuckets.get(ip);
    if (!b) {
      b = new TokenBucket(answerLimit, now);
      answerBuckets.set(ip, b);
    }
    return b;
  }

  // Shared "countries" matching tables (built once, cached in sets.ts).
  const lookup = lookupFor("countries");
  const canonical = canonicalFor("countries");

  app.get("/daily", (_req: Request, res: Response<DailySet>) => {
    const set = getDailySet(today());
    if (!set) {
      // Should not happen for a real UTC date, but guard rather than crash.
      res.status(503).json({ error: "no daily set" } as never);
      return;
    }
    // toPublicDailySet strips validIds -> {id,label}. NEVER include validIds.
    res.json({
      dailyDate: set.dailyDate,
      prompts: set.prompts.map((p) => ({ id: p.id, label: p.label })),
      journeys: set.journeys,
      destination: set.destination,
      routes: set.routes,
    });
  });

  app.post("/daily/answer", (req: Request, res: Response<DailyAnswerRes>) => {
    // Rate-limit PER IP: this is the only route that reads the secret valid set.
    const ip = req.ip ?? "unknown";
    if (!bucketFor(ip).take()) {
      res.status(429).json({ valid: false, reason: "wrong" });
      return;
    }

    const body = (req.body ?? {}) as Partial<DailyAnswerReq>;
    const dailyDate = typeof body.dailyDate === "string" ? body.dailyDate : today();
    const promptId = typeof body.promptId === "string" ? body.promptId : "";
    const answer = typeof body.answer === "string" ? body.answer : "";

    if (!normalizeAnswer(answer)) {
      res.json({ valid: false, reason: "empty" });
      return;
    }

    const set = getDailySet(dailyDate);
    const prompt = set?.prompts.find((p) => p.id === promptId) ?? promptById(promptId);
    if (!set || !prompt || !set.prompts.some((p) => p.id === promptId)) {
      // Unknown day or a prompt that is not in that day's set: not a valid guess.
      res.json({ valid: false, reason: "wrong" });
      return;
    }

    const valid = validIdsFor(prompt, "countries");
    const match = matchAnswer(answer, lookup, canonical);
    // Valid iff the text resolved to a country AND that country is in the
    // prompt's secret valid set. DEDUP IS THE CLIENT'S RESPONSIBILITY: the
    // server is stateless and does not track a player's already-named set, so
    // the same correct answer twice both return valid; the client must not
    // double-count. (A future DB phase can move dedup server-side.)
    if (!match.found || !match.iso || !valid.has(match.iso)) {
      res.json({ valid: false, reason: "wrong" });
      return;
    }

    res.json({
      valid: true,
      iso: match.iso,
      name: match.canonical ?? match.iso,
      points: answerPoints(match.iso),
      timeBonusSec: DAILY_TIME_BONUS_SECONDS,
      promptTotal: valid.size,
    });
  });

  app.post("/daily/finish", (req: Request, res: Response<DailyFinishRes>) => {
    const body = (req.body ?? {}) as Partial<DailyFinishReq>;
    const result = reconcileFinish(body.result);
    res.json(result);
  });
}

/**
 * Reconcile a client-reported run into the authoritative finish response:
 *  - recompute each prompt's completion bonus from `named === total`,
 *  - recompute the points total (per-prompt base points + earned bonuses),
 *  - distance covered = points (1:1 scalar); outcome = arrived iff covered ≥
 *    the chosen journey's distance, else died,
 *  - gold = sum of the journey's landmark gold if arrived, else 0,
 *  - percentile = capturePercentile(points ÷ theoretical max), where the max is
 *    the sum over the DAY's prompts of promptFullPoints (incl. completion bonus).
 *
 * The response shape mirrors the request (same DailyRunResult), with corrected
 * values. Defensive against a malformed/partial body.
 */
function reconcileFinish(raw: DailyRunResult | undefined): DailyFinishRes {
  const result: DailyRunResult = {
    runId: raw?.runId ?? "",
    dailyDate: raw?.dailyDate ?? "",
    journey: raw?.journey ?? "short",
    points: 0,
    perPrompt: Array.isArray(raw?.perPrompt) ? raw!.perPrompt : [],
    gold: 0,
    outcome: "died",
    playerId: raw?.playerId ?? null,
  };

  const set = getDailySet(result.dailyDate);
  const journey = findJourney(result.journey);

  // Recompute points: for each reported prompt, trust the client's named/total
  // and reported base points, but award the completion bonus ourselves when the
  // player named the full set (named === total). The prompt's bonus comes from
  // the secret valid pool, so it is recomputed server-side, never trusted.
  let points = 0;
  for (const pp of result.perPrompt) {
    const base = Number.isFinite(pp.points) ? Math.max(0, pp.points) : 0;
    points += base;
    const prompt = set?.prompts.find((p) => p.id === pp.promptId);
    const total = prompt ? validIdsFor(prompt, "countries").size : pp.total;
    if (prompt && pp.named >= total && total > 0) {
      points += completionBonus(prompt);
    }
  }
  result.points = Math.round(points);

  // Distance covered is points 1:1. Arrive iff it clears the journey distance.
  const distance = journey?.distance ?? Infinity;
  const arrived = result.points >= distance;
  result.outcome = arrived ? "arrived" : "died";
  result.gold = arrived && journey
    ? journey.landmarks.reduce((sum, l) => sum + l.gold, 0)
    : 0;

  // Theoretical max = full capture of every prompt in the day's set (base pool +
  // completion bonus). Capture ratio drives the synthetic percentile.
  let theoreticalMax = 0;
  if (set) for (const p of set.prompts) theoreticalMax += promptFullPoints(p);
  const ratio = theoreticalMax > 0 ? result.points / theoreticalMax : 0;
  const percentile = capturePercentile(ratio);

  return { percentile, result };
}

/** Find a journey by id in the fixed JOURNEYS config. */
function findJourney(id: DailyRunResult["journey"]): DailyJourney | undefined {
  return JOURNEYS.find((j) => j.id === id);
}
