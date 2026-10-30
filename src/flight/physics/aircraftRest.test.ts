import { describe, expect, it } from "vitest";
import { createAircraftRest, enginesTurning, touchingGround, type AircraftRestSample } from "./aircraftRest";

const still = (pose: number[] = [0, 0.1], eligible = true): AircraftRestSample =>
  ({ eligible, speedMetersPerSecond: 0.001, rateRadPerSecond: 0.0001, pose });
const frames = (count: number, observe: () => boolean): boolean[] => Array.from({ length: count }, observe);

describe("aircraft rest", () => {
  it("rests once it has stayed still for the hold time, and says so once", () => {
    const rest = createAircraftRest({ holdSeconds: 1 });
    const results = frames(70, () => rest.observe(still(), 1 / 60));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.indexOf(true)).toBeGreaterThanOrEqual(59);
    expect(rest.isResting()).toBe(true);
  });

  it("does not rest while moving, turning, or with a surface still travelling", () => {
    const rest = createAircraftRest({ holdSeconds: 0.5 });
    frames(120, () => rest.observe({ ...still(), speedMetersPerSecond: 0.05 }, 1 / 60));
    frames(120, () => rest.observe({ ...still(), rateRadPerSecond: 0.02 }, 1 / 60));
    let flap = 0;
    frames(120, () => rest.observe(still([0, (flap += 0.01)]), 1 / 60));
    expect(rest.isResting()).toBe(false);
  });

  it("starts the hold again whenever it is not eligible, and ignores frames without a step", () => {
    const rest = createAircraftRest({ holdSeconds: 1 });
    frames(50, () => rest.observe(still(), 1 / 60));
    rest.observe(still(undefined, false), 1 / 60);
    frames(50, () => rest.observe(still(), 1 / 60));
    frames(500, () => rest.observe(still(), 0));
    expect(rest.isResting()).toBe(false);
    frames(20, () => rest.observe(still(), 1 / 60));
    expect(rest.isResting()).toBe(true);
  });

  it("wakes, and then needs a whole still period again", () => {
    const rest = createAircraftRest({ holdSeconds: 1 });
    frames(61, () => rest.observe(still(), 1 / 60));
    expect(rest.wake()).toBe(true);
    expect(rest.wake()).toBe(false);
    frames(50, () => rest.observe(still(), 1 / 60));
    expect(rest.isResting()).toBe(false);
    frames(12, () => rest.observe(still(), 1 / 60));
    expect(rest.isResting()).toBe(true);
  });

  it("does not take an unreadable motion for stillness, but a part the aircraft does not have is still", () => {
    const rest = createAircraftRest({ holdSeconds: 0.1 });
    frames(60, () => rest.observe({ ...still(), speedMetersPerSecond: Number.NaN }, 1 / 60));
    let frame = 0;
    frames(60, () => rest.observe(still([frame++ % 2 === 0 ? Number.NaN : 0]), 1 / 60));
    expect(rest.isResting()).toBe(false);
    frames(60, () => rest.observe(still([Number.NaN, 0.2]), 1 / 60));
    expect(rest.isResting()).toBe(true);
  });
});

describe("engines turning", () => {
  const sdk = (values: Record<string, number>) => ({ getPropertyValue: (name: string) => values[name] ?? Number.NaN });
  it("counts a running, starting or spooling engine, on any index", () => {
    expect(enginesTurning(sdk({}), [0, 1])).toBe(false);
    expect(enginesTurning(sdk({ "propulsion/engine[1]/set-running": 1 }), [0, 1])).toBe(true);
    expect(enginesTurning(sdk({ "propulsion/starter_cmd": 1 }), [0])).toBe(true);
    expect(enginesTurning(sdk({ "propulsion/engine/engine-rpm": 40 }), [0])).toBe(true);
    expect(enginesTurning(sdk({ "propulsion/engine[1]/n2": 3 }), [0, 1])).toBe(true);
    expect(enginesTurning(sdk({ "propulsion/engine/engine-rpm": 0.2, "propulsion/engine/n2": 0.1 }), [0])).toBe(false);
  });
});

describe("touching ground", () => {
  const sdk = (values: Record<string, number>) => ({ getPropertyValue: (name: string) => values[name] ?? Number.NaN });
  it("counts structure contacts, such as a drone's feet, as well as wheels", () => {
    const feet = ["contact/unit/", "contact/unit[1]/"];
    expect(touchingGround(sdk({ "contact/unit[1]/WOW": 1 }), feet)).toBe(true);
    expect(touchingGround(sdk({ "gear/unit[0]/WOW": 1 }), feet)).toBe(false);
    expect(touchingGround(sdk({ "gear/unit[2]/WOW": 1 }), ["gear/unit[2]/"])).toBe(true);
    expect(touchingGround(sdk({ "contact/unit/WOW": 0 }), feet)).toBe(false);
  });
});
