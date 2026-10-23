import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { bootstrapC172p } from "../jsbsim/bootstrapC172";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { createFixedStepPhysicsLoop } from "./fixedStepLoop";
import { PHYSICS_RATES_HZ, physicsStepSeconds, type PhysicsHz } from "./physicsRate";

// The same C172 at 30, 60 and 120 Hz, through the app's loop at a 60 fps
// display. These tests show what each rate does; they do not validate 30 or
// 60 Hz for flight. Set PHYSICS_RATE_REPORT to a path to keep the numbers.

const METERS_PER_FOOT = 0.3048;
const GROUND_METERS = 300;
const FRAME_SECONDS = 1 / 60;
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });

const report: Record<string, unknown> = {};
afterAll(() => {
  const path = process.env.PHYSICS_RATE_REPORT;
  if (path) writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
});

async function c172Sdk(): Promise<JSBSimSdk> {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false, stripAnsi: true } });
  instances.push(sdk);
  const dataRoot = resolve(process.cwd(), "public/jsbsim-data");
  const manifest = JSON.parse(readFileSync(resolve(dataRoot, "manifest.json"), "utf8")) as { files: string[] };
  for (const file of resolveAircraftDataFiles(manifest, "cessna-172")) {
    sdk.writeDataFile(file, readFileSync(resolve(dataRoot, file), "utf8"));
  }
  return sdk;
}

/** Runs whole 60 fps frames until `seconds` of accepted steps, calling `input` before each step with its start time. */
function fly(loop: ReturnType<typeof createFixedStepPhysicsLoop>, seconds: number,
  input: (stepStartSeconds: number) => void | boolean | "reset", sample: (stepEndSeconds: number) => void) {
  const dt = loop.dtSeconds;
  const steps = Math.round(seconds / dt);
  const acceptedSoFar = () => loop.getTimeAccounting().acceptedSteps;
  let accepted = acceptedSoFar();
  const end = accepted + steps;
  for (let frame = 0; accepted < end && frame < steps * 10 && !loop.getFault(); frame += 1) {
    loop.update(FRAME_SECONDS, () => {
      const step = acceptedSoFar();
      return step >= end ? false : input(step * dt);
    });
    const now = loop.getTimeAccounting().acceptedSteps;
    for (let step = accepted + 1; step <= now; step += 1) sample(step * dt);
    accepted = now;
  }
}

describe("native time at each physics rate", () => {
  it.each(PHYSICS_RATES_HZ)("steps the native model 1/%i s, and its clock counts only accepted steps", async physicsHz => {
    const sdk = await c172Sdk();
    await bootstrapC172p(sdk, physicsHz);
    const dt = physicsStepSeconds(physicsHz);
    expect(sdk.getDeltaT()).toBeCloseTo(dt, 15);
    const stepSeconds: number[] = [];
    const loop = createFixedStepPhysicsLoop(sdk, (_state, seconds) => { stepSeconds.push(seconds); }, { physicsHz });
    const start = sdk.getPropertyValue("simulation/sim-time-sec");
    // A second of 60 fps frames, one 250 ms hitch among them, and one refused step.
    for (let frame = 0; frame < 60; frame += 1) loop.update(frame === 20 ? 0.25 : FRAME_SECONDS, frame === 40 ? () => false : () => {});
    const accounting = loop.getTimeAccounting();
    const nativeSeconds = sdk.getPropertyValue("simulation/sim-time-sec") - start;
    expect(loop.getFault()).toBeNull();
    expect(stepSeconds).toHaveLength(accounting.acceptedSteps);
    expect(stepSeconds.every(seconds => seconds === dt)).toBe(true);
    expect(nativeSeconds).toBeCloseTo(accounting.acceptedSteps * dt, 9);
    expect(accounting.simulatedSeconds).toBeCloseTo(nativeSeconds, 9);
    // The hitch beyond the catch-up limit, and the refused frame, were never simulated.
    expect(accounting.discardedSeconds).toBeGreaterThan(0.25 - 0.0667 - 1e-9);
    expect(accounting.simulatedSeconds + accounting.discardedSeconds + accounting.pendingSeconds)
      .toBeCloseTo(accounting.receivedSeconds, 12);
    // A loop at another rate over this model is refused, not silently mislabelled.
    const other = PHYSICS_RATES_HZ.find(rate => rate !== physicsHz)!;
    expect(() => createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: other })).toThrow("native model steps");
  });
});

