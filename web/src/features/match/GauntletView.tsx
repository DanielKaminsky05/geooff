import type { ReactNode } from "react";
import LastStandingView from "./LastStandingView";
import type { MatchModel } from "./matchModel";

/**
 * Gauntlet reuses the entire Last Standing shell (lives, per-turn timer,
 * shared colour-by-claimer map, turn gating, hit/heartbreak FX); the shell
 * adds hearts and the active prompt banner when `model.gauntlet` is set.
 */
export default function GauntletView({ model, children }: { model: MatchModel; children?: ReactNode }) {
  return <LastStandingView model={model}>{children}</LastStandingView>;
}
