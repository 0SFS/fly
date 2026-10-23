import { describe, expect, it } from "vitest";
import { EMPTY_FLIGHT_STATE, type FlightState } from "@0sfs/ground-contact/flightState";
import { createFlightPathOverlay, predictFlightPath } from "./flightPathOverlay";

const flying = (patch: Partial<FlightState>): FlightState => ({ ...EMPTY_FLIGHT_STATE, latDeg: 45, lonDeg: -93, ...patch });

describe("predicted flight path", () => {
  it("carries an eastward velocity to the east and stays put when the aircraft does", () => {
    const east = predictFlightPath(flying({ eastVelocityFps: 100 / 0.3048 }));
    expect(east.length).toBeGreaterThan(2);
    expect(east[0]).toMatchObject({ latDeg: 45, lonDeg: -93 });
    expect(east.at(-1)!.lonDeg).toBeGreaterThan(-93);
    expect(east.at(-1)!.latDeg).toBeCloseTo(45, 4);
    expect(predictFlightPath(flying({ northVelocityFps: 0, eastVelocityFps: 0 }))).toEqual([]);
  });

  it("draws the path through the map's own projection", () => {
    const state = flying({ northVelocityFps: 200 });
    const overlay = createFlightPathOverlay(() => state);
    const calls: string[] = [];
    const context = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      beginPath: () => calls.push("begin"),
      moveTo: () => calls.push("move"),
      lineTo: () => calls.push("line"),
      stroke: () => calls.push("stroke"),
    } as unknown as CanvasRenderingContext2D;
    overlay.paint({
      context, width: 100, height: 100,
      project: (latDeg) => ({ x: latDeg, y: 0 }),
    });
    expect(calls.filter(call => call === "line").length).toBeGreaterThan(0);
    expect(overlay.revision()).toContain("45.0000");
    expect(createFlightPathOverlay(() => null).revision()).toBe("");
  });
});
