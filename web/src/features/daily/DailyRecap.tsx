/**
 * Daily Dive — end-of-run recap (PHASE 0 STUB, owned by Track E).
 *
 * Shows the headline (arrived / died), points (total + per-prompt), gold earned
 * and the new wallet balance, the synthetic percentile, and a spoiler-free share
 * action (via shareGrid.ts). Charcoal-themed to match the rest of the game.
 *
 * The prop signature below is the FROZEN CONTRACT; Track E fills in the body
 * but keeps props so Track C's page composes it unchanged.
 */

import type { DailyRunResult } from "../../lib/protocol";

export interface DailyRecapProps {
  /** The server-reconciled finished run. */
  result: DailyRunResult;
  /** 0..100 synthetic percentile from /daily/finish. */
  percentile: number;
  /** Gold balance AFTER this run was banked. */
  walletBalance: number;
  /** Optional: go back to Home / close the recap. */
  onClose?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function DailyRecap(_props: DailyRecapProps) {
  return null;
}
