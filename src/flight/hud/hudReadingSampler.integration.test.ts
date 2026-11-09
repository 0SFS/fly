import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { expect, it } from "vitest";
import { createControlPositionReader } from "../controlPositions";
import { bootstrapAircraft } from "../jsbsim/bootstrapC172";
import { getFdmProfile, registerFdmProfile, unregisterFdmProfile } from "../jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { createHudReadingSampler } from "./hudReadingSampler";
import mini from "../../../../DJI-Mini2/public/0sfs-mod.json";
import air from "../../../../DJI-Air-2S/public/0sfs-mod.json";

const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));

it.each([
  ["cessna-172", undefined], ["cirrus-vision-jet", undefined], ["f-35b", undefined], ["f-35b", "empirical"],
  ["dji-mini2", undefined], ["dji-air2s", undefined],
] as const)("reads %s %s HUD observations exactly as scalar reads, through reset and model reload", async (aircraftId, model) => {
  const drone = aircraftId === "dji-mini2" ? { repo: "DJI-Mini2", profile: mini.aircraft.fdmProfiles["dji-mini2"] }
    : aircraftId === "dji-air2s" ? { repo: "DJI-Air-2S", profile: air.aircraft.fdmProfiles["dji-air2s"] } : null;
  if (drone) registerFdmProfile(aircraftId, drone.profile as Parameters<typeof registerFdmProfile>[1]);
  const profile = getFdmProfile(aircraftId, model);
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl, persistence: { enabled: false }, log: { console: false } });
  let actuator: ReturnType<typeof createControlPositionReader> | null = null;
  let hud: ReturnType<typeof createHudReadingSampler> | null = null;
  try {
    if (drone) {
      const file = `aircraft/${profile.model}/${profile.model}.xml`;
      sdk.writeDataFile(file, readFileSync(`../${drone.repo}/public/jsbsim-data/${file}`, "utf8"));
    } else {
      const packages = model === "empirical" ? [aircraftId, `${aircraftId}-empirical-engine`] : [aircraftId];
      for (const file of new Set(packages.flatMap(id => resolveAircraftDataFiles(manifest, id)))) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
    }
    const boot = () => bootstrapAircraft(sdk, aircraftId, profile.requiresPhysicsHz ?? 60, { altFt: 5000, airspeedKts: 100, engineModel: model });
    await boot();
    actuator = createControlPositionReader(sdk, profile);
    hud = createHudReadingSampler(sdk, profile.stovl?.positionProperty);
    for (let step = 0; step < 1200; step++) {
      if (step === 600) await boot();
      sdk.setPropertyValue("fcs/flap-cmd-norm", (step % 100) / 100);
      sdk.setPropertyValue("fcs/elevator-cmd-norm", Math.sin(step / 19) * 0.2);
      expect(sdk.run()).toBe(true);
      // Scalar reads happen at the old read point, before the actuator batch.
      const expectedFlaps = sdk.getPropertyValue(profile.flapPosition.property) / profile.flapPosition.fullTravel;
      actuator.read();
      expect(Object.is(actuator.flapPosition(), expectedFlaps)).toBe(true);
      const expected = {
        weightLb: sdk.getPropertyValue("inertia/weight-lbs"),
        onGround: [0, 1, 2].some(index => {
          const wow = sdk.getPropertyValue(`gear/unit[${index}]/WOW`);
          return Number.isFinite(wow) && wow > 0.5;
        }),
        jetBorne: profile.stovl !== undefined && sdk.getPropertyValue(profile.stovl.positionProperty) > 0.01,
      };
      const actual = hud.read();
      for (const key of ["weightLb", "onGround", "jetBorne"] as const) expect(Object.is(actual[key], expected[key])).toBe(true);
    }
  } finally { actuator?.dispose(); hud?.dispose(); sdk.destroy(); if (drone) unregisterFdmProfile(aircraftId); }
});
