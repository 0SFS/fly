import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import type { QuadVehicleModData } from "@0sfs/mods/schema";
import { createAirframe, G } from "@0sfs/multirotor/airframe";
import { CONTROL, PLANT } from "@0sfs/multirotor/layout";
import { createMultirotor, type FlightCommand } from "@0sfs/multirotor/multirotor";
import { loadMultirotor, type MultirotorCore } from "@0sfs/multirotor/wasm";
import common from "../../../../Quadcopter/public/0sfs-mod.json";
import mini from "../../../../DJI-Mini2/public/0sfs-mod.json";
import { createDroneFlightModel, DRONE_READ_PATHS, type DroneFlightModel } from "./droneFlightModel";
import { resolveQuadPropeller } from "./quadRegistry";
import { PHYSICS_DT } from "./droneTypes";

vi.mock("@0sfs/multirotor/wasm", () => ({ loadMultirotor: vi.fn() }));
const profile = { ...mini.quad as QuadVehicleModData, propeller: resolveQuadPropeller(mini.quad as QuadVehicleModData), properties: common.quadcopter.properties };
const flight: FlightCommand = {
  vn: 0, ve: 0, vd: 0, yawMode: CONTROL.YAW_RATE, yaw: 0, mode: CONTROL.MODE_FLYING,
  tanTiltMax: Math.tan(25 * Math.PI / 180), yawRateMaxRad: Math.PI / 3,
};
const models: DroneFlightModel[] = [];
beforeEach(() => { vi.mocked(loadMultirotor).mockReset().mockImplementation(() => new Promise(() => {})); });
afterEach(() => { for (const model of models.splice(0)) model.dispose(); });

function fakeSdk(overrides: Record<string, number> = {}) {
  const properties: Record<string, number> = Object.fromEntries(DRONE_READ_PATHS.map(path => [path, 0]));
  Object.assign(properties, {
    "inertia/mass-slugs": .249 / 14.5939029,
    "inertia/ixx-slugs_ft2": 3.2e-4 / (4.4482216152605 * .3048),
    "inertia/iyy-slugs_ft2": 4.341e-4 / (4.4482216152605 * .3048),
    "inertia/izz-slugs_ft2": 6.932e-4 / (4.4482216152605 * .3048),
    "atmosphere/rho-slugs_ft3": 1.225 / 515.3788184,
    "position/h-sl-ft": 100 / .3048, "position/lat-geod-deg": 45, "position/long-gc-deg": -93,
    "simulation/sim-time-sec": 10,
  }, overrides);
  function batch(paths: readonly string[]) {
    return {
      paths,
      read: vi.fn((target = new Float64Array(paths.length)) => {
        target.set(paths.map(path => properties[path] ?? NaN));
        return target;
      }),
      write: vi.fn((values: ArrayLike<number>) => { paths.forEach((path, i) => { properties[path] = values[i]; }); }),
      dispose: vi.fn(),
    };
  }
  const batches: ReturnType<typeof batch>[] = [];
  const createPropertyBatch = vi.fn((paths: readonly string[]) => {
    const result = batch(paths);
    batches.push(result);
    return result;
  });
  const sdk = { createPropertyBatch, getPropertyValue: vi.fn(), setPropertyValue: vi.fn() } as unknown as JSBSimSdk;
  const model = createDroneFlightModel(sdk, profile);
  models.push(model);
  return { sdk, model, properties, batches, createPropertyBatch };
}
function wrench(properties: Record<string, number>) {
  const p = profile.properties;
  return [p.fx, p.fy, p.fz, p.l, p.m, p.n].map(path => properties[path]);
}

