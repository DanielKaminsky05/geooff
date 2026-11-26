/**
 * Trek Builder — dev-only authoring page (Phase 3).
 *
 * Draw the trek on the world map: place + label the destination, draw the three
 * routes (short/medium/long), pick the five prompts (seeing each prompt's correct
 * answers and the dates it was already used), then save. The server validates,
 * compiles, persists to `daily_sets`, and serves the curated day immediately.
 * Mounted ONLY in dev (see App.tsx).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { mapFor } from "../lib/maps";
import { WORLD_VIEWBOX, project, xToLon, yToLat } from "../features/daily/geo";
import { trekNumber } from "../features/daily/trekNumber";
import type { GeoPoint, JourneyId, DailyLandmark } from "../features/daily/contract";
import {
  fetchCatalog,
  saveSet,
  listSets,
  getSet,
  deleteSet,
  DAILY_PROMPT_COUNT,
  type BuilderCatalog,
  type CatalogPrompt,
  type PublishedDay,
} from "../features/builder/builderApi";

const TOKEN_KEY = "geofight.builder.token";

const JOURNEYS: { id: JourneyId; label: string; color: string }[] = [
  { id: "short", label: "Short", color: "#2f8a3e" },
  { id: "medium", label: "Medium", color: "#c98516" },
  { id: "long", label: "Long", color: "#b83a3a" },
];
const DEST_COLOR = "#2563eb";

/** What a click on the map does. */
type Mode = "none" | "dest" | JourneyId;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const { viewBox, locations } = mapFor("countries");

