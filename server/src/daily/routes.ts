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
  DailyPromptResult,
} from "../protocol.js";
import {
  DAILY_TIME_BONUS_SECONDS,
  DAILY_PROMPT_MAX,
  DAILY_NAME_BONUS,
  normalizeAnswer,
} from "../protocol.js";
import { validIdsFor, promptById, labelAnswers } from "../prompts.js";
import { matchAnswer } from "../matching.js";
import { lookupFor, canonicalFor } from "../sets.js";
import { TokenBucket, DEFAULT_ANSWER_LIMIT, type BucketConfig } from "../rateLimit.js";
import { getDailySet, todayUtc } from "./window.js";
import { answerPoints, promptBasePoints, dailyScoreMax } from "./scoring.js";
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
      // The full weighted pool — the client's normalization denominator so this
      // prompt tops out at DAILY_PROMPT_MAX however big/small its answer set is.
      promptMax: promptBasePoints(prompt),
    });
  });

  app.post("/daily/finish", (req: Request, res: Response<DailyFinishRes>) => {
    const body = (req.body ?? {}) as Partial<DailyFinishReq>;
    const result = reconcileFinish(body.result);
    res.json(result);
  });
}

/**
 * Reconcile a client-reported run into the authoritative finish response. Each
 * prompt scores a CAPTURE base (0..DAILY_PROMPT_MAX = your captured share of its
 * rarity-weighted pool, which the client computes) PLUS a flat DAILY_NAME_BONUS
 * per correct country.
 *  - per prompt: clamp the client's base to [0, DAILY_PROMPT_MAX]; add the name
 *    bonus with `named` clamped to the real pool size (read server-side from the
 *    secret set), so the bonus can't be inflated.
 *  - distance covered = run points; outcome = arrived iff covered ≥ the chosen
 *    journey's (per-day resolved) distance, else died.
 *  - gold = sum of the journey's landmark gold if arrived, else 0.
 *  - percentile = capturePercentile(points ÷ the day's score max).
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
    perPrompt: [],
    gold: 0,
    outcome: "died",
    playerId: raw?.playerId ?? null,
  };

  const set = getDailySet(result.dailyDate);
  const journey = set?.journeys.find((j) => j.id === result.journey);

  // Per prompt: the client's capture base (trusted but clamped) plus a flat bonus
  // per named country. `named` is clamped to the real pool size (secret set) so
  // the bonus can't be inflated past what the prompt actually allows.
  let points = 0;
  const perPrompt: DailyPromptResult[] = [];
  for (const pp of Array.isArray(raw?.perPrompt) ? raw!.perPrompt : []) {
    const prompt = set?.prompts.find((p) => p.id === pp.promptId);
    const total = prompt
      ? validIdsFor(prompt, "countries").size
      : Number.isFinite(pp.total)
        ? pp.total
        : 0;
    const base = Math.max(
      0,
      Math.min(DAILY_PROMPT_MAX, Number.isFinite(pp.points) ? pp.points : 0),
    );
    let named = Math.max(0, Number.isFinite(pp.named) ? pp.named : 0);
    if (total > 0) named = Math.min(named, total);
    const score = base + DAILY_NAME_BONUS * named;
    points += score;
    perPrompt.push({ promptId: pp.promptId, named, total, points: Math.round(score) });
  }
  result.perPrompt = perPrompt;
  result.points = Math.round(points);

  // Distance covered is run points. Arrive iff it clears the journey's distance.
  const distance = journey?.distance ?? Infinity;
  const arrived = result.points >= distance;
  result.outcome = arrived ? "arrived" : "died";
  // Gold is collected at each landmark REACHED (progressive) — you keep what you
  // picked up even if you die before the destination. Dying only forfeits the
  // landmarks you never reached (including the big one AT the destination).
  const progress = Number.isFinite(distance) && distance > 0 ? Math.min(1, result.points / distance) : 0;
  result.gold = journey
    ? journey.landmarks.filter((l) => l.atFraction <= progress + 1e-9).reduce((sum, l) => sum + l.gold, 0)
    : 0;

  // Capture ratio vs the day's achievable max drives the synthetic percentile.
  const theoreticalMax = set ? dailyScoreMax(set.prompts) : 0;
  const ratio = theoreticalMax > 0 ? result.points / theoreticalMax : 0;
  const percentile = capturePercentile(ratio);

  // The run is over: reveal each prompt's valid answers so the player can review
  // them. Safe to send here (never during a live prompt).
  const answers: Record<string, string[]> = {};
  if (set) {
    for (const p of set.prompts) {
      answers[p.id] = labelAnswers(validIdsFor(p, "countries")).map((a) => a.name);
    }
  }

  return { percentile, result, answers };
}
