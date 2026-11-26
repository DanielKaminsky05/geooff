/**
 * Daily Dive — end-of-run recap (owned by Track E).
 *
 * Charcoal-themed end screen: the arrived/died headline, points (total +
 * per-prompt breakdown, no answer names so it stays spoiler-free), gold earned
 * and the new wallet balance, a synthetic percentile line, and a Share button
 * that copies a spoiler-free grid (see shareGrid.ts) to the clipboard.
 *
 * The prop signature is the FROZEN CONTRACT; Track C composes it unchanged.
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

export default function DailyRecap({ result, percentile, progress = 0, walletBalance, onClose }: DailyRecapProps) {
  const [copied, setCopied] = useState(false);
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
      className="fade-in absolute inset-0 z-20 flex items-center justify-center p-3 bg-black/40 backdrop-blur-sm"
    >
      {/* Floating card — the journey map stays visible behind/around it. */}
      <div className="chrome-ink flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--color-chrome-gold)]/40 bg-[var(--color-chrome)]/95 shadow-2xl">
      {/* Headline */}
      <header className="chrome-bar chrome-ink shrink-0 border-b border-[var(--color-chrome-gold)]/40 px-4 py-5 text-center">
        <h2
          data-testid="daily-recap-headline"
          className="daily-recap-pop font-display text-4xl font-black uppercase tracking-wide sm:text-5xl"
          style={{ color: arrived ? "var(--color-chrome-gold)" : "var(--color-accent)" }}
        >
          {category}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {arrived ? "You reached your destination." : "You died on the road."}
        </p>
        <p className="mt-0.5 text-xs uppercase tracking-widest text-muted">
          {journey} journey · {arrived ? "Arrived" : "Died"}
        </p>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          {/* Points */}
          <section className="text-center">
            <div
              data-testid="daily-recap-points"
              className="font-display text-5xl font-black tabular-nums"
            >
              {shownPoints.toLocaleString()}
            </div>
            <div className="text-xs uppercase tracking-widest text-muted">points</div>

            <ol
              data-testid="daily-recap-breakdown"
              className="chrome-bar chrome-ink mt-3 flex flex-col gap-0.5 rounded-lg border border-[var(--color-chrome-gold)]/30 p-3 text-left text-sm"
            >
              {result.perPrompt.map((p, i) => {
                const tier = promptTier(p.named, p.total);
                return (
                  <li
                    key={p.promptId}
                    className="flex items-center justify-between gap-3 tabular-nums"
                  >
                    <span className="text-muted">Prompt {i + 1}</span>
                    <span className="flex-1 text-center text-muted">
                      {p.named} / {p.total}
                    </span>
                    <span
                      className="w-16 text-right text-xs font-semibold uppercase tracking-wide"
                      style={{ color: tier.full ? "var(--color-chrome-gold)" : undefined }}
                    >
                      {tier.label}
                    </span>
                    <span className="w-12 text-right font-semibold">{p.points.toLocaleString()}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Gold */}
          <section
            data-testid="daily-recap-gold"
            className="chrome-bar chrome-ink flex items-center justify-between gap-3 rounded-lg border border-[var(--color-chrome-gold)]/30 p-3"
          >
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">
                {arrived ? "Gold banked" : "Gold lost"}
              </div>
              <div
                className="font-display text-2xl font-black tabular-nums"
                style={{ color: arrived ? "var(--color-chrome-gold)" : "var(--color-accent)" }}
              >
                {arrived ? `+${result.gold.toLocaleString()}` : "0"}
              </div>
              {!arrived && (
                <div className="text-[11px] text-muted">
                  Fell short — this run banked nothing.
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-muted">Wallet</div>
              <div
                data-testid="daily-recap-wallet"
                className="font-display text-2xl font-black tabular-nums"
                style={{ color: "var(--color-chrome-gold)" }}
              >
                {walletBalance.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted">Spend soon.</div>
            </div>
          </section>

          {/* Percentile */}
          <section data-testid="daily-recap-percentile" className="text-center">
            <p className="text-sm">
              You beat about <span className="font-bold tabular-nums">{pct}%</span> of players
            </p>
            <p className="text-[11px] text-muted">estimate</p>
          </section>
        </div>
      </div>

      {/* Actions */}
      <footer className="chrome-bar chrome-ink shrink-0 border-t border-[var(--color-chrome-gold)]/40 px-4 py-4">
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-3">
          <button
            type="button"
            onClick={onShare}
            data-testid="daily-recap-share"
            className="rounded-lg bg-[var(--color-chrome-gold)] px-5 py-2 text-sm font-semibold text-[var(--color-chrome)] transition hover:brightness-110"
          >
            {copied ? "Copied" : "Share"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              data-testid="daily-recap-close"
              className="rounded-lg border border-[var(--color-chrome-gold)]/40 bg-surface-raised px-5 py-2 text-sm font-semibold transition hover:brightness-110"
            >
              Back home
            </button>
          )}
        </div>
      </footer>
      </div>
    </div>
  );
}