export default function Builder() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [catalog, setCatalog] = useState<BuilderCatalog | null>(null);
  const [published, setPublished] = useState<PublishedDay[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [date, setDate] = useState<string>(todayIso());
  const [destName, setDestName] = useState("");
  const [destAt, setDestAt] = useState<GeoPoint | null>(null);
  const [routes, setRoutes] = useState<Record<JourneyId, GeoPoint[]>>({ short: [], medium: [], long: [] });
  const [landmarks, setLandmarks] = useState<Record<JourneyId, DailyLandmark[]>>({ short: [], medium: [], long: [] });
  const [promptIds, setPromptIds] = useState<string[]>(Array(DAILY_PROMPT_COUNT).fill(""));
  const [mode, setMode] = useState<Mode>("dest");
  const [saving, setSaving] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const load = useCallback(async () => {
    setError("");
    setStatus("Loading catalog…");
    try {
      const [cat, sets] = await Promise.all([fetchCatalog(token), listSets(token)]);
      setCatalog(cat);
      setPublished(sets);
      // Seed the gold editor from the defaults once (don't clobber edits on refresh).
      setLandmarks((prev) =>
        prev.short.length
          ? prev
          : {
              short: cat.journeyDefaults.short.map((l) => ({ ...l })),
              medium: cat.journeyDefaults.medium.map((l) => ({ ...l })),
              long: cat.journeyDefaults.long.map((l) => ({ ...l })),
            },
      );
      setStatus(`Loaded ${cat.prompts.length} prompts.`);
    } catch (err) {
      setCatalog(null);
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    }
  }, [token]);

  const loadDay = async (dd: string) => {
    setError("");
    try {
      const day = await getSet(token, dd);
      setDate(day.dailyDate);
      setDestName(day.destination.name);
      setDestAt(day.destination.at);
      // Stored routes run origin → city; the editor keeps city-first OUTWARD
      // waypoints (city excluded), so drop the final city point and reverse.
      const waypoints = (id: JourneyId): GeoPoint[] => {
        const r = day.routes.find((x) => x.journeyId === id);
        return r ? r.points.slice(0, -1).reverse() : [];
      };
      setRoutes({ short: waypoints("short"), medium: waypoints("medium"), long: waypoints("long") });
      setPromptIds([...day.promptIds, ...Array(DAILY_PROMPT_COUNT).fill("")].slice(0, DAILY_PROMPT_COUNT));
      setLandmarks({
        short: day.landmarks.short.map((l) => ({ ...l })),
        medium: day.landmarks.medium.map((l) => ({ ...l })),
        long: day.landmarks.long.map((l) => ({ ...l })),
      });
      setMode("none");
      setStatus(`Loaded ${dd} for editing. Save to overwrite it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeDay = async (d: string) => {
    if (!window.confirm(`Unpublish ${d}? It will revert to the generator.`)) return;
    setError("");
    try {
      await deleteSet(token, d);
      setStatus(`Unpublished ${d}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveToken = () => {
    localStorage.setItem(TOKEN_KEY, token);
    void load();
  };

  // Map click → geographic point, dispatched by the active mode.
  const onMapClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (mode === "none") return;
      const svg = svgRef.current;
      if (!svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      const geo: GeoPoint = { lat: yToLat(p.y), lon: xToLon(p.x) };
      // The city is the fixed anchor; a route click adds a waypoint OUTWARD from
      // it (the route auto-starts at the city — see the preview + save).
      if (mode === "dest") setDestAt(geo);
      else setRoutes((prev) => ({ ...prev, [mode]: [...prev[mode], geo] }));
    },
    [mode],
  );

  const undo = () => {
    if (mode === "dest") setDestAt(null);
    else if (mode !== "none") setRoutes((prev) => ({ ...prev, [mode]: prev[mode].slice(0, -1) }));
  };
  const clearActive = () => {
    if (mode === "dest") setDestAt(null);
    else if (mode !== "none") setRoutes((prev) => ({ ...prev, [mode]: [] }));
  };

  const setPromptAt = (i: number, id: string) =>
    setPromptIds((prev) => prev.map((p, idx) => (idx === i ? id : p)));

  const setGold = (j: JourneyId, i: number, gold: number) =>
    setLandmarks((prev) => ({ ...prev, [j]: prev[j].map((l, idx) => (idx === i ? { ...l, gold } : l)) }));

  const promptById = useMemo(() => {
    const m = new Map<string, CatalogPrompt>();
    catalog?.prompts.forEach((p) => m.set(p.id, p));
    return m;
  }, [catalog]);

  const chosen = promptIds.filter(Boolean);
  const hasDupes = new Set(chosen).size !== chosen.length;
  const routesComplete = JOURNEYS.every((j) => routes[j.id].length >= 1);
  const complete =
    !!date &&
    !!destName.trim() &&
    !!destAt &&
    routesComplete &&
    chosen.length === DAILY_PROMPT_COUNT &&
    !hasDupes;

  const submit = async () => {
    setError("");
    setStatus("");
    if (!destAt) return;
    setSaving(true);
    try {
      // The editor draws city-first (city → waypoints outward). The game wants
      // the destination as the LAST point (traveler walks origin → city), so
      // reverse: the farthest waypoint you drew becomes the origin.
      const toRoute = (id: JourneyId) => ({
        journeyId: id,
        points: [destAt, ...routes[id]].reverse(),
      });
      const res = await saveSet(token, {
        dailyDate: date,
        destination: { name: destName.trim(), at: destAt },
        routes: JOURNEYS.map((j) => toRoute(j.id)),
        promptIds,
        landmarks,
      });
      setStatus(
        `Saved ${date} → ${res.set.destination.name}. ${res.persisted ? "Persisted to Supabase." : "Saved to the running server only (not written to the database)."}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const poly = (pts: GeoPoint[]) => pts.map((p) => { const s = project(p); return `${s.x},${s.y}`; }).join(" ");

  const ctrl = "w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 focus:border-sky-400 focus:outline-none";

  return (
    <div className="flex h-dvh bg-slate-900 text-slate-100">
      {/* Map */}
      <div className="relative flex-1 bg-[var(--color-sea,#aecbe0)]">
        <svg
          ref={svgRef}
          viewBox={viewBox || WORLD_VIEWBOX}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
          onClick={onMapClick}
          style={{ cursor: mode === "none" ? "default" : "crosshair", display: "block" }}
        >
          {/* Land */}
          <g>
            {locations.map((loc) => (
              <path key={loc.id} d={loc.path} fill="var(--color-land, #e7d9b8)" stroke="var(--map-land-border, #9a8b6a)" strokeWidth={0.3} strokeLinejoin="round" />
            ))}
          </g>
          {/* Routes */}
          {JOURNEYS.map((j) => {
            const drawn = routes[j.id];
            // The route auto-starts at the city, then runs through the drawn
            // waypoints outward toward the origin.
            const pts = destAt ? [destAt, ...drawn] : drawn;
            return (
              <g key={j.id}>
                {pts.length >= 2 && (
                  <polyline points={poly(pts)} fill="none" stroke={j.color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={mode === j.id ? 1 : 0.8} />
                )}
                {routes[j.id].map((p, i) => { const s = project(p); return <circle key={i} cx={s.x} cy={s.y} r={1.8} fill={j.color} stroke="#fff" strokeWidth={0.4} />; })}
              </g>
            );
          })}
          {/* Destination */}
          {destAt && (() => { const s = project(destAt); return (
            <g>
              <circle cx={s.x} cy={s.y} r={3.2} fill={DEST_COLOR} stroke="#fff" strokeWidth={0.8} />
              {destName.trim() && (
                <text x={s.x + 5} y={s.y + 1.5} fontSize={9} fontWeight="bold" fill="#13233b" stroke="#fff" strokeWidth={0.6} paintOrder="stroke" style={{ userSelect: "none" }}>{destName.trim()}</text>
              )}
            </g>
          ); })()}
        </svg>
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-slate-900/80 px-3 py-1.5 text-xs">
          {mode === "none" ? "Pan mode" : mode === "dest" ? "Click the map to place the city" : destAt ? `Drawing the ${mode} route outward from ${destName.trim() || "the city"}` : "Place the city first"}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-slate-700 bg-slate-900 p-4">
        <header className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-bold">Trek Builder</h1>
          <Link to="/daily" className="text-sm text-sky-400 hover:underline">Playtest →</Link>
        </header>

        {/* Token */}
        <div className="mb-3 flex gap-2">
          <input type="password" className={ctrl} value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin token" />
          <button onClick={saveToken} className="shrink-0 rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold hover:bg-sky-500">Load</button>
        </div>

        {catalog && (
          <div className="space-y-4">
            {/* Date */}
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Go-live date (UTC)</label>
              <input type="date" className={ctrl} value={date} onChange={(e) => setDate(e.target.value)} />
              {date && <p className="mt-1 text-xs font-semibold text-sky-300">Trek #{trekNumber(date)}</p>}
            </div>

            {/* Destination city */}
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Destination city</label>
              <div className="flex gap-2">
                <input className={ctrl} value={destName} onChange={(e) => setDestName(e.target.value)} placeholder="City name" />
                <button onClick={() => setMode("dest")} className={`shrink-0 rounded px-3 py-1.5 text-sm font-semibold ${mode === "dest" ? "bg-blue-600" : "bg-slate-700 hover:bg-slate-600"}`}>Place</button>
              </div>
              <p className="mt-1 text-xs text-slate-500">{destAt ? `at ${destAt.lat.toFixed(1)}°, ${destAt.lon.toFixed(1)}°` : "not placed yet"}</p>
            </div>

            {/* Routes */}
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Routes (draw each)</label>
              <div className="space-y-1.5">
                {JOURNEYS.map((j) => (
                  <div key={j.id} className="flex items-center gap-2">
                    <button onClick={() => setMode(j.id)} className={`flex flex-1 items-center gap-2 rounded px-2.5 py-1.5 text-sm font-semibold ${mode === j.id ? "ring-2 ring-sky-400" : ""}`} style={{ background: mode === j.id ? j.color : "#334155" }}>
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: j.color }} />
                      {j.label}
                      <span className="ml-auto tabular-nums text-xs opacity-80">{routes[j.id].length} pts</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={undo} className="rounded bg-slate-700 px-2.5 py-1 text-xs hover:bg-slate-600">Undo point</button>
                <button onClick={clearActive} className="rounded bg-slate-700 px-2.5 py-1 text-xs hover:bg-slate-600">Clear {mode === "none" ? "" : mode}</button>
                <button onClick={() => setMode("none")} className={`rounded px-2.5 py-1 text-xs ${mode === "none" ? "bg-sky-600" : "bg-slate-700 hover:bg-slate-600"}`}>Pan</button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Each route starts at the city; draw outward to the origin.</p>
            </div>

            {/* Temple gold — tune each landmark's reward (positions are fixed). */}
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Temple gold</label>
              <div className="space-y-2">
                {JOURNEYS.map((j) => {
                  const ls = landmarks[j.id];
                  const total = ls.reduce((s, l) => s + (Number.isFinite(l.gold) ? l.gold : 0), 0);
                  return (
                    <details key={j.id} className="rounded border border-slate-700">
                      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: j.color }} />
                        {j.label}
                        <span className="ml-auto text-xs text-amber-300">{total} gold · {ls.length} temples</span>
                      </summary>
                      <div className="space-y-1 px-2 pb-2">
                        {ls.map((l, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="w-16 shrink-0 text-slate-400">{Math.round(l.atFraction * 100)}% {l.atFraction >= 1 ? "(end)" : ""}</span>
                            <input
                              type="number"
                              min={0}
                              className={`${ctrl} py-1`}
                              value={l.gold}
                              onChange={(e) => setGold(j.id, i, Math.max(0, Math.round(Number(e.target.value) || 0)))}
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>

            {/* Prompts */}
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Prompts ({chosen.length}/{DAILY_PROMPT_COUNT})</label>
              <div className="space-y-2">
                {promptIds.map((id, i) => {
                  const p = promptById.get(id);
                  return (
                    <div key={i} className="rounded border border-slate-700">
                      <select className={`${ctrl} rounded-b-none border-0`} value={id} onChange={(e) => setPromptAt(i, e.target.value)}>
                        <option value="">— pick prompt {i + 1} —</option>
                        {catalog.prompts.map((cp) => (
                          <option key={cp.id} value={cp.id}>{cp.label}{cp.usedOn.length ? `  (used ${cp.usedOn.length}×)` : ""}</option>
                        ))}
                      </select>
                      {p && (
                        <div className="px-2 pb-2">
                          {p.usedOn.length > 0 && (
                            <p className="mb-1 text-xs text-amber-400">Used on: {p.usedOn.join(", ")}</p>
                          )}
                          <details>
                            <summary className="cursor-pointer text-xs text-slate-400">{p.answers.length} correct answers</summary>
                            <ol className="mt-1 max-h-40 overflow-y-auto border border-slate-700">
                              {p.answers.map((a) => (
                                <li key={a} className="truncate border-b border-slate-800 px-2 py-0.5 text-xs text-slate-300">{a}</li>
                              ))}
                            </ol>
                          </details>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {hasDupes && <p className="mt-1 text-xs text-amber-400">Prompts must be distinct.</p>}
            </div>

            {/* Save */}
            <div className="space-y-2 border-t border-slate-700 pt-3">
              <button onClick={submit} disabled={!complete || saving} className="w-full rounded bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
                {saving ? "Saving…" : "Save trek"}
              </button>
              {status && <p className="text-sm text-emerald-400">{status}</p>}
              {error && <p className="text-sm text-rose-400">{error}</p>}
            </div>

            {/* Published days — remove to revert a date to the generator. */}
            {published.length > 0 && (
              <div className="border-t border-slate-700 pt-3">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Published days ({published.length})</label>
                <ul className="divide-y divide-slate-800 border border-slate-700">
                  {published.map((d) => {
                    const t = todayIso();
                    const when = d.dailyDate < t ? "past" : d.dailyDate === t ? "today" : "upcoming";
                    const tagCls = when === "today" ? "bg-emerald-700 text-emerald-100" : when === "past" ? "bg-slate-700 text-slate-300" : "bg-sky-800 text-sky-100";
                    return (
                      <li key={d.dailyDate} className="flex items-center gap-2 px-2 py-1 text-sm">
                        <span className={`shrink-0 rounded px-1 text-[10px] uppercase ${tagCls}`}>{when}</span>
                        <span className="truncate tabular-nums">#{trekNumber(d.dailyDate)} · {d.dailyDate} · {d.destinationName}</span>
                        <button onClick={() => loadDay(d.dailyDate)} className="ml-auto shrink-0 rounded bg-sky-700/80 px-2 py-0.5 text-xs hover:bg-sky-600">Edit</button>
                        <button onClick={() => removeDay(d.dailyDate)} className="shrink-0 rounded bg-rose-700/80 px-2 py-0.5 text-xs hover:bg-rose-600">Remove</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {!catalog && status && <p className="text-sm text-slate-400">{status}</p>}
        {!catalog && error && <p className="text-sm text-rose-400">{error}</p>}
      </aside>
    </div>
  );
}
