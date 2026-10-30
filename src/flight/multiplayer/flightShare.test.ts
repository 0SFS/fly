import { describe, expect, it } from "vitest";
import { createSettingsRegistry } from "foss-earth/settings";
import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import { OSFS_PARAMETERS } from "../settings/flightParameters";
import { captureSharedFlight, describeSharedFlight, sharedFlightUrl, type FlightShareSource } from "./flightShare";

const RADIANS = Math.PI / 180;
const base = "https://example.test/fly/";

function registry(searchParams?: URLSearchParams) {
  const settings = createSettingsRegistry({ storage: null, searchParams });
  settings.register(OSFS_PARAMETERS);
  return settings;
}

const climbing: FlightShareSource = {
  state: {
    ...EMPTY_FLIGHT_STATE,
    latDeg: 44.97775312345, lonDeg: -93.26501187654, altMeters: 412.34,
    headingRad: -60 * RADIANS, pitchRad: 7.04 * RADIANS, airspeedKts: 151.6,
    northVelocityFps: 120, eastVelocityFps: 160, verticalSpeedFps: 20,
  },
  groundHeightMeters: 250,
  selection: { aircraftId: "cirrus-vision-jet-g2", generationId: "g2", lodId: "hd" },
  aircraftLabel: "Vision Jet G2",
};

describe("shared flight", () => {
  it("starts a new flight in the shared state through the ordinary URL settings", () => {
    const flight = captureSharedFlight(climbing, registry())!;
    const url = new URL(sharedFlightUrl(base, flight));
    const settings = registry(url.searchParams);
    expect({
      latitude: settings.get("osfs.start.latitude"),
      longitude: settings.get("osfs.start.longitude"),
      height: settings.get("osfs.start.heightAboveGround"),
      heading: settings.get("osfs.start.heading"),
      pitch: settings.get("osfs.start.pitch"),
      climb: settings.get("osfs.start.climbAngle"),
      airspeed: settings.get("osfs.start.airspeed"),
    }).toEqual({ latitude: 44.977753, longitude: -93.265012, height: 162.3, heading: 300, pitch: 7, climb: 5.7, airspeed: 152 });
    for (const id of Object.keys(flight.start)) expect(settings.inspect(id).provenance).toBe("url");
    expect(settings.get("osfs.aircraft.id")).toBe("cirrus-vision-jet-g2");
    expect(settings.inspect("osfs.aircraft.generation").provenance).toBe("url");
    // Detail is the receiving device's own choice, and no key travels unless the pilot adds it.
    expect(url.searchParams.has("set.osfs.aircraft.lod")).toBe(false);
    expect([...url.searchParams.keys()].some(name => /key/i.test(name))).toBe(false);
    expect(url.pathname).toBe("/fly/");
  });

  it("keeps every value inside its setting's bounds, where a link value is not ignored", () => {
    const flight = captureSharedFlight({
      ...climbing,
      state: { ...climbing.state, altMeters: 40_000, airspeedKts: 2_000, headingRad: 2 * Math.PI - 0.0001 },
    }, registry())!;
    const settings = registry(new URL(sharedFlightUrl(base, flight)).searchParams);
    expect(settings.get("osfs.start.heightAboveGround")).toBe(15_000);
    expect(settings.get("osfs.start.airspeed")).toBe(800);
    expect(settings.get("osfs.start.heading")).toBe(360);
    expect(settings.inspect("osfs.start.airspeed").provenance).toBe("url");
  });

  it("starts level when the aircraft is not moving, and waits for the ground under it", () => {
    const parked = captureSharedFlight({
      ...climbing,
      state: { ...climbing.state, altMeters: 251.2, pitchRad: -0.01 * RADIANS, airspeedKts: 0,
        northVelocityFps: 0.3, eastVelocityFps: 0, verticalSpeedFps: 0.9 },
    }, registry())!;
    expect(parked.start).toMatchObject({ "osfs.start.heightAboveGround": 1.2, "osfs.start.pitch": 0, "osfs.start.climbAngle": 0 });
    expect(Object.is(parked.start["osfs.start.pitch"], -0)).toBe(false);
    expect(captureSharedFlight({ ...climbing, groundHeightMeters: null }, registry())).toBeNull();
    expect(captureSharedFlight({ ...climbing, state: { ...climbing.state, latDeg: Number.NaN } }, registry())).toBeNull();
  });

  it("describes the shared state in one line, in the pilot's height unit", () => {
    const flight = captureSharedFlight(climbing, registry())!;
    expect(describeSharedFlight(flight)).toBe("Vision Jet G2 · 44.977753, −93.265012 · 162 m AGL · heading 300° · pitch 7° · climb 5.7° · 152 kt");
    expect(describeSharedFlight(flight, "ft")).toContain("· 532 ft AGL ·");
  });
});