describe("JSBSim multirotor bridge", () => {
  it("resolves a single read batch and a single writable body-wrench/armed batch", () => {
    const { model, createPropertyBatch, batches, sdk } = fakeSdk();
    expect(createPropertyBatch).toHaveBeenCalledTimes(2);
    expect(createPropertyBatch.mock.calls[0]).toEqual([DRONE_READ_PATHS]);
    expect(createPropertyBatch.mock.calls[1]).toEqual([[
      "multirotor/force-x-lbs", "multirotor/force-y-lbs", "multirotor/force-z-lbs",
      "multirotor/moment-l-ftlbf", "multirotor/moment-m-ftlbf", "multirotor/moment-n-ftlbf", "multirotor/armed",
    ], { create: true }]);
    model.read(0);
    model.step(flight, true);
    expect(batches[0].read).toHaveBeenCalledOnce();
    expect(batches[1].write).toHaveBeenCalledOnce();
    expect(sdk.getPropertyValue).not.toHaveBeenCalled();
    expect(sdk.setPropertyValue).not.toHaveBeenCalled();
  });
  it("reads NED and air-relative body velocities, rates, attitude, mass, inertia and density in SI", () => {
    const { model } = fakeSdk({
      "velocities/v-north-fps": 10, "velocities/v-east-fps": -20, "velocities/v-down-fps": 30,
      "velocities/u-aero-fps": -40, "velocities/v-aero-fps": 50, "velocities/w-aero-fps": -60,
      "velocities/p-rad_sec": .1, "velocities/q-rad_sec": -.2, "velocities/r-rad_sec": .3,
      "attitude/phi-rad": -.4, "attitude/theta-rad": .5, "attitude/psi-rad": -.6,
    });
    const sample = model.read(90)!;
    expect(sample).toMatchObject({ vn: 3.048, ve: -6.096, vd: 9.144, u: -12.192, v: 15.24,
      p: .1, q: -.2, r: .3, phi: -.4, theta: .5, psi: -.6, latDeg: 45, lonDeg: -93, simTimeS: 10 });
    expect(sample.w).toBeCloseTo(-18.288);
    expect(sample.massKg).toBeCloseTo(.249);
    expect([sample.ixx, sample.iyy, sample.izz]).toEqual([3.2e-4, 4.341e-4, 6.932e-4]);
    expect(sample.rho).toBeCloseTo(1.225);
    expect(sample.aglM).toBeCloseTo(10);
    expect(model.telemetry().aglM).toBeCloseTo(10);
  });
  it("spawns airborne near hover RPM and writes upward body force approximately equal to weight", () => {
    const { model, properties } = fakeSdk();
    model.read(null);
    const telemetry = model.step(flight, true);
    const hoverRpm = createAirframe(profile, PHYSICS_DT).hoverOmega(.249, 1.225) * 30 / Math.PI;
    expect(telemetry.hoverRpm).toBeCloseTo(hoverRpm);
    expect(telemetry.maxRpm).toBe(13300);
    for (const rpm of telemetry.rpm) expect(rpm / hoverRpm).toBeCloseTo(1, 2);
    expect(properties[profile.properties.fz]).toBeCloseTo(-.249 * G / 4.4482216152605, 3);
    expect(properties[profile.properties.fx]).toBeCloseTo(0);
    expect(properties[profile.properties.fy]).toBeCloseTo(0);
    expect(properties[profile.properties.armed]).toBe(1);
    expect(telemetry.aglM).toBeNull();
  });
  it("converts every wrench channel without changing its body-axis sign and reports RPM in rotor order", () => {
    const { model, properties } = fakeSdk({ "velocities/u-aero-fps": 20,
      "velocities/v-aero-fps": -10, "velocities/p-rad_sec": .1, "velocities/q-rad_sec": -.2,
      "attitude/phi-rad": .1, "attitude/theta-rad": -.2 });
    const sample = model.read(0)!;
    const reference = createMultirotor(createAirframe(profile, PHYSICS_DT));
    const omega = reference.airframe.hoverOmega(sample.massKg, sample.rho);
    for (let i = 0; i < 4; i++) reference.plant.state[PLANT.state.globals + i * PLANT.state.stride + PLANT.state.OMEGA] = omega;
    const command = { ...flight, vn: 2, ve: -3, yaw: .2 };
    reference.step(sample, command);
    const telemetry = model.step(command, true);
    const output = reference.plant.output;
    wrench(properties).forEach((value, i) => expect(value).toBeCloseTo(output[i] / (i < 3 ? 4.4482216152605 : 4.4482216152605 * .3048), 12));
    telemetry.rpm.forEach((rpm, i) => expect(rpm).toBeCloseTo(output[PLANT.output.globals + i * PLANT.output.stride + PLANT.output.OMEGA] * 30 / Math.PI, 10));
    expect(telemetry.acoustic).toMatchObject({ valid: true, armed: true, simTimeS: sample.simTimeS, airDensityKgM3: sample.rho,
      airVelocityBodyMps: [sample.u, sample.v, sample.w] });
    telemetry.acoustic.rotors.forEach((rotor, i) => {
      const at = PLANT.output.globals + i * PLANT.output.stride;
      expect(rotor).toEqual({ valid: true, rpm: telemetry.rpm[i], thrustN: output[at + PLANT.output.THRUST],
        shaftTorqueNm: output[at + PLANT.output.TORQUE], inducedVelocityMps: output[at + PLANT.output.INDUCED], vrs: output[at + PLANT.output.VRS] });
    });
    reference.dispose();
  });
  it("invalidates acoustic inputs on bad reads and clears them on reset", () => {
    const { model, properties } = fakeSdk();
    model.read(null); model.step(flight, true);
    expect(model.telemetry().acoustic.valid).toBe(true);
    properties["atmosphere/rho-slugs_ft3"] = NaN;
    expect(model.read(null)).toBeNull();
    expect(model.telemetry().acoustic.valid).toBe(false);
    expect(model.telemetry().acoustic.rotors.every(rotor => !rotor.valid)).toBe(true);
    model.reset();
    expect(model.telemetry().acoustic.rotors.every(rotor => rotor.rpm === 0 && rotor.thrustN === 0)).toBe(true);
  });
  it.each([0, 1, 2, 3])("uses STRUCTURE contact %s for ground state", foot => {
    const { model, properties } = fakeSdk({ [`contact/unit[${foot}]/WOW`]: 1, "gear/wow": 0 });
    expect(model.read(99.96)?.onGround).toBe(true);
    expect(model.step({ ...flight, mode: CONTROL.MODE_STOPPED }, false).rpm).toEqual([0, 0, 0, 0]);
    expect(wrench(properties)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(properties[profile.properties.armed]).toBe(0);
    properties[`contact/unit[${foot}]/WOW`] = 0;
    properties["gear/wow"] = 1;
    expect(model.read(99.96)?.onGround).toBe(false);
  });
  it.each(DRONE_READ_PATHS)("writes a zero wrench and skips NaN in %s", path => {
    const { model, properties } = fakeSdk();
    model.read(0); model.step(flight, true);
    properties[path] = NaN;
    expect(() => expect(model.read(0)).toBeNull()).not.toThrow();
    expect(wrench(properties)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("rejects invalid terrain, nonpositive mass, nonfinite commands and failed batch reads", () => {
    const { model, properties, batches } = fakeSdk();
    expect(model.read(Infinity)).toBeNull();
    expect(wrench(properties)).toEqual([0, 0, 0, 0, 0, 0]);
    properties["inertia/mass-slugs"] = 0;
    expect(model.read(0)).toBeNull();
    properties["inertia/mass-slugs"] = .249 / 14.5939029;
    model.read(0);
    expect(() => model.step({ ...flight, vn: NaN }, true)).not.toThrow();
    expect(wrench(properties)).toEqual([0, 0, 0, 0, 0, 0]);
    batches[0].read.mockImplementationOnce(() => { throw new Error("SDK closed"); });
    expect(model.read(0)).toBeNull();
  });
  it.each([0, 20])("resets stopped rotors and setpoints when sim time changes discontinuously to %s", time => {
    const { model, properties } = fakeSdk();
    model.read(0); model.step({ ...flight, vn: 10, yaw: 1 }, true);
    properties["simulation/sim-time-sec"] = 10 + PHYSICS_DT;
    expect(model.read(0)?.reset).toBe(false);
    model.step(flight, true);
    properties["simulation/sim-time-sec"] = time;
    properties["contact/unit[0]/WOW"] = 1;
    expect(model.read(0)?.reset).toBe(true);
    expect(model.step({ ...flight, mode: CONTROL.MODE_STOPPED }, false).rpm).toEqual([0, 0, 0, 0]);
    expect(wrench(properties)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("runs TypeScript while loading and preserves hover state when the real WASM core arrives", async () => {
    let resolve!: (core: MultirotorCore) => void;
    vi.mocked(loadMultirotor).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { model, properties } = fakeSdk();
    expect(model.status().backend).toBe("typescript");
    model.read(0); model.step(flight, true);
    const before = [...model.telemetry().rpm];
    const { instantiateMultirotor } = await vi.importActual<typeof import("@0sfs/multirotor/wasm")>("@0sfs/multirotor/wasm");
    const core = await instantiateMultirotor(readFileSync(new URL("../../../../multirotor/wasm/single/multirotor.wasm", import.meta.url)));
    const dispose = vi.spyOn(core, "dispose");
    resolve(core);
    await Promise.resolve();
    expect(model.status()).toEqual({ backend: "wasm", reason: null });
    expect(model.telemetry().rpm).toEqual(before);
    properties["simulation/sim-time-sec"] += PHYSICS_DT;
    model.read(0); model.step(flight, true);
    expect(properties[profile.properties.fz]).toBeLessThan(0);
    model.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("keeps TypeScript and its failure reason when WASM loading fails", async () => {
    vi.mocked(loadMultirotor).mockRejectedValueOnce(new Error("load refused"));
    const { model, properties } = fakeSdk();
    await Promise.resolve();
    expect(model.status()).toEqual({ backend: "typescript", reason: "Error: load refused" });
    model.read(0); model.step(flight, true);
    expect(properties[profile.properties.fz]).toBeLessThan(0);
  });
  it("releases both batches once and disposes a core that arrives after the aircraft is gone", async () => {
    let resolve!: (core: MultirotorCore) => void;
    vi.mocked(loadMultirotor).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { model, batches } = fakeSdk();
    model.dispose(); model.dispose();
    for (const batch of batches) expect(batch.dispose).toHaveBeenCalledOnce();
    const core = { dispose: vi.fn() } as unknown as MultirotorCore;
    resolve(core);
    await Promise.resolve();
    expect(core.dispose).toHaveBeenCalledOnce();
  });
});

describe("bridge with real JSBSim aircraft", () => {
  it.each(["DJI-Mini2", "DJI-Air-2S"])("reads every required property and holds %s airborne", async directory => {
    const manifest = JSON.parse(readFileSync(new URL(`../../../../${directory}/public/0sfs-mod.json`, import.meta.url), "utf8"));
    const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
      persistence: { enabled: false }, log: { console: false, stripAnsi: true } });
    let model: DroneFlightModel | null = null;
    try {
      sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
      for (const file of manifest.jsbsimFiles as string[]) sdk.writeDataFile(file,
        readFileSync(new URL(`../../../../${directory}/public/jsbsim-data/${file}`, import.meta.url), "utf8"));
      const id = manifest.aircraft.definitions[0].id;
      expect(sdk.loadModel(manifest.aircraft.fdmProfiles[id].model)).toBe(true);
      sdk.setDt(PHYSICS_DT);
      const initialProperties: Record<string, number> = {
        "ic/lat-geod-deg": 45, "ic/long-gc-deg": -93, "ic/h-sl-ft": 10 / .3048,
        "ic/terrain-elevation-ft": 0, "ic/phi-deg": 0, "ic/theta-deg": 0, "ic/psi-true-deg": 0, "ic/vc-kts": 0,
        ...manifest.aircraft.fdmProfiles[id].initialProperties,
      };
      const initialBatch = sdk.createPropertyBatch(Object.keys(initialProperties), { create: true });
      try { initialBatch.write(Object.values(initialProperties)); expect(sdk.runIc()).toBe(true); }
      finally { initialBatch.dispose(); }
      const create = vi.spyOn(sdk, "createPropertyBatch");
      model = createDroneFlightModel(sdk, { ...manifest.quad, propeller: resolveQuadPropeller(manifest.quad), properties: common.quadcopter.properties });
      expect(create.mock.results[0].value.missing).toEqual([]);
      const initial = model.read(0)!;
      expect(initial).not.toBeNull();
      expect(initial.onGround).toBe(false);
      model.step(flight, true);
      expect(sdk.getPropertyValue(profile.properties.fz) / (-initial.massKg * G / 4.4482216152605)).toBeCloseTo(1, 2);
      expect(sdk.getPropertyValue(profile.properties.armed)).toBe(1);
      expect(sdk.run()).toBe(true);
      for (let i = 1; i < 240; i++) {
        expect(model.read(0)?.reset).toBe(false);
        model.step(flight, true);
        expect(sdk.run()).toBe(true);
      }
      expect(sdk.getPropertyValue("position/h-sl-ft") * .3048).toBeCloseTo(10, 1);
      expect(model.telemetry().rpm.every(rpm => rpm > 0)).toBe(true);
    } finally { model?.dispose(); sdk.destroy(); }
  });
});
