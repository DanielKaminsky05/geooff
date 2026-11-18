import { memo } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { mapFor } from "../lib/maps";
import type { CategoryId } from "../lib/protocol";

export interface WorldMapProps {
  /** ISO alpha-2 LOWERCASE codes that are filled. */
  filledIso: Set<string>;
  /** CSS color for filled countries (e.g. "var(--color-player1)"). */
  color: string;
  /**
   * Per-item fill colors (id → color). When given it takes precedence over
   * `filledIso`/`color` — used by the shared Last Standing map to colour each
   * claimed item by the player who took it.
   */
  colorByIso?: Map<string, string>;
  /** Which set's map to render (default "countries"). */
  categoryId?: CategoryId;
  className?: string;
}

/**
 * Renders the world map as an <svg> with one <path> per country.
 * Filled countries use `color` (or `colorByIso` per item); the rest use the
 * land token. Wrapped in react-zoom-pan-pinch for independent zoom/pan.
 */
function WorldMapInner({ filledIso, color, colorByIso, categoryId = "countries", className }: WorldMapProps) {
  const { viewBox, locations } = mapFor(categoryId);
  return (
    <div className={className} data-testid="world-map">
      <TransformWrapper minScale={1} maxScale={8} centerOnInit doubleClick={{ mode: "zoomIn" }}>
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          <svg
            viewBox={viewBox}
            width="100%"
            height="100%"
            role="img"
            aria-label="World map"
            preserveAspectRatio="xMidYMid meet"
          >
            {locations.map((loc) => {
              const perItem = colorByIso?.get(loc.id);
              const filled = colorByIso ? perItem !== undefined : filledIso.has(loc.id);
              const fill = perItem ?? (filled ? color : "var(--color-land)");
              return (
                <path
                  key={loc.id}
                  id={loc.id}
                  data-iso={loc.id}
                  data-filled={filled ? "true" : "false"}
                  d={loc.path}
                  fill={fill}
                  stroke="var(--color-border)"
                  strokeWidth={0.3}
                >
                  {/* Only reveal names of countries already guessed —
                      a tooltip on unguessed ones would leak the answer. */}
                  {filled && <title>{loc.name}</title>}
                </path>
              );
            })}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

export const WorldMap = memo(WorldMapInner);
export default WorldMap;
