import { describe, it, expect } from "vitest";
import { SUB_REGIONS } from "./subRegions";
import { REGION_IDS, REGION_ISO } from "./geo";
import { mapFor } from "./maps";

describe("sub-region tables vs the shared region lists", () => {
  for (const id of REGION_IDS) {
    it(`${id}: groups partition exactly the playable REGION_ISO ids`, () => {
      const config = SUB_REGIONS[id];
      expect(config).toBeDefined();
      const grouped = Object.values(config!.groups).flat();
      // No id in two groups, nothing extra (e.g. map-only "eh"), nothing missing.
      expect(new Set(grouped).size).toBe(grouped.length);
      expect([...grouped].sort()).toEqual([...REGION_ISO[id]].sort());
      // Every group is laid out in exactly one column and has a color.
      const laidOut = config!.columns.flat();
      expect([...laidOut].sort()).toEqual(Object.keys(config!.groups).sort());
      for (const label of laidOut) expect(config!.colors[label]).toBeTruthy();
    });

    it(`${id}: every playable id has a shape on the region map`, () => {
      const mapIds = new Set(mapFor(id).locations.map((l) => l.id));
      expect(REGION_ISO[id].filter((iso) => !mapIds.has(iso))).toEqual([]);
    });
  }

  it("Western Sahara is drawn on the Africa map but is not playable", () => {
    expect(mapFor("africa").locations.some((l) => l.id === "eh")).toBe(true);
    expect(REGION_ISO.africa).not.toContain("eh");
  });
});
