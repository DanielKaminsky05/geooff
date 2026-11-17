import { memo } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { WORLD_VIEWBOX, WORLD_LOCATIONS } from "../lib/worldMap";

export interface WorldMapProps {
  /** ISO alpha-2 LOWERCASE codes that are filled. */
  filledIso: Set<string>;
  /** CSS color for filled countries (e.g. "var(--color-player1)"). */
  color: string;
  className?: string;
}

/**
 * Renders the world map as an <svg> with one <path> per country.
 * Filled countries use `color`; the rest use the land token.
 * Wrapped in react-zoom-pan-pinch for independent zoom/pan.
 */
function WorldMapInner({ filledIso, color, className }: WorldMapProps) {
  return (
    <div className={className} data-testid="world-map">
      <TransformWrapper minScale={1} maxScale={8} centerOnInit doubleClick={{ mode: "zoomIn" }}>
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          <svg
            viewBox={WORLD_VIEWBOX}
            width="100%"
            height="100%"
            role="img"
            aria-label="World map"
            preserveAspectRatio="xMidYMid meet"
          >
            {WORLD_LOCATIONS.map((loc) => {
              const filled = filledIso.has(loc.id);
              return (
                <path
                  key={loc.id}
                  id={loc.id}
                  data-iso={loc.id}
                  data-filled={filled ? "true" : "false"}
                  d={loc.path}
                  fill={filled ? color : "var(--color-land)"}
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
