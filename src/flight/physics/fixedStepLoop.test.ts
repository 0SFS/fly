import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { describe, expect, it, vi } from "vitest";
import { createFixedStepPhysicsLoop } from "./fixedStepLoop";
import { DEFAULT_PHYSICS_HZ, LEGACY_FIXED_DT_120, LEGACY_PHYSICS_HZ_120, maxCatchUpSteps, physicsStepSeconds, type PhysicsHz } from "./physicsRate";

const DEFAULT_DT = physicsStepSeconds(DEFAULT_PHYSICS_HZ);

describe("fixedStepPhysicsLoop pause", () => {
  it("does not advance JSBSim while paused", () => {
    const run = vi.fn(() => true);
    const sdk = {
      run,
      getPropertyValue: vi.fn((key: string) => key === "position/h-sl-ft" ? 1000 : 0),
    } as unknown as JSBSimSdk;
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: DEFAULT_PHYSICS_HZ });

    const runningState = loop.update(DEFAULT_DT, vi.fn());
    loop.setPaused(true);
    const pausedState = loop.update(DEFAULT_DT * 4, vi.fn());

    expect(run).toHaveBeenCalledTimes(1);
    expect(pausedState.altMeters).toBe(runningState.altMeters);
    expect(pausedState.latDeg).toBe(runningState.latDeg);
  });
});

it("seeds interpolation with the new position on reset, including while paused", () => {
  let latitude = 10;
  const sdk = { run: () => true, getPropertyValue: (key: string) => key === "position/lat-geod-deg" ? latitude : key === "position/h-sl-ft" ? 1000 : 0 } as unknown as JSBSimSdk;
  const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: DEFAULT_PHYSICS_HZ });
  loop.update(DEFAULT_DT, () => {});
  latitude = 46.7867;
  loop.reset();
  expect(loop.update(0, () => {}).latDeg).toBe(latitude);
  loop.setPaused(true);
  expect(loop.update(10, () => {}).latDeg).toBe(latitude);
});

async function aircraftAt(rollDeg: number, pitchDeg: number, aglMeters: number) {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false } });
  const manifest = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8")) as { files: string[] };
  for (const file of manifest.files) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
  sdk.loadModel("c172p");
  sdk.setDt(LEGACY_FIXED_DT_120);
  for (const [property, value] of Object.entries({
    "ic/lat-geod-deg": 34, "ic/long-gc-deg": -118.3,
    "ic/h-sl-ft": (300 + aglMeters) / 0.3048, "ic/terrain-elevation-ft": 300 / 0.3048,
    "ic/phi-deg": rollDeg, "ic/theta-deg": pitchDeg, "ic/vc-kts": 80 })) sdk.setPropertyValue(property, value);
  expect(sdk.runIc()).toBe(true);
  return sdk;
}

// Contact-geometry regressions recorded at the earlier 120 Hz rate; they stay there.
describe("ground impact uses actual C172 contact geometry", () => {
  it.each([
    { roll: 20, pitch: 0, agl: 2.6 }, { roll: 35, pitch: 0, agl: 3 },
    { roll: -35, pitch: 0, agl: 3 }, { roll: 0, pitch: 30, agl: 2.7 },
    { roll: 0, pitch: -30, agl: 2.7 },
  ])("keeps an intact aircraft flying at $roll degrees bank/$pitch pitch and $agl m AGL", async ({ roll, pitch, agl }) => {
    const sdk = await aircraftAt(roll, pitch, agl);
    try {
      const run = vi.spyOn(sdk, "run");
      const altitudeBefore = sdk.getPropertyValue("position/h-sl-ft") * 0.3048;
      const downBefore = sdk.getPropertyValue("velocities/v-down-fps") * 0.3048;
      const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
      loop.update(LEGACY_FIXED_DT_120, () => true);
      expect(loop.getFault()).toBeNull();
      expect(run).toHaveBeenCalledOnce();
      for (let wheel = 0; wheel < 3; wheel++) expect(sdk.getPropertyValue(`gear/unit[${wheel}]/WOW`)).toBe(0);
      // Pitched flight has a real vertical velocity; retain that expected travel.
      expect(sdk.getPropertyValue("position/h-sl-ft") * 0.3048).toBeCloseTo(altitudeBefore - downBefore * LEGACY_FIXED_DT_120, 1);
    } finally { sdk.destroy(); }
  });

  it("stops a genuinely penetrating wingtip before evaluating its structural spring", async () => {
    const sdk = await aircraftAt(35, 0, 2);
    try {
      const run = vi.spyOn(sdk, "run");
      const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
      loop.update(LEGACY_FIXED_DT_120, () => true);
      expect(loop.getFault()).toBe("Hard ground impact. Reposition the aircraft to recover.");
      expect(run).not.toHaveBeenCalled();
    } finally { sdk.destroy(); }
  });
});

