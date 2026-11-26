/**
 * Daily Trek — a small five-point star marker, shared by the journey maps.
 *
 * Used to mark the destination on both the route-choice board and the travel
 * map, so the same glyph reads identically across the Daily Trek screens.
 */

/** A small five-point star centred on (cx, cy). */
export function Star({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return <polygon points={pts.join(" ")} fill={fill} />;
}
