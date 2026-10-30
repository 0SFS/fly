import { describe, expect, it } from "vitest";
import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import { flightRegion } from "./flightRegion";
import { flightParameterDefaults } from "./settings/flightParameters";

const state = { ...EMPTY_FLIGHT_STATE, latDeg: 0, lonDeg: 0, altMeters: 250 };
const fps = (mps: number) => mps / 0.3048;

describe("aircraft terrain regions", () => {
  it("gives drones a smaller sphere and finer detail than planes without changing pose", () => {
    const settings = flightParameterDefaults();
    const drone = flightRegion(state, true, 0.2, settings);
    const plane = flightRegion(state, false, 10, settings);
    expect(drone.region.radiusMeters).toBe(15);
    expect(plane.region.radiusMeters).toBe(200);
    expect(drone.final.googleErrorMeters).toBeLessThan(plane.final.googleErrorMeters);
    expect(drone.final.rasterZoom).toBeGreaterThan(plane.final.rasterZoom);
    expect(drone.region.center).toEqual({ latDeg: 0, lonDeg: 0, altitudeMeters: 250 });
    expect(plane.region.center).toEqual(drone.region.center);
  });

  it("expands a moving drone's sphere to its speed horizon and never adds a cone", () => {
    const region = flightRegion({ ...state, northVelocityFps: fps(20) }, true, 0.2, flightParameterDefaults());
    expect(region.region.radiusMeters).toBeCloseTo(30.8);
    expect(region.region.cone).toBeUndefined();
    const fast = flightRegion({ ...state, northVelocityFps: fps(1000) }, true, 0.2, flightParameterDefaults());
    expect(fast.region.radiusMeters).toBe(100);
  });

  it.each([
    [{ northVelocityFps: fps(10) }, { x: 0, y: 0, z: 1 }],
    [{ eastVelocityFps: fps(10) }, { x: 0, y: 1, z: 0 }],
    [{ verticalSpeedFps: fps(10) }, { x: 1, y: 0, z: 0 }],
    [{ verticalSpeedFps: fps(-10) }, { x: -1, y: 0, z: 0 }],
  ])("points a plane's cone along its 3D ground velocity: %j", (velocity, expected) => {
    const region = flightRegion({ ...state, ...velocity, headingRad: 1.2, airspeedKts: 300 }, false, 10, flightParameterDefaults());
    const cone = region.region.cone!;
    expect(cone.lengthMeters).toBeCloseTo(50);
    for (const axis of ["x", "y", "z"] as const) expect(cone.directionEcef[axis]).toBeCloseTo(expected[axis]);
  });

  it("normalizes mixed velocity at the pole and dateline independently of heading", () => {
    const moving = { ...state, latDeg: 90, lonDeg: 180, northVelocityFps: fps(3), eastVelocityFps: fps(4), verticalSpeedFps: fps(12) };
    const settings = flightParameterDefaults();
    const cone = flightRegion(moving, false, 1, settings).region.cone!;
    expect(Math.hypot(cone.directionEcef.x, cone.directionEcef.y, cone.directionEcef.z)).toBeCloseTo(1);
    expect(cone.lengthMeters).toBeCloseTo(65);
    expect(flightRegion({ ...moving, headingRad: 2.5, airspeedKts: 500 }, false, 1, settings).region.cone).toEqual(cone);
  });

  it("omits a plane cone at rest and caps fast-aircraft lookahead", () => {
    const settings = flightParameterDefaults();
    expect(flightRegion(state, false, 10, settings).region.cone).toBeUndefined();
    expect(flightRegion({ ...state, eastVelocityFps: fps(0.49) }, false, 10, settings).region.cone).toBeUndefined();
    expect(flightRegion({ ...state, eastVelocityFps: fps(10000) }, false, 10, settings).region.cone!.lengthMeters).toBe(10000);
  });

  it("caps body-driven demand and keeps final targets at least as fine as minimum", () => {
    const settings = flightParameterDefaults({
      "osfs.region.plane.radiusCap": 50,
      "osfs.region.plane.minimumError": 1,
      "osfs.region.plane.finalError": 8,
      "osfs.region.plane.minimumZoom": 17.4,
      "osfs.region.plane.finalZoom": 14.4,
    });
    const result = flightRegion(state, false, 1000, settings);
    expect(result.region.radiusMeters).toBe(50);
    expect(result.minimum.googleErrorMeters).toBe(result.final.googleErrorMeters);
    expect(result.minimum.rasterZoom).toBe(result.final.rasterZoom);
    expect(result.final.rasterZoom).toBe(14);
    expect(flightRegion(state, false, NaN, settings).region.radiusMeters).toBe(50);
  });
});