interface GroundRun {
  fault: string | null;
  /** Reference point above the ground after 6 s. */
  finalHeightMeters: number;
  /** Over the last 3 s: the largest vertical speed, the altitude's range, and the largest change in gear compression. */
  settledMaxVerticalSpeedMps: number;
  settledAltitudeRangeMm: number;
  settledCompressionRangeMm: number;
  /** Over all 6 s. */
  maxVerticalSpeedMps: number;
  maxCompressionMeters: number;
  horizontalDriftMeters: number;
  finalPitchDeg: number;
}

async function restOnGear(physicsHz: PhysicsHz): Promise<GroundRun> {
  const sdk = await c172Sdk();
  sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
  sdk.loadModel("c172p");
  sdk.setDt(physicsStepSeconds(physicsHz));
  const stance = getFdmProfile("cessna-172").stance;
  for (const [property, value] of Object.entries({ "ic/lat-geod-deg": 34, "ic/long-gc-deg": -118.3,
    "ic/h-sl-ft": (GROUND_METERS + stance.staticMeters) / METERS_PER_FOOT, "ic/terrain-elevation-ft": GROUND_METERS / METERS_PER_FOOT,
    "ic/psi-true-deg": 0, "ic/theta-deg": 2.48, "ic/vc-kts": 0, "fcs/mixture-cmd-norm": 0, "fcs/throttle-cmd-norm": 0,
  })) sdk.setPropertyValue(property, value);
  expect(sdk.runIc()).toBe(true);
  const surface: SurfaceQuery = { raycast: () => null,
    sample: () => ({ heightMeters: GROUND_METERS, revision: 0, quality: 15 } as SurfaceHit) };
  const contact = createTerrainContact(sdk, surface, stance);
  const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz });
  const read = (property: string) => sdk.getPropertyValue(property);
  const north0 = read("position/lat-geod-deg"), east0 = read("position/long-gc-deg");
  let maxVertical = 0, maxCompression = 0, settledVertical = 0;
  let altitudeLow = Infinity, altitudeHigh = -Infinity;
  const compressionLow = [Infinity, Infinity, Infinity], compressionHigh = [-Infinity, -Infinity, -Infinity];
  fly(loop, 6, () => contact.update(), seconds => {
    const vertical = Math.abs(read("velocities/v-down-fps")) * METERS_PER_FOOT;
    const compression = [0, 1, 2].map(gear => read(`gear/unit[${gear}]/compression-ft`) * METERS_PER_FOOT);
    maxVertical = Math.max(maxVertical, vertical);
    maxCompression = Math.max(maxCompression, ...compression);
    if (seconds <= 3) return;
    settledVertical = Math.max(settledVertical, vertical);
    const altitude = read("position/h-sl-ft") * METERS_PER_FOOT;
    altitudeLow = Math.min(altitudeLow, altitude);
    altitudeHigh = Math.max(altitudeHigh, altitude);
    compression.forEach((value, gear) => {
      compressionLow[gear] = Math.min(compressionLow[gear], value);
      compressionHigh[gear] = Math.max(compressionHigh[gear], value);
    });
  });
  const north = (read("position/lat-geod-deg") - north0) * 111_320;
  const east = (read("position/long-gc-deg") - east0) * 111_320 * Math.cos(34 * Math.PI / 180);
  return {
    fault: loop.getFault(),
    finalHeightMeters: read("position/h-sl-ft") * METERS_PER_FOOT - GROUND_METERS,
    settledMaxVerticalSpeedMps: settledVertical,
    settledAltitudeRangeMm: (altitudeHigh - altitudeLow) * 1000,
    settledCompressionRangeMm: Math.max(...compressionHigh.map((high, gear) => high - compressionLow[gear])) * 1000,
    maxVerticalSpeedMps: maxVertical,
    maxCompressionMeters: maxCompression,
    horizontalDriftMeters: Math.hypot(north, east),
    finalPitchDeg: read("attitude/theta-deg"),
  };
}

interface PullRun {
  fault: string | null;
  /** The largest load at the pilot's seat, in g, and when after the pull began. */
  peakG: number;
  peakAfterPullSeconds: number;
  /** The load half a second after the stick returned to centre. */
  gAfterReleaseHalfSecond: number;
  /** Pitch rate and attitude at the end of the 3 s run. */
  finalPitchDeg: number;
  finalAltitudeMeters: number;
}

