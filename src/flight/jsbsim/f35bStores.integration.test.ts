// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it } from "vitest";
import { captureSimulation, restoreSimulation } from "@0sfs/ground-contact/safeFlightState";
import { isWeaponStoreProperty } from "@0sfs/stores/persistedStores";
import { STATIONS, stationDefinition } from "@0sfs/stores/stationTable";
import { aircraftHasWeaponStations, readStoreMirror, writeBayDoor, writeMasterArm, writeStation } from "@0sfs/stores/storeAttachment";
import { loadFromPreset, weaponMassLbs } from "@0sfs/stores/storeCatalog";
import { bootstrapAircraft } from "./bootstrapC172";
import { getFdmProfile, type EngineModelId } from "./fdmProfiles";
import { resolveAircraftDataFiles } from "./hydrateJsbsimData";
import { resetFlightLocation } from "./resetFlightLocation";
import { LEGACY_PHYSICS_HZ_120 } from "../physics/physicsRate";

const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });

const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
const plantXml = readFileSync("public/jsbsim-data/aircraft/F-35B-jsbsim/F-35B-jsbsim.xml", "utf8");

async function boot(engineModel?: EngineModelId) {
  const sdk = await JSBSimSdk.create({
    moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false },
  });
  instances.push(sdk);
  const profile = getFdmProfile("f-35b", engineModel);
  for (const file of resolveAircraftDataFiles(manifest, profile.dataPackage ?? "f-35b")) {
    sdk.writeDataFile(file, readFileSync("public/jsbsim-data/" + file, "utf8"));
  }
  await bootstrapAircraft(sdk, "f-35b", LEGACY_PHYSICS_HZ_120, { altFt: 3000, airspeedKts: 120, engineModel });
  return sdk;
}

function sample(sdk: JSBSimSdk) {
  return {
    weight: sdk.getPropertyValue("inertia/weight-lbs"),
    fuel: sdk.getPropertyValue("propulsion/total-fuel-lbs"),
    cgY: sdk.getPropertyValue("inertia/cg-y-in"),
  };
}

