import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import WorldMap from "./WorldMap";

describe("WorldMap", () => {
  it("fills a country whose iso is in filledIso and leaves others as land", () => {
    const { container } = render(
      <WorldMap filledIso={new Set(["fr"])} color="var(--color-player1)" />,
    );

    const fr = container.querySelector('path[data-iso="fr"]');
    const us = container.querySelector('path[data-iso="us"]');

    expect(fr).not.toBeNull();
    expect(us).not.toBeNull();

    expect(fr?.getAttribute("data-filled")).toBe("true");
    expect(fr?.getAttribute("fill")).toBe("var(--color-player1)");

    expect(us?.getAttribute("data-filled")).toBe("false");
    expect(us?.getAttribute("fill")).toBe("var(--color-land)");
  });

  it("does not leak unguessed country names via <title> tooltips", () => {
    // Brazil has no dependent territories, so exactly one title shows.
    const { container } = render(
      <WorldMap filledIso={new Set(["br"])} color="var(--color-player1)" />,
    );
    const br = container.querySelector('path[data-iso="br"]');
    const us = container.querySelector('path[data-iso="us"]');
    expect(us?.querySelector("title")).toBeNull();
    expect(br?.querySelector("title")?.textContent).toBeTruthy();
    expect(container.querySelectorAll("path > title")).toHaveLength(1);
  });

  it("uses ISO alpha-2 lowercase ids from the map package", () => {
    const { container } = render(
      <WorldMap filledIso={new Set()} color="var(--color-player1)" />,
    );
    const paths = Array.from(container.querySelectorAll("path[data-iso]"));
    expect(paths.length).toBeGreaterThan(100);

    const ids = paths.map((p) => p.getAttribute("data-iso") ?? "");
    // Known subdivisions (US Minor Outlying Islands) aren't countries and
    // never match server isoCodes; every other id is ISO alpha-2 lowercase.
    const countryIds = ids.filter((id) => !id.startsWith("um-"));
    for (const iso of countryIds) {
      expect(iso).toMatch(/^[a-z]{2}$/);
    }
    // Spot-check a few real codes exist.
    expect(ids).toContain("us");
    expect(ids).toContain("fr");
    expect(ids).toContain("br");
  });

  it("fills a dependent territory when its sovereign is named", () => {
    const { container } = render(
      <WorldMap filledIso={new Set(["dk"])} color="var(--color-player1)" />,
    );
    // Greenland (gl) belongs to Denmark → fills with it.
    expect(container.querySelector('path[data-iso="gl"]')?.getAttribute("data-filled")).toBe("true");
    // Svalbard (sj, Norway) stays unfilled since Norway wasn't named.
    expect(container.querySelector('path[data-iso="sj"]')?.getAttribute("data-filled")).toBe("false");
  });

  it("renders exactly ONE identifiable path per country despite the wrap clones", () => {
    // The cylindrical wrap flanks the real tile with ±WORLD_W clones. Those
    // clones must stay invisible to every board/test query and the anti-cheat
    // <title> gate: no id / data-iso / data-filled / <title>.
    // Brazil has no dependent territories → exactly one filled country/title.
    const { container } = render(
      <WorldMap filledIso={new Set(["br"])} color="var(--color-player1)" />,
    );
    // Brazil appears once as an identifiable path (the clones carry no id/iso).
    expect(container.querySelectorAll('path[data-iso="br"]')).toHaveLength(1);
    expect(container.querySelectorAll("#br")).toHaveLength(1);
    // Every data-iso path is a real country code (no clone sneaks one in).
    const isoPaths = container.querySelectorAll("path[data-iso]");
    expect(isoPaths.length).toBeGreaterThan(100);
    // There are strictly MORE total paths than identifiable ones — the clones
    // exist (tripled geometry) but reveal nothing queryable.
    const allPaths = container.querySelectorAll("path");
    expect(allPaths.length).toBeGreaterThan(isoPaths.length);
    // Still exactly ONE <title> (Brazil), none leaked by the two clone tiles.
    expect(container.querySelectorAll("path > title")).toHaveLength(1);
  });

  it("colours a territory with its sovereign's colour via colorByIso", () => {
    const { container } = render(
      <WorldMap
        filledIso={new Set()}
        color="x"
        colorByIso={new Map([["no", "var(--color-player2)"]])}
      />,
    );
    const svalbard = container.querySelector('path[data-iso="sj"]'); // Svalbard → Norway
    expect(svalbard?.getAttribute("data-filled")).toBe("true");
    expect(svalbard?.getAttribute("fill")).toBe("var(--color-player2)");
  });
});
