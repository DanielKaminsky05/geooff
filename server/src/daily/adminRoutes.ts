/**
 * Daily Trek — admin (Trek Builder) routes (Phase 3).
 *
 * The write surface for authoring curated days. Mounted ONLY when a
 * `DAILY_ADMIN_TOKEN` is configured (dev); production without it has no admin
 * surface. Every request must send a matching `x-admin-token`.
 *
 *   POST /daily/admin/sets     -> validate + compile + persist + overlay a trek
 *   GET  /daily/admin/catalog  -> prompt catalog (+ usage) and destination names
 *
 * Writes go through the service-role client (the browser never touches Supabase).
 * The authored set is placed in the in-memory overlay so `getDailySet` serves it
 * immediately, and persisted to `daily_sets` so it survives a restart.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { buildPromptPool, validIdsFor, labelAnswers } from "../prompts.js";
import { compileAuthoredSet } from "./authoredBuild.js";
import { setAuthoredSet, type AuthoredDailySet } from "./authoredSets.js";
import { toPublicDailySet } from "./types.js";
import type { AuthoredSetsRepo } from "./authoredSetsRepo.js";

export interface DailyAdminOptions {
  /** Shared secret the builder sends as `x-admin-token`. Required to mount. */
  token: string;
  /** Persistence for authored sets. `null` → overlay-only (ephemeral) + a warning. */
  repo?: AuthoredSetsRepo | null;
}

/** promptId -> the dates it has been used on (for the builder's de-dup flags). */
function usageMap(sets: AuthoredDailySet[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const s of sets) {
    for (const id of s.promptIds) {
      const list = usage.get(id) ?? [];
      list.push(s.dailyDate);
      usage.set(id, list);
    }
  }
  for (const list of usage.values()) list.sort();
  return usage;
}

/** Load every persisted authored set into the overlay (best-effort, at boot). */
export async function hydrateAuthoredSets(repo: AuthoredSetsRepo | null): Promise<number> {
  if (!repo) return 0;
  const sets = await repo.list();
  let loaded = 0;
  for (const authored of sets) {
    const compiled = compileAuthoredSet(authored);
    if (compiled.ok) {
      setAuthoredSet(authored.dailyDate, compiled.set);
      loaded++;
    } else {
      console.warn(`[daily/admin] skipping un-compilable set ${authored.dailyDate}: ${compiled.error}`);
    }
  }
  return loaded;
}

export function registerDailyAdminRoutes(app: Express, options: DailyAdminOptions): void {
  const { token } = options;
  const repo = options.repo ?? null;

  // Auth: constant-ish token compare on every admin request.
  const requireToken = (req: Request, res: Response, next: NextFunction): void => {
    if (req.header("x-admin-token") !== token) {
      res.status(401).json({ error: "unauthorized" } as never);
      return;
    }
    next();
  };

  app.get("/daily/admin/catalog", requireToken, async (_req: Request, res: Response) => {
    let usage = new Map<string, string[]>();
    try {
      if (repo) usage = usageMap(await repo.list());
    } catch (err) {
      console.warn("[daily/admin] usage lookup failed — returning empty usage.", err);
    }
    // Admin-only, so revealing each prompt's valid answers (country names) is
    // fine — the builder shows them while picking. `usedOn` powers de-dup.
    const prompts = buildPromptPool("countries")
      .map((p) => ({
        id: p.id,
        label: p.label,
        usedOn: usage.get(p.id) ?? [],
        answers: labelAnswers(validIdsFor(p, "countries"))
          .map((a) => a.name)
          .sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    res.json({ prompts });
  });

  app.post("/daily/admin/sets", requireToken, async (req: Request, res: Response) => {
    const authored = (req.body ?? {}) as AuthoredDailySet;
    const compiled = compileAuthoredSet(authored);
    if (!compiled.ok) {
      res.status(400).json({ error: compiled.error } as never);
      return;
    }

    let persisted = false;
    if (repo) {
      try {
        await repo.upsert(authored);
        persisted = true;
      } catch (err) {
        console.warn("[daily/admin] persist failed — overlay updated only.", err);
      }
    }

    // Serve it immediately regardless of persistence.
    setAuthoredSet(authored.dailyDate, compiled.set);
    res.json({ ok: true, persisted, set: toPublicDailySet(compiled.set) });
  });
}
