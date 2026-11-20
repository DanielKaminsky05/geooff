import { memo } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { mapFor, TERRITORY_PARENT } from "../lib/maps";
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
  /**
   * When false, suppress the per-country <title> tooltip so hovering can't
   * reveal the spelling of a country. Defaults true (your own map). Opponents'
   * maps pass false (anti-cheat-lite).
   */
  revealNames?: boolean;
  className?: string;
}

/**
 * Renders the world map as an <svg> with one <path> per country.
 * Filled countries use `color` (or `colorByIso` per item); the rest use the
 * land token. Wrapped in react-zoom-pan-pinch for independent zoom/pan.
 */
function WorldMapInner({ filledIso, color, colorByIso, categoryId = "countries", revealNames = true, className }: WorldMapProps) {
  const { viewBox, locations } = mapFor(categoryId);
  // Pin absolutely to fill the pane without contributing an intrinsic size.
  // A portrait region viewBox (the Americas run Arctic→Patagonia) gave the
  // <svg height="100%"> an aspect-ratio-derived intrinsic height that blew out
  // its grid/flex track far past the viewport, so the map rendered stuck
  // scrolled to the top with South America below the fold. Taking it out of
  // flow (inset-0 over the `relative` pane) makes it track the pane's real box;
  // `xMidYMid meet` then fits the whole region, portrait or wide.
  return (
    <div className={`${className ?? ""} absolute inset-0`} data-testid="world-map">
      <TransformWrapper minScale={1} maxScale={8} centerOnInit disablePadding doubleClick={{ mode: "zoomIn" }}>
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
            style={{ display: "block" }}
          >
            {locations.map((loc) => {
              // A dependent territory fills with its sovereign (Greenland→dk, …).
              const key = TERRITORY_PARENT[loc.id] ?? loc.id;
              const perItem = colorByIso?.get(key);
              const filled = colorByIso ? perItem !== undefined : filledIso.has(key);
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
                      a tooltip on unguessed ones would leak the answer. And
                      only on your own map: an opponent's hover tooltip would
                      otherwise leak spellings you haven't named yet. */}
                  {filled && revealNames && <title>{loc.name}</title>}
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
