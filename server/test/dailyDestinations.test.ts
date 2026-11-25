import { describe, it, expect } from "vitest";
import { destinations } from "../src/daily/destinations.js";
import type { JourneyId } from "../src/protocol.js";

const JOURNEY_IDS: JourneyId[] = ["short", "medium", "long"];

describe("daily dive destinations", () => {
  it("has at least 22 entries (no repeat within a 7-day window)", () => {
    expect(destinations.length).toBeGreaterThanOrEqual(22);
  });

  it("every destination name is unique", () => {
    const names = destinations.map((e) => e.destination.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every destination's coordinates are in valid range", () => {
    for (const { destination } of destinations) {
      const { lat, lon } = destination.at;
      expect(lat, `${destination.name} lat`).toBeGreaterThanOrEqual(-90);
      expect(lat, `${destination.name} lat`).toBeLessThanOrEqual(90);
      expect(lon, `${destination.name} lon`).toBeGreaterThanOrEqual(-180);
      expect(lon, `${destination.name} lon`).toBeLessThanOrEqual(180);
    }
  });

  it("every entry has exactly three routes covering short/medium/long", () => {
    for (const { destination, routes } of destinations) {
      expect(routes.length, `${destination.name} route count`).toBe(3);
      const ids = routes.map((r) => r.journeyId).sort();
      expect(ids, `${destination.name} journeyIds`).toEqual(
        [...JOURNEY_IDS].sort(),
      );
    }
  });

  it("every route has >= 2 points, all in valid range, ending at the destination", () => {
    for (const { destination, routes } of destinations) {
      for (const route of routes) {
        const label = `${destination.name}/${route.journeyId}`;
        expect(route.points.length, `${label} point count`).toBeGreaterThanOrEqual(2);
        for (const p of route.points) {
          expect(p.lat, `${label} lat`).toBeGreaterThanOrEqual(-90);
          expect(p.lat, `${label} lat`).toBeLessThanOrEqual(90);
          expect(p.lon, `${label} lon`).toBeGreaterThanOrEqual(-180);
          expect(p.lon, `${label} lon`).toBeLessThanOrEqual(180);
        }
        const last = route.points[route.points.length - 1];
        expect(last, `${label} last point`).toEqual(destination.at);
      }
    }
  });

  it("route lengths grow with journey ambition (short <= medium <= long points)", () => {
    for (const { destination, routes } of destinations) {
      const byId = new Map(routes.map((r) => [r.journeyId, r.points.length]));
      const short = byId.get("short")!;
      const medium = byId.get("medium")!;
      const long = byId.get("long")!;
      expect(short, `${destination.name} short<=medium`).toBeLessThanOrEqual(medium);
      expect(medium, `${destination.name} medium<=long`).toBeLessThanOrEqual(long);
    }
  });
});
