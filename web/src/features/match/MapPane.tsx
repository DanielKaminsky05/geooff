import type { CategoryId } from "../../lib/protocol";
import WorldMap from "../../components/WorldMap";

/** One player's map with an optional "title · count" corner label. */
export default function MapPane({
  title = "",
  colorVar,
  filled,
  categoryId,
  borderRight,
  hideTitle,
  revealNames = true,
}: {
  title?: string;
  colorVar: string;
  filled: Set<string>;
  categoryId: CategoryId;
  borderRight?: boolean;
  /** Suppress the corner label (e.g. when the floating HUD already shows it). */
  hideTitle?: boolean;
  /** Forwarded to WorldMap: false hides hover tooltips on a non-own map. */
  revealNames?: boolean;
}) {
  return (
    <div className={`relative flex h-full flex-col ${borderRight ? "md:border-r md:border-border" : ""}`}>
      {!hideTitle && (
        <div
          className="absolute left-3 top-3 z-10 rounded-lg bg-surface/80 px-3 py-1 text-xs font-semibold"
          style={{ color: colorVar }}
        >
          {title} · {filled.size}
        </div>
      )}
      <WorldMap
        filledIso={filled}
        color={colorVar}
        categoryId={categoryId}
        revealNames={revealNames}
        className="h-full w-full"
      />
    </div>
  );
}
