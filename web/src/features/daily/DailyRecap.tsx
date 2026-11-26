/**
 * Daily Trek — end-of-run recap.
 *
 * Charcoal-themed end screen: the arrived/died headline, points (total +
 * per-prompt breakdown, no answer names so it stays spoiler-free), gold earned
 * and the new wallet balance, a synthetic percentile line, and a Share button
 * that copies a spoiler-free grid (see shareGrid.ts) to the clipboard.
 */

import { useEffect, useState } from "react";
import type { DailyRunResult } from "../../lib/protocol";
import { buildShareGrid } from "./shareGrid";
import { runCategory, promptTier } from "./tiers";

export interface DailyRecapProps {
  /** The server-reconciled finished run. */
  result: DailyRunResult;
  /** 0..100 synthetic percentile from /daily/finish. */
  percentile: number;
  /** How far along the road the run got (0..1) — drives the result category. */
  progress?: number;
  /** promptId → valid answers ({iso, name}), revealed by tapping a breakdown row. */
  answers?: Record<string, { iso: string; name: string }[]>;
  /** gold collected en route but forfeited by dying (0 if arrived). */
  goldLost?: number;
  /** The day's prompts (id + label), so the breakdown can name each prompt. */
  prompts?: { id: string; label: string }[];
  /** Gold balance AFTER this run was banked. */
  walletBalance: number;
  /** Optional: go back to Home / close the recap. */
  onClose?: () => void;
}

const JOURNEY_LABEL: Record<DailyRunResult["journey"], string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

/** Copy to clipboard with a graceful execCommand fallback for older/insecure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function DailyRecap({ result, percentile, progress = 0, answers, goldLost = 0, prompts, walletBalance, onClose }: DailyRecapProps) {
  const [copied, setCopied] = useState(false);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const labelById: Record<string, string> = {};
  for (const p of prompts ?? []) labelById[p.id] = p.label;
  const arrived = result.outcome === "arrived";
  const journey = JOURNEY_LABEL[result.journey] ?? result.journey;
  const pct = Math.max(0, Math.min(100, Math.round(percentile)));
  const category = runCategory(result.outcome, result.journey, progress);

  // Count the points up on reveal (the "pop"), respecting reduced motion.
  const [shownPoints, setShownPoints] = useState(0);
  useEffect(() => {
    const target = result.points;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target <= 0) {
      setShownPoints(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setShownPoints(Math.round(target * ease(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result.points]);

  async function onShare() {
    const ok = await copyText(buildShareGrid(result));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      data-testid="daily-recap"
      aria-live="polite"
      className="daily-recap-backdrop fade-in absolute inset-0 z-20 overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center text-[var(--color-chrome-ink)]">
        {/* Category + outcome */}
        <div className="max-w-full">
          <h2
            data-testid="daily-recap-headline"
            className="daily-tier-pop max-w-full break-words font-display font-black uppercase leading-[1.05]"
            style={{
              color: arrived ? "var(--color-chrome-gold)" : "var(--color-accent)",
              fontSize: "clamp(1.5rem, 9.5vw, 2.75rem)",
            }}
          >
            {category}
          </h2>
          <p className="mt-2 text-sm opacity-75">
            {arrived ? "You reached your destination." : "You died on the road."}
          </p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.25em] opacity-50">
            {journey} journey · {arrived ? "Arrived" : "Died"}
          </p>
        </div>

        {/* Points hero */}
        <div>
          <div
            data-testid="daily-recap-points"
            className="font-display text-6xl font-black leading-none tabular-nums sm:text-7xl"
            style={{ textShadow: "0 3px 16px rgba(0,0,0,0.55)" }}
          >
            {shownPoints.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.3em] opacity-55">points</div>
        </div>

        {/* Three stats, hairline-separated, no boxes */}
        <div className="flex w-full items-stretch justify-center">
          {arrived ? (
            <Stat testid="daily-recap-gold" label="Gold banked" value={`+${result.gold.toLocaleString()}`} color="var(--color-chrome-gold)" />
          ) : (
            <Stat testid="daily-recap-gold" label="Gold lost" value={goldLost.toLocaleString()} color="var(--color-accent)" />
          )}
          <div className="w-px self-stretch bg-white/15" />
          <Stat testid="daily-recap-wallet" label="Wallet" value={walletBalance.toLocaleString()} color="var(--color-chrome-gold)" />
          <div className="w-px self-stretch bg-white/15" />
          <Stat testid="daily-recap-percentile" label="Players beaten" value={`${pct}%`} />
        </div>

        {/* Breakdown — borderless, hairline-divided, tap to reveal answers */}
        <div className="w-full">
          <ol data-testid="daily-recap-breakdown" className="w-full text-left text-sm">
            {result.perPrompt.map((p, i) => {
              const tier = promptTier(p.named, p.total);
              const label = labelById[p.promptId] ?? `Prompt ${i + 1}`;
              const list = answers?.[p.promptId];
              const isOpen = openPrompt === p.promptId;
              return (
                <li key={p.promptId} className="border-t border-white/10 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => list && setOpenPrompt(isOpen ? null : p.promptId)}
                    aria-expanded={isOpen}
                    className={`flex w-full items-start justify-between gap-2 py-2 text-left tabular-nums transition ${list ? "hover:opacity-80" : "cursor-default"}`}
                  >
                    <span className="flex min-w-0 flex-1 items-start gap-1.5">
                      {list && <span className="mt-0.5 text-[10px] opacity-50">{isOpen ? "▾" : "▸"}</span>}
                      <span className="min-w-0 break-words opacity-80">{label}</span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-xs opacity-55">
                      {p.named}/{p.total}
                    </span>
                    <span
                      className="mt-0.5 w-14 shrink-0 text-right text-xs font-black uppercase"
                      style={{ color: tier.color }}
                    >
                      {tier.label}
                    </span>
                    <span className="mt-0.5 w-10 shrink-0 text-right font-semibold">
                      {p.points.toLocaleString()}
                    </span>
                  </button>
                  {isOpen && list && (
                    <div className="flex flex-wrap gap-1 pb-2 pl-4">
                      {(() => {
                        const got = new Set((p.namedIsos ?? []).map((x) => x.toLowerCase()));
                        return list.map((a) => {
                          const mine = got.has(a.iso.toLowerCase());
                          return (
                            <span
                              key={a.iso}
                              className="rounded px-1.5 py-0.5 text-xs font-medium"
                              style={{
                                color: mine ? "#86efac" : "#fca5a5",
                                background: mine ? "rgba(74,222,128,0.16)" : "rgba(239,68,68,0.16)",
                              }}
                            >
                              {a.name}
                            </span>
                          );
                        });
                      })()}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {answers && (
            <p className="mt-2 text-center text-[10px] opacity-45">Tap a prompt to reveal its answers</p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-1 flex w-full items-center justify-center gap-3">
          <button
            type="button"
            onClick={onShare}
            data-testid="daily-recap-share"
            className="rounded-lg bg-[var(--color-chrome-gold)] px-6 py-2 text-sm font-bold text-[var(--color-chrome)] transition hover:brightness-110"
          >
            {copied ? "Copied" : "Share"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              data-testid="daily-recap-close"
              className="rounded-lg border border-white/25 px-6 py-2 text-sm font-semibold text-current transition hover:bg-white/10"
            >
              Back home
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** One stat in the recap's hairline-separated stat row. */
function Stat({
  testid,
  label,
  value,
  color,
}: {
  testid?: string;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div data-testid={testid} className="flex flex-1 flex-col items-center px-2">
      <div className="font-display text-xl font-black tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-55">{label}</div>
    </div>
  );
}
