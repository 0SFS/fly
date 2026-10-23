import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import { applyFlightControls } from "@0sfs/controls/applyFlightControls";
import { createControlArbiterState, setArbiterEngaged, stepControlArbiter } from "@0sfs/autopilot/controlArbiter";
import { DISCONNECTED_ARDUPILOT_STATUS } from "@0sfs/autopilot/ardupilotStatus";
import { describe, expect, it } from "vitest";
import { BENCHMARK_ROUTES, createBenchmarkRouteController, type BenchmarkRouteId } from "./benchmarkRoutes";
import { bootstrapC172p } from "./jsbsim/bootstrapC172";
import { resetFlightLocation } from "./jsbsim/resetFlightLocation";
import { resolveAircraftDataFiles } from "./jsbsim/hydrateJsbsimData";
import { LEGACY_PHYSICS_HZ_120 } from "./physics/physicsRate";

// Real installed JSBSim and the public AP/control boundary, with fixed terrain
// and no renderer, network, wall-clock pacing or performance assertions.
async function simulate(id: BenchmarkRouteId, initialAirspeedKts = 110) {
  const route = BENCHMARK_ROUTES[id], ground = -27.952651837840676, dt = 1 / 120;
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false, stripAnsi: true } });
  try {
    const dataRoot = resolve(process.cwd(), "public/jsbsim-data");
    const manifest = JSON.parse(readFileSync(resolve(dataRoot, "manifest.json"), "utf8")) as { files: string[] };
    for (const file of resolveAircraftDataFiles(manifest, "cessna-172")) sdk.writeDataFile(file, readFileSync(resolve(dataRoot, file), "utf8"));
    await bootstrapC172p(sdk, LEGACY_PHYSICS_HZ_120, { latDeg: route.latDeg, lonDeg: route.lonDeg,
      airspeedKts: initialAirspeedKts, headingDeg: route.headingDeg, throttleNorm: 0.65 });
    const initial = resetFlightLocation(sdk, { latDeg: route.latDeg, lonDeg: route.lonDeg,
      altMeters: ground + route.heightAboveGroundMeters }, ground);
    const controller = createBenchmarkRouteController(route, initial, ground, dt, {}, () => 0);
    const pilot = { elevator: 0, aileron: 0, rudder: 0, throttle: .65, brake: 0, flaps: 0,
      pitchTrim: sdk.getPropertyValue("fcs/pitch-trim-cmd-norm"), rollTrim: 0 };
    let arbiter = setArbiterEngaged(createControlArbiterState(1, 0, .65), true);
    for (let step = 0; step < 21_600; step++) {
      const state = readFlightState(sdk), target = controller.targets(state), held = arbiter.our;
      arbiter.our = { ...held,
        roll: { ...held.roll, hasTarget: true, targetRad: target.rollRad },
        pitch: { ...held.pitch, hasTarget: true, targetRad: target.pitchRad },
        yaw: { ...held.yaw, hasTarget: true, targetRad: target.headingRad },
        throttle: { ...held.throttle, hasTarget: true, target: target.airspeedKts,
          command: held.throttle.hasTarget ? held.throttle.command : pilot.throttle } };
      const result = stepControlArbiter(arbiter, {
        settings: { version: 1, backend: "ours", throttleMode: "airspeed",
          axes: { roll: true, pitch: true, yaw: true, throttle: true, gear: true, flaps: true } },
        ardupilot: DISCONNECTED_ARDUPILOT_STATUS, pilot, gearDownNorm: 1, stickOverride: .5,
        flight: { dt, onGround: false, rollRad: state.rollRad, pitchRad: state.pitchRad,
          headingRad: state.headingRad, airspeedKts: state.airspeedKts,
          rollRateRad: sdk.getPropertyValue("velocities/p-rad_sec"),
          pitchRateRad: sdk.getPropertyValue("velocities/q-rad_sec"),
          yawRateRad: sdk.getPropertyValue("velocities/r-rad_sec") } });
      arbiter = result.state;
      applyFlightControls(sdk, result.result.controls, result.result.gearDownNorm, -1);
      if (!sdk.run()) throw new Error("JSBSim rejected a route step");
      controller.acceptStep(readFlightState(sdk), () => ground);
    }
    return controller.snapshot();
  } finally { sdk.destroy(); }
}

describe("W0 route altitude hold with the installed C172 physics", () => {
  it.each([["low", 110], ["cruise", 110], ["low", 100], ["low", 120]] as const)("keeps %s at an initial %s kt inside the tracking limits for all 180 simulated seconds", async (id, airspeed) => {
    const result = await simulate(id, airspeed);
    console.info(JSON.stringify({ route: id, initialAirspeedKts: airspeed, maxAltitudeErrorMeters: result.maxAltitudeErrorMeters,
      maxHeadingErrorDeg: result.maxHeadingErrorDeg, finalAltitudeErrorMeters: result.samples.at(-1)!.altitudeMslMeters - result.targetAltitudeMslMeters }));
    expect(result).toMatchObject({ status: "complete", acceptedSteps: 21_600, elapsedSeconds: 180, coverageValidation: "unverified" });
    expect(result.maxAltitudeErrorMeters).toBeLessThanOrEqual(20);
    expect(result.maxHeadingErrorDeg).toBeLessThanOrEqual(5);
    expect(Math.abs(result.samples.at(-1)!.altitudeMslMeters - result.targetAltitudeMslMeters)).toBeLessThan(5);
  }, 20_000);
});
