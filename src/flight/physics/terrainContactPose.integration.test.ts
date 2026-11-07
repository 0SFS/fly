import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, expect, it, vi } from "vitest";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { bootstrapAircraft } from "../jsbsim/bootstrapC172";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { DEFAULT_PHYSICS_HZ } from "./physicsRate";

const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); vi.restoreAllMocks(); });
const POSE = ["position/lat-geod-deg", "position/long-gc-deg", "attitude/phi-deg", "attitude/theta-deg", "attitude/psi-deg",
  "position/terrain-elevation-asl-ft"];
const surface: SurfaceQuery = { raycast: () => null, sample: () => ({ heightMeters: 250, revision: 1, quality: 15 } as SurfaceHit) } as SurfaceQuery;

it("reads the aircraft's pose in one batch, with one altitude read after the floor is set, and again after a model load", async () => {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl, persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  for (const file of resolveAircraftDataFiles(manifest, "cessna-172")) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  const start = { latDeg: 44.98, lonDeg: -93.24, altFt: 3000, airspeedKts: 100 };
  await bootstrapAircraft(sdk, "cessna-172", DEFAULT_PHYSICS_HZ, start);
  const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);
  expect(contact.update()).toBe(true);
  const scalar = vi.spyOn(sdk, "getPropertyValue");
  const batches = vi.spyOn(sdk, "createPropertyBatch");
  const flown = () => {
    scalar.mockClear();
    for (let step = 0; step < 10; step++) { expect(contact.update()).toBe(true); expect(sdk.run()).toBe(true); }
    const read = scalar.mock.calls.map(([path]) => path);
    expect(read.filter(path => POSE.includes(path))).toEqual([]);
    expect(read.filter(path => path === "position/h-sl-ft")).toHaveLength(10);
  };
  flown();
  expect(batches).not.toHaveBeenCalled();
  // Loading a model disposes every batch: the pose's is made again.
  await bootstrapAircraft(sdk, "cessna-172", DEFAULT_PHYSICS_HZ, start);
  contact.reset();
  flown();
  expect(batches.mock.calls.map(([paths]) => paths)).toContainEqual(expect.arrayContaining(POSE));
  contact.dispose();
});
