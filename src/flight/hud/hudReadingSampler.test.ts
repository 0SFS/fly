import { expect, it, vi } from "vitest";
import type { PropertyBatch } from "@felipegalind0/jsbsim";
import { createHudReadingSampler, HUD_READING_PATHS } from "./hudReadingSampler";

it("keeps scalar ground and STOVL thresholds, including non-finite observations, without caching a past read", () => {
  const values = new Map<string, number>();
  const read = createHudReadingSampler({ getPropertyValue: path => values.get(path) ?? 0 }, "stovl");
  for (const weight of [-0, 1000, NaN, Infinity]) for (const wow of [0, 0.5, 0.500001, 1, NaN, Infinity, -Infinity]) {
    for (const contact of HUD_READING_PATHS.slice(1)) for (const position of [0, 0.01, 0.010001, NaN, Infinity]) {
      values.clear(); values.set("inertia/weight-lbs", weight); values.set(contact, wow); values.set("stovl", position);
      const actual = read.read();
      expect(Object.is(actual.weightLb, weight)).toBe(true);
      expect(actual.onGround).toBe(Number.isFinite(wow) && wow > 0.5);
      expect(actual.jetBorne).toBe(position > 0.01);
    }
  }
  read.dispose();
});

it("reads one model-bound batch at each call and disposes it, without inventing a STOVL property", () => {
  const native = new Float64Array([2000, 0, 0, 0]);
  const batch = {
    missing: [], read: vi.fn((target: Float64Array) => { target.set(native); return target; }), dispose: vi.fn(),
  };
  const sdk = { getPropertyValue: vi.fn(() => 0), createPropertyBatch: vi.fn(() => batch as unknown as PropertyBatch) };
  const reader = createHudReadingSampler(sdk);
  expect(reader.read()).toEqual({ weightLb: 2000, onGround: false, jetBorne: false });
  native[2] = 1;
  expect(reader.read()).toEqual({ weightLb: 2000, onGround: true, jetBorne: false });
  expect(sdk.createPropertyBatch).toHaveBeenCalledExactlyOnceWith(HUD_READING_PATHS, { create: false });
  expect(batch.read).toHaveBeenCalledTimes(2);
  expect(sdk.getPropertyValue).not.toHaveBeenCalled();
  reader.dispose(); reader.dispose();
  expect(batch.dispose).toHaveBeenCalledOnce();
  expect(() => reader.read()).toThrow(/disposed/);
});
