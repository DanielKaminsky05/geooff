/**
 * Trek Builder — dev-only authoring page (Phase 3, slice 1: metadata-first).
 *
 * Pick a date, a destination, and the five prompts (with "used already" flags),
 * then save. The server validates, compiles, persists to `daily_sets`, and
 * serves the curated day immediately. Route geometry and temple gold use the
 * chosen destination's defaults this slice; freehand drawing + gold editing come
 * later. Mounted ONLY in dev (see App.tsx).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCatalog,
  saveSet,
  DAILY_PROMPT_COUNT,
  type BuilderCatalog,
  type CatalogPrompt,
} from "../features/builder/builderApi";

const TOKEN_KEY = "geofight.builder.token";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A used-on hint for a prompt, e.g. "used 2026-01-03, 2026-02-14" or "". */
function usedLabel(p: CatalogPrompt): string {
  return p.usedOn.length ? `  — used ${p.usedOn.join(", ")}` : "";
}

export default function Builder() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [catalog, setCatalog] = useState<BuilderCatalog | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [date, setDate] = useState<string>(todayIso());
  const [destination, setDestination] = useState<string>("");
  const [promptIds, setPromptIds] = useState<string[]>(Array(DAILY_PROMPT_COUNT).fill(""));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setStatus("Loading catalog…");
    try {
      const cat = await fetchCatalog(token);
      setCatalog(cat);
      setDestination((d) => d || cat.destinations[0] || "");
      setStatus(`Loaded ${cat.prompts.length} prompts, ${cat.destinations.length} destinations.`);
    } catch (err) {
      setCatalog(null);
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    }
  }, [token]);

  // Auto-load once a token is present.
  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveToken = () => {
    localStorage.setItem(TOKEN_KEY, token);
    void load();
  };

  const setPromptAt = (i: number, id: string) => {
    setPromptIds((prev) => prev.map((p, idx) => (idx === i ? id : p)));
  };

  const chosen = promptIds.filter(Boolean);
  const hasDupes = new Set(chosen).size !== chosen.length;
  const complete = chosen.length === DAILY_PROMPT_COUNT && !hasDupes && !!destination && !!date;

  const submit = async () => {
    setError("");
    setStatus("");
    setSaving(true);
    try {
      const res = await saveSet(token, { dailyDate: date, destinationName: destination, promptIds });
      setStatus(
        `Saved ${date} → ${res.set.destination.name}. ${res.persisted ? "Persisted to Supabase." : "Overlay only (no DB configured)."}`,
      );
      await load(); // refresh usage flags
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 focus:border-sky-400 focus:outline-none";

  return (
    <div className="min-h-dvh bg-slate-900 px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">Trek Builder</h1>
          <Link to="/daily" className="text-sky-400 hover:underline">
            Playtest today →
          </Link>
        </header>

        {/* Admin token */}
        <section className="space-y-2">
          <label className="block text-sm font-semibold text-slate-300">Admin token</label>
          <div className="flex gap-2">
            <input
              type="password"
              className={inputCls}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="x-admin-token (DAILY_ADMIN_TOKEN)"
            />
            <button
              onClick={saveToken}
              className="shrink-0 rounded bg-sky-600 px-4 py-2 font-semibold hover:bg-sky-500"
            >
              Save & load
            </button>
          </div>
        </section>

        {catalog && (
          <>
            {/* Date */}
            <section className="space-y-2">
              <label className="block text-sm font-semibold text-slate-300">Go-live date (UTC)</label>
              <input
                type="date"
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </section>

            {/* Destination */}
            <section className="space-y-2">
              <label className="block text-sm font-semibold text-slate-300">Destination</label>
              <select
                className={inputCls}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {catalog.destinations.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                Routes and temple gold use this destination's defaults (freehand drawing comes later).
              </p>
            </section>

            {/* Prompts */}
            <section className="space-y-2">
              <label className="block text-sm font-semibold text-slate-300">
                Prompts ({chosen.length}/{DAILY_PROMPT_COUNT})
              </label>
              {promptIds.map((id, i) => (
                <select
                  key={i}
                  className={inputCls}
                  value={id}
                  onChange={(e) => setPromptAt(i, e.target.value)}
                >
                  <option value="">— pick prompt {i + 1} —</option>
                  {catalog.prompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {usedLabel(p)}
                    </option>
                  ))}
                </select>
              ))}
              {hasDupes && <p className="text-sm text-amber-400">Each prompt must be distinct.</p>}
            </section>

            {/* Save */}
            <section className="space-y-3 border-t border-slate-700 pt-4">
              <button
                onClick={submit}
                disabled={!complete || saving}
                className="rounded bg-emerald-600 px-5 py-2 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {saving ? "Saving…" : "Save trek"}
              </button>
              {status && <p className="text-sm text-emerald-400">{status}</p>}
              {error && <p className="text-sm text-rose-400">{error}</p>}
            </section>
          </>
        )}

        {!catalog && status && <p className="text-sm text-slate-400">{status}</p>}
        {!catalog && error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
