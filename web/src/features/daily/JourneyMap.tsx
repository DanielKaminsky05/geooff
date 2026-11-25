/**
 * Daily Dive — journey map (PHASE 0 STUB, owned by Track D).
 *
 * Renders the atlas world as a backdrop with the active journey's route drawn
 * on it, a traveler token eased to `progress` (0..1) along the route, and
 * landmark pins that light up as they're passed. Purely presentational — driven
 * entirely by props, so Track C can place it and animate `progress` without
 * knowing its internals.
 *
 * The prop signature below is the FROZEN CONTRACT; Track D fills in the body
 * (use `geo.ts` project()/WORLD_VIEWBOX to align with the atlas) but keeps props.
 */

import type { DailyDestination, DailyLandmark, DailyRoute } from "../../lib/protocol";

export interface JourneyMapProps {
  /** The active journey's route polyline (start → destination). */
  route: DailyRoute;
  /** The day's destination city (drawn as the end marker). */
  destination: DailyDestination;
  /** Landmarks along this journey (pins; lit once progress passes atFraction). */
  landmarks: DailyLandmark[];
  /** 0..1 — fraction of the route the traveler has covered. */
  progress: number;
  className?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function JourneyMap(_props: JourneyMapProps) {
  return null;
}
