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
});
