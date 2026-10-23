// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it } from "vitest";
import { applyFlightControls } from "@0sfs/controls/applyFlightControls";
import { captureSimulation, restoreSimulation } from "@0sfs/ground-contact/safeFlightState";
import { bootstrapAircraft } from "./bootstrapC172";
import { ENGINE_MODEL_IDS, getFdmProfile, type EngineModelId } from "./fdmProfiles";
import { resolveAircraftDataFiles } from "./hydrateJsbsimData";
import { resetFlightLocation } from "./resetFlightLocation";
import { LEGACY_FIXED_DT_120, LEGACY_PHYSICS_HZ_120 } from "../physics/physicsRate";

const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });
const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));

async function boot(engineModel: EngineModelId) {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  const profile = getFdmProfile("f-35b", engineModel);
  for (const file of resolveAircraftDataFiles(manifest, profile.dataPackage ?? "f-35b")) {
    sdk.writeDataFile(file, readFileSync("public/jsbsim-data/" + file, "utf8"));
  }
  await bootstrapAircraft(sdk, "f-35b", LEGACY_PHYSICS_HZ_120, { engineModel });
  const apply = (rudder = 0, brake = 0) => applyFlightControls(sdk, {
    elevator: 0, aileron: 0, rudder, throttle: 0, pitchTrim: 0, rollTrim: 0, flaps: 0, brake,
  }, 1, profile.rudderSign, { commandProperty: profile.stovl!.commandProperty, commandNorm: 0 });
  const step = (rudder = 0, brake = 0, seconds = LEGACY_FIXED_DT_120) => {
    for (let index = 0; index < seconds / LEGACY_FIXED_DT_120; index++) {
      apply(rudder, brake);
      expect(sdk.run()).toBe(true);
    }
  };
  const park = () => {
    resetFlightLocation(sdk, { latDeg: 35, lonDeg: -110, altMeters: 300,
      flightPreset: { mode: "departure", headingDeg: 90, groundElevationMeters: 300, flightPathDeg: 0 },
    }, 300, "f-35b");
    step(0, 1, 2);
    expect(sdk.getPropertyValue("gear/unit[1]/WOW")).toBe(1);
    expect(sdk.getPropertyValue("gear/unit[2]/WOW")).toBe(1);
  };
  return { sdk, step, park };
}

describe.each(ENGINE_MODEL_IDS)("F-35B %s differential ground braking", engineModel => {
  it.each([-1, 1])("turns with yaw %s through main-wheel friction with the brake lever released", async direction => {
    const { sdk, step, park } = await boot(engineModel);
    park();
    const rolling = captureSimulation(sdk);
    // Eastbound at 15 kt, with the settled wheel loads and physical gear down.
    rolling.initial["ic/vn-fps"] = 0;
    rolling.initial["ic/ve-fps"] = 15 * 1.6878098571;
    rolling.initial["ic/vd-fps"] = 0;
    restoreSimulation(sdk, rolling);
    let peakTurningMoment = 0;
    for (let index = 0; index < 1 / LEGACY_FIXED_DT_120; index++) {
      step(direction * 0.6);
      peakTurningMoment = Math.max(peakTurningMoment, direction * sdk.getPropertyValue("moments/n-gear-lbsft"));
    }
    expect(sdk.getPropertyValue("gear/unit[1]/WOW")).toBe(1);
    expect(sdk.getPropertyValue("gear/unit[2]/WOW")).toBe(1);
    expect(sdk.getPropertyValue("fcs/steer-cmd-norm")).toBe(0);
    expect(sdk.getPropertyValue("fcs/left-brake-cmd-norm")).toBeCloseTo(direction < 0 ? 0.6 : 0);
    expect(sdk.getPropertyValue("fcs/right-brake-cmd-norm")).toBeCloseTo(direction > 0 ? 0.6 : 0);
    expect(direction * sdk.getPropertyValue("velocities/r-rad_sec")).toBeGreaterThan(0.005);
    // The nose tire's lateral force can oppose the turn once yaw develops.
    expect(peakTurningMoment).toBeGreaterThan(1000);
  });

  it("combines yaw with partial/full braking, releases cleanly, and leaves airborne brakes symmetric", async () => {
    const { sdk, step, park } = await boot(engineModel);
    step(0.6, 0.4);
    expect(sdk.getPropertyValue("fcs/left-brake-cmd-norm")).toBeCloseTo(0.4);
    expect(sdk.getPropertyValue("fcs/right-brake-cmd-norm")).toBeCloseTo(0.4);
    park();
    for (const brake of [0, 0.4, 1]) {
      step(0.6, brake);
      expect(sdk.getPropertyValue("fcs/left-brake-cmd-norm")).toBeCloseTo(brake * 0.4);
      expect(sdk.getPropertyValue("fcs/right-brake-cmd-norm")).toBeCloseTo(brake * 0.4 + 0.6);
      step(-0.6, brake);
      expect(sdk.getPropertyValue("fcs/left-brake-cmd-norm")).toBeCloseTo(brake * 0.4 + 0.6);
      expect(sdk.getPropertyValue("fcs/right-brake-cmd-norm")).toBeCloseTo(brake * 0.4);
      step(0, brake);
      expect(sdk.getPropertyValue("fcs/left-brake-cmd-norm")).toBeCloseTo(brake);
      expect(sdk.getPropertyValue("fcs/right-brake-cmd-norm")).toBeCloseTo(brake);
    }
  });
});
