import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import JourneyMap from "./JourneyMap";
import { buildRouteGeometry, pointAtFraction } from "./routeGeometry";
import { project } from "./geo";
import { FIXTURE_DAILY_SET } from "./contract";

describe("routeGeometry", () => {
  it("measures cumulative length by arc, not point index", () => {
    // An L-shape: (0,0) -> (0,3) -> (4,3). Lengths 3 and 4, total 7.
    const geo = buildRouteGeometry([
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(geo.cumulative).toEqual([0, 3, 7]);
    expect(geo.length).toBe(7);
  });

  it("pointAtFraction walks by arc length and clamps", () => {
    const geo = buildRouteGeometry([
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(pointAtFraction(geo, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(geo, 1)).toEqual({ x: 4, y: 3 });
    // 0.5 of length 7 = 3.5 => 0.5 into the 2nd (horizontal) segment.
    expect(pointAtFraction(geo, 0.5)).toEqual({ x: 0.5, y: 3 });
    // Clamps out of range.
    expect(pointAtFraction(geo, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(geo, 5)).toEqual({ x: 4, y: 3 });
  });

  it("handles degenerate routes", () => {
    expect(pointAtFraction(buildRouteGeometry([]), 0.5)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(buildRouteGeometry([{ x: 2, y: 9 }]), 0.5)).toEqual({ x: 2, y: 9 });
  });
});

describe("JourneyMap", () => {
  const istanbul = FIXTURE_DAILY_SET.destination;
  const mediumRoute = FIXTURE_DAILY_SET.routes.find((r) => r.journeyId === "medium")!;
  const mediumLandmarks = FIXTURE_DAILY_SET.journeys.find((j) => j.id === "medium")!.landmarks;

  it("renders route, landmarks, destination and traveler from props", () => {
    const { getByTestId, getAllByTestId } = render(
      <JourneyMap
        route={mediumRoute}
        destination={istanbul}
        landmarks={mediumLandmarks}
        progress={0.5}
        className="x"
      />,
    );
    expect(getByTestId("journey-route")).toBeTruthy();
    expect(getByTestId("journey-destination")).toBeTruthy();
    expect(getByTestId("journey-traveler")).toBeTruthy();
    expect(getAllByTestId("journey-landmark")).toHaveLength(mediumLandmarks.length);
  });

  it("lights landmarks only once progress passes their fraction", () => {
    const { getAllByTestId } = render(
      <JourneyMap route={mediumRoute} destination={istanbul} landmarks={mediumLandmarks} progress={0.5} />,
    );
    const pins = getAllByTestId("journey-landmark");
    // At progress 0.5, landmarks at/below 0.5 are lit; the final (1.0) is not.
    expect(pins[0].getAttribute("data-lit")).toBe("true"); // earliest fraction
    expect(pins[pins.length - 1].getAttribute("data-lit")).toBe("false"); // arrival (1.0)
  });

  it("places the traveler between the start and the destination at mid progress", () => {
    const start = project(mediumRoute.points[0]);
    const end = project(istanbul.at);
    const { getByTestId } = render(
      <JourneyMap route={mediumRoute} destination={istanbul} landmarks={mediumLandmarks} progress={0.5} />,
    );
    const token = getByTestId("journey-traveler");
    const tx = Number(token.getAttribute("data-x"));
    const ty = Number(token.getAttribute("data-y"));
    // Istanbul route runs eastward, so x strictly increases start -> end.
    expect(tx).toBeGreaterThan(start.x);
    expect(tx).toBeLessThan(end.x);
    expect(Number.isFinite(ty)).toBe(true);
  });

  it("applies the className to the root", () => {
    const { container } = render(
      <JourneyMap route={mediumRoute} destination={istanbul} landmarks={mediumLandmarks} progress={0} className="my-map" />,
    );
    expect(container.querySelector(".daily-journey-map.my-map")).toBeTruthy();
  });
});
