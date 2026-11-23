import type { ReactNode } from "react";
import LastStandingView from "./LastStandingView";
import type { MatchModel } from "./matchModel";

/**
 * Gauntlet reuses the entire Last Standing shell (lives, per-turn timer,
 * shared colour-by-claimer map, turn gating, hit/heartbreak FX); the shell
 * adds hearts and the active prompt banner when `model.gauntlet` is set.
 */
export default function GauntletView({
  model,
  children,
}: {
  model: MatchModel;
  children?: ReactNode;
  /** Accepted for a uniform View signature; the gauntlet reveal overlay lives
   *  in the match container, not this shell. */
  onSkipReveal?: () => void;
}) {
  return <LastStandingView model={model}>{children}</LastStandingView>;
}