describe("F-35B weapon station model", () => {
  it("puts each station's pointmass and drag where the station table says", () => {
    const empirical = readFileSync("public/jsbsim-data/aircraft/F-35B-jsbsim-empirical/F-35B-jsbsim-empirical.xml", "utf8");
    for (const station of STATIONS) {
      const block = plantXml.match(new RegExp(`<pointmass name="Station ${station.station} store">[\\s\\S]*?</pointmass>`));
      expect(block, `station ${station.station}`).toBeTruthy();
      const location = block![0].match(/<x>([^<]+)<\/x><y>([^<]+)<\/y><z>([^<]+)<\/z>/);
      expect(Number(location?.[1])).toBe(station.locationIn.x);
      expect(Number(location?.[2])).toBe(station.locationIn.y);
      expect(Number(location?.[3])).toBe(station.locationIn.z);
      expect(plantXml).toContain(`<output>inertia/pointmass-weight-lbs[${station.pointmassIndex}]</output>`);
      expect(plantXml).toContain(`name="station-${station.station}-drag"`);
    }
    expect(plantXml).toContain("<time>1.5</time>");
    expect(empirical).not.toContain("stores/station[");
  });

  it("adds the published load, shifts the CG by one bomb's arm, and clears one station", async () => {
    const sdk = await boot();
    expect(aircraftHasWeaponStations(sdk)).toBe(true);
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[0]")).toBe(300);
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[1]")).toBe(300);
    for (const station of STATIONS) expect(sdk.getPropertyValue(`inertia/pointmass-weight-lbs[${station.pointmassIndex}]`)).toBe(0);
    const clean = sample(sdk);
    expect(clean.weight).toBeCloseTo(32000 + 600 + clean.fuel, 0);

    const bay = stationDefinition(4)!;
    writeStation(sdk, 4, "gbu-32");
    expect(sdk.getPropertyValue(`inertia/pointmass-weight-lbs[${bay.pointmassIndex}]`)).toBe(1013);
    expect(sdk.run()).toBe(true);
    const asymmetric = sample(sdk);
    expect(asymmetric.weight - clean.weight).toBeCloseTo(1013 - (clean.fuel - asymmetric.fuel), 0);
    const expectedCg = (clean.weight * clean.cgY + 1013 * bay.locationIn.y) / (clean.weight + 1013);
    expect(asymmetric.cgY).toBeCloseTo(expectedCg, 1);
    writeStation(sdk, 4, null);
    expect(sdk.run()).toBe(true);
    const before = sample(sdk);
    const strike = loadFromPreset("usmc-strike")!;
    expect(weaponMassLbs(strike)).toBe(2 * 1013 + 2 * 356);
    for (let station = 1; station <= 11; station++) writeStation(sdk, station, strike[station] ?? null);
    expect(sdk.run()).toBe(true);
    const loaded = sample(sdk);
    expect(loaded.weight - before.weight).toBeCloseTo(2 * 1013 + 2 * 356 - (before.fuel - loaded.fuel), 0);
    expect(readStoreMirror(sdk).load[5]).toBe("aim-120");
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[6]")).toBe(356);

    writeStation(sdk, 4, null);
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[5]")).toBe(0);
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[9]")).toBe(1013);
    expect(sdk.run()).toBe(true);
    expect(sdk.getPropertyValue("stores/station[4]/drag-lbs")).toBe(0);
    expect(sdk.getPropertyValue("stores/station[8]/drag-lbs")).toBeGreaterThan(0);
    expect(sdk.getPropertyValue("stores/station[5]/occupied")).toBe(1);
    expect(sdk.getPropertyValue("stores/station[7]/mass-lbs")).toBe(356);

    writeBayDoor(sdk, 0, true);
    for (let step = 0; step < 90; step++) expect(sdk.run()).toBe(true);
    const mid = sdk.getPropertyValue("stores/bay[0]/door-pos-norm");
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    for (let step = 0; step < 120; step++) expect(sdk.run()).toBe(true);
    expect(sdk.getPropertyValue("stores/bay[0]/door-pos-norm")).toBeCloseTo(1, 2);
    expect(sdk.getPropertyValue("stores/bay[1]/door-pos-norm")).toBe(0);
  });

  it("keeps a hung load through restore and a runway change, and a pre-armament snapshot stays clean", async () => {
    const sdk = await boot();
    const strike = loadFromPreset("usmc-strike")!;
    for (let station = 1; station <= 11; station++) writeStation(sdk, station, strike[station] ?? null);
    writeBayDoor(sdk, 1, true);
    writeMasterArm(sdk, true);
    expect(sdk.run()).toBe(true);
    const hung = readStoreMirror(sdk);
    const saved = captureSimulation(sdk);
    writeStation(sdk, 8, null);
    restoreSimulation(sdk, saved);
    expect(readStoreMirror(sdk).load).toEqual(hung.load);
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[9]")).toBe(1013);
    expect(sdk.getPropertyValue("stores/master-arm")).toBe(1);

    resetFlightLocation(sdk, {
      latDeg: 35, lonDeg: -110, altMeters: 300,
      flightPreset: { mode: "departure", headingDeg: 90, groundElevationMeters: 300, flightPathDeg: 0 },
    }, 300, "f-35b");
    expect(readStoreMirror(sdk).load).toEqual(hung.load);
    expect(sdk.getPropertyValue("stores/bay[1]/door-cmd-norm")).toBe(1);

    const bare = captureSimulation(sdk);
    for (const key of Object.keys(bare.controls)) if (isWeaponStoreProperty(key)) delete bare.controls[key];
    restoreSimulation(sdk, bare);
    expect(readStoreMirror(sdk).load.every(key => key === null)).toBe(true);
    expect(sdk.getPropertyValue("inertia/pointmass-weight-lbs[5]")).toBe(0);
    expect(sdk.getPropertyValue("stores/master-arm")).toBe(0);
  });

  it("flies the empirical model with no weapon stations and no added weight", async () => {
    const sdk = await boot("empirical");
    expect(aircraftHasWeaponStations(sdk)).toBe(false);
    expect(sdk.queryPropertyCatalog("stores/")).not.toContain("station[");
    expect(sdk.run()).toBe(true);
    const flying = sample(sdk);
    expect(flying.weight).toBeCloseTo(32000 + 600 + flying.fuel, 0);
    for (const index of [2, 6, 12]) expect(sdk.getPropertyValue(`inertia/pointmass-weight-lbs[${index}]`)).toBe(0);
  });
});
