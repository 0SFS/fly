// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it } from "vitest";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import { createSettingsRegistry } from "foss-earth/settings";
import { bootstrapAircraft } from "./bootstrapC172";
import { resolveAircraftDataFiles } from "./hydrateJsbsimData";
import { resetFlightLocation } from "./resetFlightLocation";
import { OSFS_PARAMETERS } from "../settings/flightParameters";
import { captureSharedFlight } from "../multiplayer/flightShare";
import { LEGACY_PHYSICS_HZ_120 } from "../physics/physicsRate";

const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });

async function create(aircraftId: AircraftId) {
  const sdk = await JSBSimSdk.create({
    moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false },
  });
  instances.push(sdk);
  const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
  for (const path of resolveAircraftDataFiles(manifest, aircraftId)) {
    sdk.writeDataFile(path, readFileSync("public/jsbsim-data/" + path, "utf8"));
  }
  await bootstrapAircraft(sdk, aircraftId, LEGACY_PHYSICS_HZ_120);
  return sdk;
}

const degrees = (radians: number) => radians * 180 / Math.PI;

describe("a shared flight's start in JSBSim", () => {
  it.each(["cessna-172", "f-35b"] as const)("starts the %s at the shared pitch along the shared climb angle", async aircraftId => {
    const sdk = await create(aircraftId);
    const state = resetFlightLocation(sdk, { latDeg: 45, lonDeg: -93, altMeters: 1500, headingDeg: 120, airspeedKts: 110, pitchDeg: 9, flightPathDeg: 4 }, 300, aircraftId);
    expect(degrees(state.pitchRad)).toBeCloseTo(9, 1);
    expect(degrees(Math.atan2(state.verticalSpeedFps, Math.hypot(state.northVelocityFps, state.eastVelocityFps)))).toBeCloseTo(4, 1);
    expect(state.airspeedKts).toBeCloseTo(110, 0);
    expect(degrees(state.headingRad)).toBeCloseTo(120, 1);
    expect(sdk.getPropertyValue("aero/alpha-deg")).toBeCloseTo(5, 1);
    // What a pilot shares from that state is the state it started in.
    const settings = createSettingsRegistry({ storage: null });
    settings.register(OSFS_PARAMETERS);
    const shared = captureSharedFlight({ state: readFlightState(sdk), groundHeightMeters: 300, selection: { aircraftId, lodId: "auto" }, aircraftLabel: aircraftId }, settings)!;
    expect(shared.start).toMatchObject({ "osfs.start.pitch": 9, "osfs.start.climbAngle": 4, "osfs.start.heightAboveGround": 1200, "osfs.start.airspeed": 110 });
  });

  it("keeps a shared pitch without airspeed, where there is no angle to the air", async () => {
    const sdk = await create("cessna-172");
    const state = resetFlightLocation(sdk, { latDeg: 45, lonDeg: -93, altMeters: 1500, airspeedKts: 0, pitchDeg: 12, flightPathDeg: 0 }, 300, "cessna-172");
    expect(degrees(state.pitchRad)).toBeCloseTo(12, 1);
  });
});
