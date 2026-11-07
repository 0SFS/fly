import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, expect, it, vi } from "vitest";
import { STEP_FLIGHT_PATHS, TRIM_FLIGHT_PATHS } from "../physics/stepFlight";
import { DEFAULT_PHYSICS_HZ } from "../physics/physicsRate";
import { bootstrapAircraft } from "./bootstrapC172";
import { resolveAircraftDataFiles } from "./hydrateJsbsimData";
import { createPropertySampler } from "./propertySampler";

const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); vi.restoreAllMocks(); });
const START = { latDeg: 44.98, lonDeg: -93.24, altFt: 3000, airspeedKts: 100 };
const ABSENT = "gear/unit[9]/WOW";
const PATHS = [...STEP_FLIGHT_PATHS, ...TRIM_FLIGHT_PATHS, ABSENT];

async function c172(): Promise<JSBSimSdk> {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl, persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  for (const file of resolveAircraftDataFiles(manifest, "cessna-172")) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  await bootstrapAircraft(sdk, "cessna-172", DEFAULT_PHYSICS_HZ, START);
  return sdk;
}

it("reads every slot as a scalar read would, through one batch, and again after a model load", async () => {
  const sdk = await c172();
  const sampler = createPropertySampler(sdk, PATHS);
  const batches = vi.spyOn(sdk, "createPropertyBatch");
  const scalar = vi.spyOn(sdk, "getPropertyValue");
  const flown = () => {
    for (let step = 0; step < 20; step++) {
      sdk.setPropertyValue("fcs/aileron-cmd-norm", Math.sin(step / 3) * 0.4);
      expect(sdk.run()).toBe(true);
      scalar.mockClear();
      const values = [...sampler.read()];
      // A property the model lacks is the only one read on its own, and reads zero, as before.
      expect(scalar.mock.calls.map(([path]) => path)).toEqual([ABSENT]);
      const expected = PATHS.map(path => sdk.getPropertyValue(path));
      values.forEach((value, slot) => expect(Object.is(value, expected[slot]), `${PATHS[slot]}: ${value} vs ${expected[slot]}`).toBe(true));
    }
  };
  flown();
  expect(batches).not.toHaveBeenCalled();
  // Loading a model disposes every batch: the next read makes one for the new model.
  await bootstrapAircraft(sdk, "cessna-172", DEFAULT_PHYSICS_HZ, START);
  flown();
  expect(batches).toHaveBeenCalledOnce();
  expect(batches).toHaveBeenCalledWith(PATHS, { create: false });
  // Reading never adds the property the model lacks.
  expect(sdk.queryPropertyCatalog("unit[9]")).not.toContain("WOW");
  sampler.dispose();
});

it("reads one property at a time without a native batch, or when making one fails", () => {
  const values = new Map([["a", 1], ["b", Number.NaN]]);
  const read = () => vi.fn((path: string) => values.get(path) ?? 0);
  const scalarOnly = { getPropertyValue: read() };
  const failing = { getPropertyValue: read(), createPropertyBatch: vi.fn(() => { throw new Error("no binding"); }) };
  for (const sdk of [scalarOnly, failing]) {
    const sampler = createPropertySampler(sdk as unknown as JSBSimSdk, ["a", "b", "c"]);
    expect([...sampler.read()]).toEqual([1, Number.NaN, 0]);
    expect(sdk.getPropertyValue).toHaveBeenCalledTimes(3);
    sampler.dispose();
  }
});

it("disposes its batch once, and refuses to read after that", () => {
  const batch = { missing: [] as string[], read: vi.fn((target: Float64Array) => target.fill(2)), dispose: vi.fn() };
  const sdk = { getPropertyValue: vi.fn(() => 0), createPropertyBatch: vi.fn(() => batch) };
  const sampler = createPropertySampler(sdk as unknown as JSBSimSdk, ["a", "b"]);
  expect([...sampler.read()]).toEqual([2, 2]);
  expect(sdk.getPropertyValue).not.toHaveBeenCalled();
  sampler.dispose(); sampler.dispose();
  expect(batch.dispose).toHaveBeenCalledOnce();
  expect(() => sampler.read()).toThrow(/disposed/);
});