/** A stand-in model that steps 1/physicsHz and moves north a little each step. */
function steppingSdk(physicsHz: number, nativeHz = physicsHz) {
  let latitude = 10;
  const run = vi.fn(() => { latitude += 1e-4; return true; });
  const sdk = {
    run,
    getDeltaT: () => 1 / nativeHz,
    getPropertyValue: (key: string) => key === "position/lat-geod-deg" ? latitude : key === "position/h-sl-ft" ? 1000 : 0,
  } as unknown as JSBSimSdk;
  return { sdk, run, latitude: () => latitude };
}

function expectConserved(accounting: ReturnType<ReturnType<typeof createFixedStepPhysicsLoop>["getTimeAccounting"]>) {
  expect(accounting.simulatedSeconds + accounting.discardedSeconds + accounting.pendingSeconds)
    .toBeCloseTo(accounting.receivedSeconds, 12);
  expect(accounting.simulatedSeconds).toBeCloseTo(accounting.acceptedSteps * accounting.dtSeconds, 12);
}

describe.each([
  { physicsHz: 30, maxSteps: 2, horizonMs: 66.7, perFrameAt60Fps: [0, 1] },
  { physicsHz: 60, maxSteps: 3, horizonMs: 50, perFrameAt60Fps: [1, 1] },
  { physicsHz: 120, maxSteps: 6, horizonMs: 50, perFrameAt60Fps: [2, 2] },
] as const)("the $physicsHz Hz fixed-step scheduler", ({ physicsHz, maxSteps, horizonMs, perFrameAt60Fps }) => {
  const dt = 1 / physicsHz;

  it("names its step, its catch-up limit and its backlog cap", () => {
    const { sdk } = steppingSdk(physicsHz);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz });
    expect(loop.physicsHz).toBe(physicsHz);
    expect(loop.dtSeconds).toBe(dt);
    expect(maxCatchUpSteps(physicsHz)).toBe(maxSteps);
    const accounting = loop.getTimeAccounting();
    expect(accounting.maxStepsPerUpdate).toBe(maxSteps);
    expect(accounting.maxStepsPerUpdate * accounting.dtSeconds * 1000).toBeCloseTo(horizonMs, 1);
  });

  it("takes whole steps per 60 fps frame, passes each step's dt, and simulates one second in one second", () => {
    const { sdk } = steppingSdk(physicsHz);
    const onStep = vi.fn();
    const loop = createFixedStepPhysicsLoop(sdk, onStep, { physicsHz });
    const perFrame: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      const before = onStep.mock.calls.length;
      loop.update(1 / 60, () => {});
      perFrame.push(onStep.mock.calls.length - before);
    }
    expect(perFrame.slice(0, 2)).toEqual(perFrameAt60Fps);
    expect(onStep).toHaveBeenCalledTimes(physicsHz);
    expect(onStep.mock.calls.every(([, stepSeconds]) => stepSeconds === dt)).toBe(true);
    const accounting = loop.getTimeAccounting();
    expect(accounting).toMatchObject({ acceptedSteps: physicsHz, discardedSeconds: 0 });
    expect(accounting.simulatedSeconds).toBeCloseTo(1, 12);
    expectConserved(accounting);
  });

  it("keeps step count independent of the display rate at 144 fps", () => {
    const { sdk } = steppingSdk(physicsHz);
    const onStep = vi.fn();
    const loop = createFixedStepPhysicsLoop(sdk, onStep, { physicsHz });
    for (let frame = 0; frame < 144; frame += 1) loop.update(1 / 144, () => {});
    // Floating-point frame sums may leave the last step pending.
    expect(onStep.mock.calls.length).toBeGreaterThanOrEqual(physicsHz - 1);
    expect(onStep.mock.calls.length).toBeLessThanOrEqual(physicsHz);
    expect(loop.getTimeAccounting().discardedSeconds).toBe(0);
    expectConserved(loop.getTimeAccounting());
  });

  it(`catches up at most ${maxSteps} steps after a long frame and counts the rest as discarded, never simulated`, () => {
    const { sdk, run } = steppingSdk(physicsHz);
    const onStep = vi.fn();
    const loop = createFixedStepPhysicsLoop(sdk, onStep, { physicsHz });
    loop.update(1, () => {});
    expect(run).toHaveBeenCalledTimes(maxSteps);
    expect(onStep).toHaveBeenCalledTimes(maxSteps);
    const accounting = loop.getTimeAccounting();
    expect(accounting.simulatedSeconds).toBeCloseTo(maxSteps * dt, 12);
    expect(accounting.catchUpDiscardedSeconds).toBeCloseTo(1 - maxSteps * dt, 12);
    expect(accounting.discardedSeconds).toBeCloseTo(accounting.catchUpDiscardedSeconds, 12);
    expect(accounting.pendingSeconds).toBeCloseTo(0, 12);
    expectConserved(accounting);
    // A frame inside the cap is simulated in full on later frames.
    loop.update(dt * 1.5, () => {});
    expect(onStep).toHaveBeenCalledTimes(maxSteps + 1);
    expect(loop.getTimeAccounting().catchUpDiscardedSeconds).toBeCloseTo(1 - maxSteps * dt, 12);
    expectConserved(loop.getTimeAccounting());
  });

  it("caps the backlog in whole steps, so the cap leaves no sliver to interpolate", () => {
    const { sdk } = steppingSdk(physicsHz);
    const onStep = vi.fn();
    const loop = createFixedStepPhysicsLoop(sdk, onStep, { physicsHz });
    loop.update((maxSteps + 0.5) * dt, () => {});
    expect(onStep).toHaveBeenCalledTimes(maxSteps);
    expect(loop.getTimeAccounting().pendingSeconds).toBeCloseTo(0, 12);
    expect(loop.getTimeAccounting().catchUpDiscardedSeconds).toBeCloseTo(0.5 * dt, 12);
    loop.update((maxSteps - 0.5) * dt, () => {});
    expect(onStep).toHaveBeenCalledTimes(2 * maxSteps - 1);
    expect(loop.getTimeAccounting().pendingSeconds).toBeCloseTo(0.5 * dt, 12);
    expectConserved(loop.getTimeAccounting());
  });

  it("interpolates the display by the pending fraction of a step", () => {
    const { sdk, latitude } = steppingSdk(physicsHz);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz });
    loop.update(dt, () => {});
    const previous = latitude();
    const shown = loop.update(dt * 1.25, () => {});
    // One more step taken, a quarter of a step left: three quarters back from the newest state.
    expect(latitude()).toBeCloseTo(previous + 1e-4, 12);
    expect(shown.latDeg).toBeCloseTo(previous + 0.25 * 1e-4, 9);
    expect(loop.getTimeAccounting().pendingSeconds).toBeCloseTo(0.25 * dt, 12);
  });

  it("calls onStep for no refused or faulted candidate, and discards their time", () => {
    const refused = steppingSdk(physicsHz);
    const onStep = vi.fn();
    const loop = createFixedStepPhysicsLoop(refused.sdk, onStep, { physicsHz });
    loop.update(2 * dt, () => false);
    expect(refused.run).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
    expect(loop.getTimeAccounting()).toMatchObject({ acceptedSteps: 0, pendingSeconds: 0 });
    expect(loop.getTimeAccounting().discardedSeconds).toBeCloseTo(2 * dt, 12);
    expectConserved(loop.getTimeAccounting());

    const faulted = steppingSdk(physicsHz);
    faulted.run.mockImplementation(() => false);
    const faultSteps = vi.fn();
    const faultLoop = createFixedStepPhysicsLoop(faulted.sdk, faultSteps, { physicsHz });
    faultLoop.update(2 * dt, () => {});
    expect(faultLoop.getFault()).toMatch(/Physics stopped/);
    expect(faulted.run).toHaveBeenCalledOnce();
    expect(faultSteps).not.toHaveBeenCalled();
    expect(faultLoop.getTimeAccounting().acceptedSteps).toBe(0);
    expect(faultLoop.getTimeAccounting().discardedSeconds).toBeCloseTo(2 * dt, 12);
    // A faulted loop receives nothing further.
    faultLoop.update(1, () => {});
    expect(faultLoop.getTimeAccounting().receivedSeconds).toBeCloseTo(2 * dt, 12);
    expectConserved(faultLoop.getTimeAccounting());
  });

  it("discards, and never later simulates, the pending time at a pause or reset", () => {
    const { sdk } = steppingSdk(physicsHz);
    const onStep = vi.fn();
    const loop = createFixedStepPhysicsLoop(sdk, onStep, { physicsHz });
    loop.update(0.5 * dt, () => {});
    loop.setPaused(true);
    loop.update(1, () => {});
    loop.setPaused(false);
    loop.update(0.5 * dt, () => {});
    expect(onStep).not.toHaveBeenCalled();
    loop.reset();
    loop.update(0.75 * dt, () => {});
    expect(onStep).not.toHaveBeenCalled();
    const accounting = loop.getTimeAccounting();
    expect(accounting.receivedSeconds).toBeCloseTo(1.75 * dt, 12);
    expect(accounting.discardedSeconds).toBeCloseTo(dt, 12);
    expect(accounting.pendingSeconds).toBeCloseTo(0.75 * dt, 12);
    expectConserved(accounting);
  });
});

describe("the loop and the native model share one step", () => {
  it.each([[60, 120], [30, 60], [120, 60]] as const)("refuses a %i Hz loop over a model stepping at %i Hz", (physicsHz, nativeHz) => {
    expect(() => createFixedStepPhysicsLoop(steppingSdk(physicsHz, nativeHz).sdk, undefined, { physicsHz }))
      .toThrow(`not the ${physicsHz} Hz loop's`);
  });

  it("refuses a rate outside 30, 60 and 120 Hz", () => {
    expect(() => createFixedStepPhysicsLoop(steppingSdk(90).sdk, undefined, { physicsHz: 90 as PhysicsHz }))
      .toThrow("Unsupported physics rate");
  });
});