const PULL_START_SECONDS = 1;
const PULL_SECONDS = 0.5;

async function shortPull(physicsHz: PhysicsHz): Promise<PullRun> {
  const sdk = await c172Sdk();
  await bootstrapC172p(sdk, physicsHz);
  const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz });
  let peakG = -Infinity, peakAt = 0, afterRelease = Number.NaN;
  const releaseCheck = PULL_START_SECONDS + PULL_SECONDS + 0.5;
  fly(loop, 3, seconds => {
    const pulling = seconds >= PULL_START_SECONDS - 1e-9 && seconds < PULL_START_SECONDS + PULL_SECONDS - 1e-9;
    sdk.setPropertyValue("fcs/elevator-cmd-norm", pulling ? -1 : 0);
  }, seconds => {
    // Body Z points down: level flight reads -1.
    const g = -sdk.getPropertyValue("accelerations/n-pilot-z-norm");
    if (seconds > PULL_START_SECONDS && g > peakG) { peakG = g; peakAt = seconds - PULL_START_SECONDS; }
    if (Number.isNaN(afterRelease) && seconds >= releaseCheck - 1e-9) afterRelease = g;
  });
  return {
    fault: loop.getFault(), peakG, peakAfterPullSeconds: peakAt, gAfterReleaseHalfSecond: afterRelease,
    finalPitchDeg: sdk.getPropertyValue("attitude/theta-deg"),
    finalAltitudeMeters: sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT,
  };
}

/** Each scenario runs once per rate; the tests below read the same runs. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | null = null;
  return () => made ??= make();
}
const groundRuns = once(async () => {
  const runs = { 30: await restOnGear(30), 60: await restOnGear(60), 120: await restOnGear(120) };
  report.restOnGear = runs;
  return runs;
});
const pullRuns = once(async () => {
  const runs = { 30: await shortPull(30), 60: await shortPull(60), 120: await shortPull(120) };
  report.shortPull = runs;
  return runs;
});

/** Settled: no fault, and under 5 cm/s vertically over the last 3 s. 60 and 120 Hz settle to under 0.01 mm/s. */
function expectSettled(run: GroundRun): void {
  expect(run.fault).toBeNull();
  expect(run.settledMaxVerticalSpeedMps).toBeLessThan(0.05);
}

/** Like 120 Hz: the peak within 0.1 g, and no later or earlier than one step at the rate tested. */
function expectPullLike120(run: PullRun, reference: PullRun, physicsHz: PhysicsHz): void {
  expect(run.fault).toBeNull();
  expect(Math.abs(run.peakG - reference.peakG)).toBeLessThan(0.1);
  expect(Math.abs(run.peakAfterPullSeconds - reference.peakAfterPullSeconds)).toBeLessThanOrEqual(1 / physicsHz + 1e-9);
}

describe("the same C172 at 30, 60 and 120 Hz (comparison, not validation)", () => {
  it("rests on its gear at 120 and 60 Hz, 60 Hz where 120 Hz does", async () => {
    const runs = await groundRuns();
    expectSettled(runs[120]);
    expectSettled(runs[60]);
    expect(Math.abs(runs[60].finalHeightMeters - runs[120].finalHeightMeters)).toBeLessThan(0.005);
    expect(Math.abs(runs[60].finalPitchDeg - runs[120].finalPitchDeg)).toBeLessThan(0.1);
  });

  // Recorded failure, not tuned away: at 30 Hz the C172 keeps bouncing on its
  // gear (about 2 m/s vertically and 0.16 m of altitude in the last 3 s of 6).
  // When this starts passing, it.fails turns red: re-measure and update it.
  it.fails("rests on its gear at 30 Hz (fails: 30 Hz is not validated)", async () => {
    expectSettled((await groundRuns())[30]);
  });

  it("follows a short full elevator pull at 60 Hz as at 120 Hz", async () => {
    const runs = await pullRuns();
    expect(runs[120].fault).toBeNull();
    expectPullLike120(runs[60], runs[120], 60);
  });

  // Recorded failure: the 30 Hz peak load is within 0.04 g, but it comes about
  // 42 ms after the 120 Hz one, more than one 33 ms step.
  it.fails("follows a short full elevator pull at 30 Hz as at 120 Hz (fails: 30 Hz is not validated)", async () => {
    const runs = await pullRuns();
    expectPullLike120(runs[30], runs[120], 30);
  });
});
