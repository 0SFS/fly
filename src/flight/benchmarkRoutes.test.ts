import { describe, expect, it, vi } from "vitest";
import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import type { SettingsRegistry } from "foss-earth/settings";
import { BENCHMARK_ROUTES, createBenchmarkRouteController, forceBenchmarkRouteSettings, requestedBenchmarkRoute } from "./benchmarkRoutes";

const initial = { ...EMPTY_FLIGHT_STATE, latDeg: 37.91, lonDeg: -121.285, altMeters: 160, airspeedKts: 110, throttleNorm: 0.65 };

describe("W0 benchmark routes", () => {
  it("requires the exact dev=1 opt-in and a known route", () => {
    for (const search of ["?route=low", "?dev=true&route=low", "?dev=0&route=cruise", "?dev=1&route=unknown"]) {
      expect(requestedBenchmarkRoute(search)).toBeNull();
    }
    expect(requestedBenchmarkRoute("?dev=1&route=low")).toBe(BENCHMARK_ROUTES.low);
    expect(requestedBenchmarkRoute("?dev=1&route=cruise")).toMatchObject({ heightAboveGroundMeters: 1500, durationSeconds: 180 });
  });

  it("forces starts and AP only for the visit, without writing preferences", () => {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const force = vi.fn(() => { const release = vi.fn(); releases.push(release); return release; });
    const release = forceBenchmarkRouteSettings({ force } as unknown as SettingsRegistry, BENCHMARK_ROUTES.low);
    expect(force).toHaveBeenCalledWith("osfs.start.resume", false, expect.any(String));
    expect(force).toHaveBeenCalledWith("osfs.start.heightAboveGround", 150, expect.any(String));
    expect(force).toHaveBeenCalledWith("osfs.aircraft.id", "cessna-172", expect.any(String));
    expect(force).toHaveBeenCalledWith("osfs.autopilot.backend", "ours", expect.any(String));
    release();
    expect(releases.every(stop => stop.mock.calls.length === 1)).toBe(true);
  });

  it("holds initial ground plus clearance; corrects altitude, vertical motion and wrapped heading", () => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / 120, {});
    expect(controller.snapshot()).toMatchObject({ targetAltitudeMslMeters: 160, coverageValidation: "unverified" });
    expect(controller.targets({ ...initial, altMeters: 140 }).pitchRad).toBeGreaterThan(0);
    expect(controller.targets({ ...initial, altMeters: 180 }).pitchRad).toBeLessThan(0);
    expect(controller.targets({ ...initial, verticalSpeedFps: 10 }).pitchRad).toBeLessThan(0);
    expect(controller.targets({ ...initial, headingRad: 359 * Math.PI / 180 }).rollRad).toBeGreaterThan(0);
    expect(Math.abs(controller.targets({ ...initial, headingRad: Math.PI }).rollRad)).toBeLessThanOrEqual(15 * Math.PI / 180);
    expect(controller.targets({ ...initial, altMeters: -1000 }).pitchRad).toBeCloseTo(12 * Math.PI / 180, 14);
    expect(controller.targets({ ...initial, altMeters: 2000 }).pitchRad).toBeCloseTo(-12 * Math.PI / 180, 14);
  });

  it("stops on exactly 21,600 accepted 120 Hz steps and samples the actual track once a second", () => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / 120, { "map.source.basemap": "google" });
    const ground = vi.fn(() => 10);
    for (let i = 0; i < 21_599; i += 1) expect(controller.acceptStep(initial, ground)).toBe(false);
    expect(controller.status).toBe("running");
    expect(controller.acceptStep({ ...initial, latDeg: 38 }, ground)).toBe(true);
    const result = controller.snapshot();
    expect(result).toMatchObject({ status: "complete", elapsedSeconds: 180, acceptedSteps: 21_600 });
    expect(result.samples).toHaveLength(181);
    expect(result.samples.at(-1)).toMatchObject({ latDeg: 38, elapsedSeconds: 180 });
    expect(ground).toHaveBeenCalledTimes(180);
    controller.acceptStep(initial, ground);
    expect(controller.snapshot().acceptedSteps).toBe(21_600);
  });

  it.each([30, 60, 120])("counts the same 180 simulated seconds and 1 Hz samples at %i Hz physics", physicsHz => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / physicsHz, {});
    const ground = vi.fn(() => 10);
    let steps = 0;
    while (!controller.acceptStep(initial, ground)) steps += 1;
    const result = controller.snapshot();
    expect(steps + 1).toBe(180 * physicsHz);
    expect(result).toMatchObject({ status: "complete", elapsedSeconds: 180, acceptedSteps: 180 * physicsHz, physicsHz, fixedDtSeconds: 1 / physicsHz });
    expect(result.samples.map(sample => sample.elapsedSeconds)).toEqual(Array.from({ length: 181 }, (_, second) => expect.closeTo(second, 9)));
  });

  it.each([-1, 1])("does not accumulate pitch integral into a saturated %s altitude correction", sign => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / 120, {});
    const displaced = { ...initial, altMeters: initial.altMeters - sign * 500 };
    for (let step = 0; step < 3600; step++) controller.acceptStep(displaced, () => 10);
    expect(controller.targets(displaced).pitchRad).toBeCloseTo(sign * 12 * Math.PI / 180, 12);
    // A transient that ends must not leave the aircraft pitching at a wound-up
    // 10-degree bias after it has reached the intended altitude again.
    expect(controller.targets(initial).pitchRad).toBeCloseTo(initial.pitchRad, 12);
  });

  it.each([-1, 1])("unwinds the integral when altitude error opposes a saturated %s pitch demand", sign => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / 120, {});
    // Learn a nonzero bias while demand remains inside the pitch limit.
    const offset = { ...initial, altMeters: initial.altMeters - sign * 5 };
    for (let step = 0; step < 1200; step++) controller.acceptStep(offset, () => 10);
    const before = controller.targets(initial).pitchRad;
    expect(before * sign).toBeGreaterThan(0);

    // Vertical motion saturates demand in the learned bias's direction, but
    // altitude error now points back toward zero and must be allowed to unwind.
    const recovery = { ...initial, altMeters: initial.altMeters + sign, verticalSpeedFps: -sign * 50 };
    expect(controller.targets(recovery).pitchRad).toBeCloseTo(sign * 12 * Math.PI / 180, 12);
    for (let step = 0; step < 1200; step++) controller.acceptStep(recovery, () => 10);
    expect(controller.targets(recovery).pitchRad).toBeCloseTo(sign * 12 * Math.PI / 180, 12);
    const after = controller.targets(initial).pitchRad;
    expect(after * sign).toBeGreaterThan(0);
    expect(Math.abs(after)).toBeLessThan(Math.abs(before));
  });

  it("keeps missing terrain and a physics failure visible instead of certifying coverage", () => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1, {});
    controller.acceptStep({ ...initial, altMeters: 170, headingRad: 0.1 }, () => null);
    controller.fail("Physics fault");
    expect(controller.acceptStep(initial, () => 10)).toBe(false);
    expect(controller.snapshot()).toMatchObject({ status: "failed", failure: "Physics fault", acceptedSteps: 1,
      maxAltitudeErrorMeters: 10, coverageValidation: "unverified" });
    expect(controller.snapshot().samples.at(-1)?.groundHeightMeters).toBeNull();
  });

  it("fails nonfinite states before recording NaN or continuing the route", () => {
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / 120, {});
    expect(controller.acceptStep({ ...initial, altMeters: NaN }, () => 10)).toBe(false);
    expect(controller.snapshot()).toMatchObject({ status: "failed", acceptedSteps: 0, failure: expect.stringContaining("Non-finite") });
    const another = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1 / 120, {});
    expect(Object.values(another.targets({ ...initial, headingRad: NaN })).every(Number.isFinite)).toBe(true);
    expect(another.status).toBe("failed");
  });

  it("timestamps the first and last accepted steps without including loading or changing the simulation clock", () => {
    let now = 1_000;
    const clock = vi.fn(() => now);
    const controller = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1, {}, clock);
    expect(controller.snapshot()).toMatchObject({ startedAtEpochMs: null, completedAtEpochMs: null });
    controller.targets(initial);
    expect(clock).not.toHaveBeenCalled();
    now = 5_000;
    controller.acceptStep(initial, () => 10);
    expect(controller.snapshot()).toMatchObject({ startedAtEpochMs: 5_000, completedAtEpochMs: null, elapsedSeconds: 1 });
    now = 99_000;
    for (let i = 1; i < 179; i += 1) controller.acceptStep(initial, () => 10);
    expect(clock).toHaveBeenCalledTimes(1);
    now = 200_000; // Wall-clock holds can make a 180 simulated second route take longer.
    controller.acceptStep(initial, () => 10);
    expect(controller.snapshot()).toMatchObject({ startedAtEpochMs: 5_000, completedAtEpochMs: 200_000, elapsedSeconds: 180, status: "complete" });
    controller.fail("too late");
    controller.acceptStep(initial, () => 10);
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it("records the terminal wall clock for failures before and after the first step", () => {
    let now = 10_000;
    const early = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1, {}, () => now);
    early.targets({ ...initial, headingRad: NaN });
    expect(early.snapshot()).toMatchObject({ startedAtEpochMs: null, completedAtEpochMs: 10_000, status: "failed" });
    const later = createBenchmarkRouteController(BENCHMARK_ROUTES.low, initial, 10, 1, {}, () => now);
    later.acceptStep(initial, () => 10);
    now = 11_000;
    later.fail("Physics fault");
    now = 12_000;
    later.fail("second fault");
    expect(later.snapshot()).toMatchObject({ startedAtEpochMs: 10_000, completedAtEpochMs: 11_000, status: "failed", failure: "Physics fault", elapsedSeconds: 1 });
  });
});
