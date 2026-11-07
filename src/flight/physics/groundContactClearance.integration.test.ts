import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import {
  GEAR_DOWN_POSITION, groundContactClearanceMeters, groundContactUnits, lowestGroundContact,
} from "@0sfs/ground-contact/groundContactClearance";
import { bootstrapAircraft } from "../jsbsim/bootstrapC172";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { DEFAULT_PHYSICS_HZ } from "./physicsRate";

const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); vi.restoreAllMocks(); });

async function loaded(...aircraft: AircraftId[]): Promise<JSBSimSdk> {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl, persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  for (const id of aircraft) for (const file of resolveAircraftDataFiles(manifest, id)) {
    sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  }
  await bootstrapAircraft(sdk, aircraft[0]!, DEFAULT_PHYSICS_HZ, { latDeg: 44.98, lonDeg: -93.24, altFt: 3000, airspeedKts: 100 });
  return sdk;
}

/** The measure as it was before its reads were batched: one scalar read per property, in the same arithmetic. */
function scalarDeepest(sdk: JSBSimSdk, roll: number, pitch: number): { index: number; inches: number } {
  const contacts = groundContactUnits(sdk);
  let deepest = -1, inches = 0;
  if (contacts.length === 0) return { index: deepest, inches };
  const gearPosition = sdk.getPropertyValue("gear/gear-pos-norm");
  const cgX = sdk.getPropertyValue("inertia/cg-x-in");
  const cgY = sdk.getPropertyValue("inertia/cg-y-in");
  const cgZ = sdk.getPropertyValue("inertia/cg-z-in");
  const downX = -Math.sin(pitch);
  const downY = Math.sin(roll) * Math.cos(pitch);
  const downZ = Math.cos(roll) * Math.cos(pitch);
  for (let index = 0; index < contacts.length; index++) {
    const { prefix, retractable } = contacts[index]!;
    if (retractable && gearPosition <= GEAR_DOWN_POSITION) continue;
    const xIn = sdk.getPropertyValue(prefix + "x-position");
    const yIn = sdk.getPropertyValue(prefix + "y-position");
    const zIn = sdk.getPropertyValue(prefix + "z-position");
    const depth = downX * (cgX - xIn) + downY * (yIn - cgY) + downZ * (cgZ - zIn);
    if (deepest < 0 || depth > inches) { deepest = index; inches = depth; }
  }
  return { index: deepest, inches };
}

/** Mulberry32: the same draws on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every value the clearance gives equals the scalar measure's, bit for bit, over attitudes and gear positions. */
function expectExact(sdk: JSBSimSdk, seed: number, draws = 200): void {
  const draw = random(seed);
  const gear = sdk.getPropertyValue("gear/gear-pos-norm");
  for (const position of [gear, 0, 0.5, GEAR_DOWN_POSITION, 1]) {
    sdk.setPropertyValue("gear/gear-pos-norm", position);
    for (let i = 0; i < draws; i++) {
      const roll = (draw() * 2 - 1) * Math.PI, pitch = (draw() * 2 - 1) * Math.PI / 2;
      const reference = scalarDeepest(sdk, roll, pitch);
      const metres = reference.index < 0 ? 0 : reference.inches * 0.0254;
      expect(Object.is(groundContactClearanceMeters(sdk, roll, pitch), metres), `roll ${roll}, pitch ${pitch}, gear ${position}`).toBe(true);
      const lowest = lowestGroundContact(sdk, roll, pitch);
      expect(lowest).toEqual(reference.index < 0 ? null : { prefix: groundContactUnits(sdk)[reference.index]!.prefix, depthMeters: metres });
    }
  }
  sdk.setPropertyValue("gear/gear-pos-norm", gear);
}

describe("ground contact clearance through one property batch", () => {
  for (const aircraft of ["cessna-172", "cirrus-vision-jet", "f-35b"] as const) {
    it(`measures the ${aircraft} exactly as one read per property did`, async () => {
      const sdk = await loaded(aircraft);
      expect(groundContactUnits(sdk).length).toBeGreaterThan(0);
      expectExact(sdk, 1);
      // Flown on, with the CG moving as fuel burns: values stay live.
      for (let step = 0; step < 240; step++) expect(sdk.run()).toBe(true);
      expectExact(sdk, 2, 50);
    });
  }

  it("reads the model's properties in one batch, with one scalar read for the contact count", async () => {
    const sdk = await loaded("cessna-172");
    groundContactClearanceMeters(sdk, 0.1, 0.05);
    const scalar = vi.spyOn(sdk, "getPropertyValue");
    const batches = vi.spyOn(sdk, "createPropertyBatch");
    for (let i = 0; i < 10; i++) groundContactClearanceMeters(sdk, 0.1 * i, 0.05);
    expect(scalar.mock.calls.map(([path]) => path)).toEqual(Array(10).fill("gear/num-units"));
    expect(batches).not.toHaveBeenCalled();
  });

  it("resolves its paths again after a model load disposes the batch, and for a model with other contacts", async () => {
    const sdk = await loaded("cessna-172", "f-35b");
    expectExact(sdk, 3, 20);
    // The same model again: the same contacts, but the SDK disposed every batch.
    await bootstrapAircraft(sdk, "cessna-172", DEFAULT_PHYSICS_HZ, { latDeg: 44.98, lonDeg: -93.24, altFt: 2000, airspeedKts: 90 });
    expectExact(sdk, 4, 20);
    // Another model, with its own contacts.
    const before = groundContactUnits(sdk).length;
    await bootstrapAircraft(sdk, "f-35b", DEFAULT_PHYSICS_HZ, { latDeg: 44.98, lonDeg: -93.24, altFt: 2000, airspeedKts: 200 });
    expect(groundContactUnits(sdk).length).not.toBe(before);
    expectExact(sdk, 5, 20);
  });
});
