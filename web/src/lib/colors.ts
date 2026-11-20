// Per-seat theme colors, keyed by slot. Slots are assigned lowest-free on the
// server (p1..p4), so colors stay stable for a given seat across a match.
import type { PlayerSlot } from "./protocol";

export const SLOT_COLORS: Record<PlayerSlot, string> = {
  p1: "var(--color-player1)", // emerald
  p2: "var(--color-player2)", // amber
  p3: "var(--color-player3)", // sky
  p4: "var(--color-player4)", // violet
};

/** CSS color for a seat's slot (falls back to player 1's emerald). */
export function slotColor(slot: PlayerSlot | undefined): string {
  return slot ? SLOT_COLORS[slot] : SLOT_COLORS.p1;
}
