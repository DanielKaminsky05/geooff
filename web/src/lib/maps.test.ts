import { describe, it, expect } from "vitest";
import { maps, mapFor, fitViewBox } from "./maps";
import type { CategoryId } from "./protocol";

// Region membership (validated upstream): id → expected location count.
const REGIONS: { id: CategoryId; isoCount: number }[] = [
  { id: "europe", isoCount: 47 },
  { id: "africa", isoCount: 55 },
  { id: "asia", isoCount: 49 },
  { id: "middle-east", isoCount: 16 },
  { id: "americas", isoCount: 35 },
];

function parseViewBox(vb: string): [number, number, number, number] {
  const parts = vb.split(/\s+/).map(Number);
  expect(parts).toHaveLength(4);
  return parts as [number, number, number, number];
}

describe("region maps", () => {
  for (const { id, isoCount } of REGIONS) {
    it(`${id} has a non-degenerate viewBox and the expected location count`, () => {
      const map = maps[id];
      expect(map).toBeDefined();
      const [, , w, h] = parseViewBox(map!.viewBox);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(Number.isFinite(w)).toBe(true);
      expect(Number.isFinite(h)).toBe(true);
      // Every location filtered into the region must be a real svg path.
      expect(map!.locations.length).toBe(isoCount);
      for (const loc of map!.locations) {
        expect(loc.path.length).toBeGreaterThan(0);
      }
    });
  }

  it("mapFor resolves each region to its own map", () => {
    for (const { id } of REGIONS) {
      expect(mapFor(id)).toBe(maps[id]);
    }
  });
});

describe("fitViewBox", () => {
  it("fits a bounding box with ~4% padding around the path coordinates", () => {
    const [minX, minY, w, h] = parseViewBox(
      fitViewBox([{ id: "x", name: "X", path: "M0 0 L100 0 L100 50 Z" }]),
    );
    // Raw box is 0..100 x 0..50 → 4% padding on each side.
    expect(minX).toBeCloseTo(-4, 5);
    expect(minY).toBeCloseTo(-2, 5);
    expect(w).toBeCloseTo(108, 5);
    expect(h).toBeCloseTo(54, 5);
  });

  it("guards against a degenerate box", () => {
    expect(fitViewBox([])).toBe("0 0 1 1");
    expect(fitViewBox([{ id: "p", name: "P", path: "M5 5 L5 5 Z" }])).toBe("0 0 1 1");
  });
});
