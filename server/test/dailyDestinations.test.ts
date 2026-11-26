import { describe, it, expect } from "vitest";
import { destinations } from "../src/daily/destinations.js";
import type { GeoPoint, JourneyId } from "../src/protocol.js";

const JOURNEY_IDS: JourneyId[] = ["short", "medium", "long"];

/** Great-circle distance between two lat/lon points, in kilometres. */
function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline (sum of great-circle legs), in kilometres. */
function routeLengthKm(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

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

  it("every route has >= 3 points, all in valid range, ending at the destination", () => {
    for (const { destination, routes } of destinations) {
      for (const route of routes) {
        const label = `${destination.name}/${route.journeyId}`;
        expect(route.points.length, `${label} point count`).toBeGreaterThanOrEqual(3);
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

  it("the long route is an epic trek: origin is very far (> 5000 km) from the destination", () => {
    for (const { destination, routes } of destinations) {
      const long = routes.find((r) => r.journeyId === "long")!;
      const origin = long.points[0];
      const km = haversineKm(origin, destination.at);
      expect(
        km,
        `${destination.name} long origin->dest distance (${Math.round(km)} km)`,
      ).toBeGreaterThan(5000);
    }
  });

  it("every route's origin is a real cross-region journey (> 1200 km) — never a local hop", () => {
    for (const { destination, routes } of destinations) {
      for (const route of routes) {
        const origin = route.points[0];
        const km = haversineKm(origin, destination.at);
        expect(
          km,
          `${destination.name}/${route.journeyId} origin->dest (${Math.round(km)} km)`,
        ).toBeGreaterThan(1200);
      }
    }
  });

  it("total route length strictly increases short < medium < long", () => {
    for (const { destination, routes } of destinations) {
      const byId = new Map(
        routes.map((r) => [r.journeyId, routeLengthKm(r.points)]),
      );
      const short = byId.get("short")!;
      const medium = byId.get("medium")!;
      const long = byId.get("long")!;
      expect(short, `${destination.name} short<medium`).toBeLessThan(medium);
      expect(medium, `${destination.name} medium<long`).toBeLessThan(long);
    }
  });
});
