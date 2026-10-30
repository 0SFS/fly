import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { JSBSimSdk, type PropertyBatch } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { createCameraFollow } from "@0sfs/aircraft/cameraFollow";
import { createPlaceholderAircraft } from "@0sfs/aircraft/createPlaceholderAircraft";
import { createAirframe, G } from "@0sfs/multirotor/airframe";
import { CONTROL, PLANT } from "@0sfs/multirotor/layout";
import { createMultirotor, type AircraftSample, type FlightCommand, type Multirotor } from "@0sfs/multirotor/multirotor";
import { readFlightState, releaseFlightStateReads } from "@0sfs/ground-contact/ecefBridge";
import { groundContactClearanceMeters } from "@0sfs/ground-contact/groundContactClearance";
import type { QuadFlightModeData, QuadVehicleModData } from "@0sfs/mods/schema";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDroneController, planDroneCommand, type DroneController, type DroneControllerStep } from "./droneController";
import type { DroneStickCommand } from "./droneGate";
import { resolveQuadPropeller } from "./quadRegistry";
import { buildDroneProfile } from "./droneTypes";
import { drawnModelFeet, standingPitchRad } from "../testing/modelLowestPoints";

const DT = 1 / 120, FT = 0.3048, LBF = 4.4482216152605, INERTIA = LBF * FT;
const SLUG = 14.5939029, DENSITY = 515.3788184, DEG = Math.PI / 180, RPM = 30 / Math.PI;
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const shared = JSON.parse(readFileSync(root + "Quadcopter/public/0sfs-mod.json", "utf8")).quadcopter;
const dji = JSON.parse(readFileSync(root + "DJI-Quadcopter/public/0sfs-mod.json", "utf8")).dji;
const wrenchPaths = ["fx", "fy", "fz", "l", "m", "n"].map(key => shared.properties[key] as string);
const cases = ["DJI-Mini2", "DJI-Air-2S"].map(directory => {
  const manifest = JSON.parse(readFileSync(root + directory + "/public/0sfs-mod.json", "utf8"));
  const id = manifest.aircraft.definitions[0].id as string;
  const cameraDirectory = directory === "DJI-Mini2" ? "DJI-FC7303" : "DJI-FC3411";
  const camera = JSON.parse(readFileSync(root + cameraDirectory + "/public/0sfs-mod.json", "utf8")).camera;
  const quad = { ...manifest.quad as QuadVehicleModData, propeller: resolveQuadPropeller(manifest.quad) };
  // Its model's feet tilt it a little nose-up when it stands on flat ground.
  const restPitchDeg = standingPitchRad(drawnModelFeet(root + directory)) / DEG;
  return { directory, id, manifest, quad, restPitchDeg, profile: manifest.aircraft.fdmProfiles[id],
    droneProfile: buildDroneProfile(id, manifest.name, shared, dji, quad, camera) };
});
type TestCase = (typeof cases)[number];

const reads = [
  "velocities/v-north-fps", "velocities/v-east-fps", "velocities/v-down-fps",
  "velocities/u-aero-fps", "velocities/v-aero-fps", "velocities/w-aero-fps",
  "velocities/p-rad_sec", "velocities/q-rad_sec", "velocities/r-rad_sec",
  "attitude/phi-rad", "attitude/theta-rad", "attitude/psi-rad",
  "inertia/mass-slugs", "inertia/ixx-slugs_ft2", "inertia/iyy-slugs_ft2", "inertia/izz-slugs_ft2",
  "atmosphere/rho-slugs_ft3", "position/h-agl-ft",
  ...[0, 1, 2, 3].map(i => `contact/unit[${i}]/WOW`),
  "position/lat-geod-rad", "position/long-gc-rad", "position/h-sl-ft",
  "forces/fbz-gear-lbs", "aero/force/X", "aero/force/Y", "aero/force/Z",
  "forces/fbx-total-lbs", "forces/fby-total-lbs", "forces/fbz-total-lbs",
] as const;
const slots = Object.fromEntries(reads.map((path, i) => [path, i])) as Record<(typeof reads)[number], number>;

interface Lab {
  id: string;
  /** Pitch it stands at on flat ground, in degrees. */
  restPitchDeg: number;
  sdk: JSBSimSdk;
  multirotor: Multirotor;
  sample: AircraftSample;
  values: Float64Array;
  batch: PropertyBatch;
  warnings: string[];
  steps: number;
  stepMs: number;
  read(): void;
  step(command: FlightCommand): void;
  dispose(): void;
}
const live: Lab[] = [];
const controllers: DroneController[] = [];
const reports: Record<string, number | string>[] = [];
const costs: { aircraft: string; steps: number; wallMs: number; warningCount: number }[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const lab of live.splice(0)) {
    costs.push({ aircraft: lab.id, steps: lab.steps, wallMs: lab.stepMs, warningCount: lab.warnings.length });
    expect.soft(lab.warnings).toEqual([]);
    lab.dispose();
  }
});
afterAll(() => {
  const directory = root + "build/multirotor-handoff/E-scratch/release-hold/";
  const cost = cases.map(testCase => {
    const runs = costs.filter(run => run.aircraft === testCase.id);
    const steps = runs.reduce((sum, run) => sum + run.steps, 0);
    const wallMs = runs.reduce((sum, run) => sum + run.wallMs, 0);
    return { aircraft: testCase.id, steps, wallMs, meanStepUs: wallMs * 1000 / steps,
      warningCount: runs.reduce((sum, run) => sum + run.warningCount, 0) };
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(directory + "quad-jsbsim-results.json", JSON.stringify({ dt: DT, node: process.version, backend: "typescript", reports, cost }, null, 2) + "\n");
  for (const scenario of new Set(reports.map(row => row.scenario))) console.table(reports.filter(row => row.scenario === scenario));
  console.table(cost);
});

async function boot(testCase: TestCase, heightM: number): Promise<Lab> {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false, stripAnsi: true } });
  const warnings: string[] = [];
  sdk.on("stderr", entry => { warnings.push(entry.message); });
  sdk.on("stdout", entry => { if (/unknown|unrecognized|mixed aerodynamic|warning/i.test(entry.message)) warnings.push(entry.message); });
  let batch: PropertyBatch | undefined, writes: PropertyBatch | undefined, multirotor: Multirotor | undefined;
  try {
    sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
    for (const file of testCase.manifest.jsbsimFiles as string[]) {
      sdk.writeDataFile(file, readFileSync(root + testCase.directory + "/public/jsbsim-data/" + file, "utf8"));
    }
    expect(sdk.loadModel(testCase.profile.model)).toBe(true);
    sdk.setDt(DT);
    const initial = sdk.createPropertyBatch([
      "ic/lat-geod-deg", "ic/long-gc-deg", "ic/h-sl-ft", "ic/terrain-elevation-ft",
      "ic/psi-true-deg", "ic/theta-deg", "ic/phi-deg", "ic/vc-kts",
      ...Object.keys(testCase.profile.initialProperties),
    ], { create: true });
    try {
      initial.write([44.977753, -93.265011, heightM / FT, 0, 0, 0, 0, 0,
        ...Object.values(testCase.profile.initialProperties) as number[]]);
      expect(sdk.runIc()).toBe(true);
    } finally { initial.dispose(); }
    batch = sdk.createPropertyBatch(reads, { create: false });
    expect(batch.missing).toEqual([]);
    writes = sdk.createPropertyBatch([...wrenchPaths, shared.properties.armed], { create: true });
    const values = new Float64Array(reads.length), wrench = new Float64Array(7);
    multirotor = createMultirotor(createAirframe(testCase.quad, DT));
    const sample: AircraftSample = { vn: 0, ve: 0, vd: 0, u: 0, v: 0, w: 0, p: 0, q: 0, r: 0,
      phi: 0, theta: 0, psi: 0, massKg: 0, ixx: 0, iyy: 0, izz: 0, rho: 0, aglM: NaN };
    const lab: Lab = {
      id: testCase.id, restPitchDeg: testCase.restPitchDeg, sdk, multirotor, sample, values, batch, warnings, steps: 0, stepMs: 0,
      read() {
        batch!.read(values);
        sample.vn = values[0] * FT; sample.ve = values[1] * FT; sample.vd = values[2] * FT;
        sample.u = values[3] * FT; sample.v = values[4] * FT; sample.w = values[5] * FT;
        sample.p = values[6]; sample.q = values[7]; sample.r = values[8];
        sample.phi = values[9]; sample.theta = values[10]; sample.psi = values[11];
        sample.massKg = values[12] * SLUG;
        sample.ixx = values[13] * INERTIA; sample.iyy = values[14] * INERTIA; sample.izz = values[15] * INERTIA;
        sample.rho = values[16] * DENSITY;
        const aglM = values[17] * FT;
        sample.aglM = aglM < 2 ? aglM : NaN;
      },
      step(command) {
        const start = performance.now();
        this.read();
        multirotor!.step(sample, command);
        const output = multirotor!.plant.output;
        for (let i = 0; i < 6; i++) wrench[i] = output[i] / (i < 3 ? LBF : INERTIA);
        wrench[6] = command.mode === CONTROL.MODE_STOPPED ? 0 : 1;
        writes!.write(wrench);
        if (!sdk.run()) throw new Error("JSBSim stopped");
        this.stepMs += performance.now() - start;
        this.steps++;
        this.read();
      },
      dispose() { batch!.dispose(); writes!.dispose(); multirotor!.dispose(); sdk.destroy(); },
    };
    lab.read();
    if (heightM > 1) {
      const omega = multirotor.airframe.hoverOmega(sample.massKg, sample.rho);
      for (let i = 0; i < multirotor.airframe.rotors; i++) {
        multirotor.plant.state[PLANT.state.globals + i * PLANT.state.stride + PLANT.state.OMEGA] = omega;
      }
    }
    live.push(lab);
    return lab;
  } catch (error) {
    batch?.dispose(); writes?.dispose(); multirotor?.dispose(); sdk.destroy();
    throw error;
  }
}

function command(mode: QuadFlightModeData, overrides: Partial<FlightCommand> = {}): FlightCommand {
  return { vn: 0, ve: 0, vd: 0, yawMode: CONTROL.YAW_RATE, yaw: 0, mode: CONTROL.MODE_FLYING,
    tanTiltMax: Math.tan(mode.tiltMaxDeg * DEG), yawRateMaxRad: mode.yawRateDeg * DEG, ...overrides };
}
const height = (lab: Lab) => lab.values[slots["position/h-agl-ft"]] * FT;
/** Degrees of pitch away from how it stands on flat ground. */
const pitchFromRest = (lab: Lab) => lab.sample.theta / DEG - lab.restPitchDeg;
const tilt = (lab: Lab) => Math.acos(Math.min(1, Math.max(-1, Math.cos(lab.sample.phi) * Math.cos(lab.sample.theta)))) / DEG;
const wow = (lab: Lab) => Array.from(lab.values.slice(18, 22));
const groundSpeed = (lab: Lab) => Math.hypot(lab.sample.vn, lab.sample.ve);
const gearLoad = (lab: Lab) => -lab.values[slots["forces/fbz-gear-lbs"]] * LBF / (lab.sample.massKg * G);
function verticalLoad(lab: Lab): number {
  const { phi, theta, massKg } = lab.sample;
  const down = -Math.sin(theta) * lab.values[slots["forces/fbx-total-lbs"]]
    + Math.sin(phi) * Math.cos(theta) * lab.values[slots["forces/fby-total-lbs"]]
    + Math.cos(phi) * Math.cos(theta) * lab.values[slots["forces/fbz-total-lbs"]];
  return -down * LBF / (massKg * G);
}
function advance(lab: Lab, seconds: number, cmd: FlightCommand, observe: (t: number) => void = () => {}) {
  for (let step = 0; step < Math.round(seconds / DT); step++) { lab.step(cmd); observe((step + 1) * DT); }
}
function report(lab: Lab, scenario: string, metrics: Record<string, number | string>) {
  reports.push({ aircraft: lab.id, scenario, ...metrics, meanStepUs: lab.stepMs * 1000 / lab.steps, steps: lab.steps });
}

const centered: DroneStickCommand = { pitch: 0, roll: 0, vertical: 0, yaw: 0, yawMode: "angularVelocity",
  yawAngleDeg: null, gimbalPitchDeg: 0, sport: false, shutter: false, capture360: false };
function controlledStep(lab: Lab, controller: DroneController, sticks: DroneStickCommand): DroneControllerStep {
  const start = performance.now();
  const result = controller.step(lab.sdk, sticks, DT, 0);
  if (!lab.sdk.run()) throw new Error("JSBSim stopped");
  lab.stepMs += performance.now() - start;
  lab.steps++;
  lab.read();
  return result;
}
function controlledAdvance(lab: Lab, controller: DroneController, seconds: number, sticks: DroneStickCommand) {
  for (let step = 0; step < Math.round(seconds / DT); step++) controlledStep(lab, controller, sticks);
}

interface ViewFrame { phase: string; viewDeg: number; droneDeg: number; speedMps: number }
const wrapDeg = (deg: number) => deg - 360 * Math.floor((deg + 180) / 360);
/**
 * Flies the legs through the shipped controller and, like the app at 60
 * frames a second, turns the actual chase camera with the Momentum frame
 * built from the flight state the app reads. Records where the camera looks
 * and where the drone points, as compass headings, each frame.
 */
function watchMomentumView(lab: Lab, controller: DroneController, legs: readonly { phase: string; seconds: number; sticks: DroneStickCommand }[]): ViewFrame[] {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const aircraft = createPlaceholderAircraft(scene, new TransformNode("origin", scene));
  const follow = createCameraFollow(), frames: ViewFrame[] = [];
  try {
    for (const leg of legs) for (let frame = 0; frame < Math.round(leg.seconds * 60); frame++) {
      controlledStep(lab, controller, leg.sticks);
      controlledStep(lab, controller, leg.sticks);
      const state = readFlightState(lab.sdk);
      aircraft.setChaseFrame(follow.update("momentum", state, 1 / 60));
      // A new frame, so the chase pivot's world matrix is computed again.
      scene.incrementRenderId();
      const look = Vector3.TransformNormal(new Vector3(0, 0, -1), aircraft.thirdPersonCamera.getViewMatrix(true).clone().invert());
      frames.push({ phase: leg.phase, viewDeg: Math.atan2(look.x, -look.z) / DEG, droneDeg: state.headingRad / DEG,
        speedMps: Math.hypot(state.northVelocityFps, state.eastVelocityFps) * FT });
    }
  } finally { releaseFlightStateReads(lab.sdk); aircraft.dispose(); scene.dispose(); engine.dispose(); }
  return frames;
}
function controlledLanding(lab: Lab, controller: DroneController, sport: boolean, scenario: string) {
  let contactStep = -1, peakLoad = 0, low = Infinity, bounce = 0, maxVd = 0, impactSpeed = 0;
  let maxTerrainDifference = 0, result: DroneControllerStep | null = null;
  const sticks = { ...centered, vertical: -1, sport };
  for (let step = 0; step < 45 / DT; step++) {
    const priorVd = lab.sample.vd;
    result = controlledStep(lab, controller, sticks);
    maxVd = Math.max(maxVd, lab.sample.vd);
    low = Math.min(low, height(lab));
    peakLoad = Math.max(peakLoad, verticalLoad(lab));
    maxTerrainDifference = Math.max(maxTerrainDifference,
      Math.abs(lab.sdk.getPropertyValue("position/terrain-elevation-asl-ft") * FT));
    if (contactStep < 0 && wow(lab).some(value => value === 1)) {
      contactStep = step;
      impactSpeed = priorVd;
    }
    // Include all suspension recovery after first contact, even with feet down.
    if (contactStep >= 0) bounce = Math.max(bounce, height(lab) - low);
    if (contactStep >= 0 && step - contactStep >= 3 / DT) break;
  }
  report(lab, scenario, { maxDescentMps: maxVd, impactSpeedMps: impactSpeed, peakLoadG: peakLoad,
    bounceM: bounce, minCgHeightM: low, maxTerrainDifferenceM: maxTerrainDifference,
    finalRollDeg: lab.sample.phi / DEG, finalPitchDeg: lab.sample.theta / DEG,
    armed: Number(result?.armed), wow: wow(lab).join(",") });
  expect.soft(contactStep).toBeGreaterThanOrEqual(0);
  expect.soft(peakLoad).toBeLessThan(3); expect.soft(bounce).toBeLessThan(0.005);
  expect.soft(low).toBeGreaterThan(0); expect.soft(wow(lab)).toEqual([1, 1, 1, 1]);
  expect.soft(Math.abs(lab.sample.phi / DEG)).toBeLessThan(1);
  expect.soft(Math.abs(pitchFromRest(lab))).toBeLessThan(1);
  expect.soft(result?.armed).toBe(false);
  expect.soft(lab.sdk.getPropertyValue("multirotor/armed")).toBe(0);
  expect.soft(maxTerrainDifference).toBeLessThan(0.001);
  return maxVd;
}

describe.each(cases)("$id real JSBSim and multirotor", testCase => {
  it("settles unarmed on four feet and stays still for ten seconds", async () => {
    const lab = await boot(testCase, 0.04), cmd = command(testCase.quad.modes.normal, { mode: CONTROL.MODE_STOPPED });
    let settledAtS = 0;
    advance(lab, 2, cmd, t => {
      if (!wow(lab).every(value => value === 1) || Math.abs(lab.sample.phi / DEG) >= 1
        || Math.abs(pitchFromRest(lab)) >= 1 || Math.abs(lab.sample.vd) >= 0.01) settledAtS = t;
    });
    const at2 = { phi: lab.sample.phi / DEG, theta: lab.sample.theta / DEG, wow: wow(lab) };
    const north0 = lab.values[22], east0 = lab.values[23];
    let creep = 0, low = height(lab), high = low, maxRoll = Math.abs(at2.phi), maxPitch = Math.abs(pitchFromRest(lab));
    const allFeet = [1, 1, 1, 1];
    advance(lab, 10, cmd, () => {
      low = Math.min(low, height(lab)); high = Math.max(high, height(lab));
      maxRoll = Math.max(maxRoll, Math.abs(lab.sample.phi / DEG)); maxPitch = Math.max(maxPitch, Math.abs(pitchFromRest(lab)));
      for (let i = 0; i < 4; i++) allFeet[i] = Math.min(allFeet[i], lab.values[18 + i]);
      creep = Math.max(creep, Math.hypot((lab.values[22] - north0) * 6378137,
        (lab.values[23] - east0) * 6378137 * Math.cos(north0)));
    });
    report(lab, "rest", { settledAtS, wowAt2: at2.wow.join(","), phiDeg: at2.phi, thetaDeg: at2.theta,
      maxRollDeg: maxRoll, maxPitchDeg: maxPitch, creepM: creep, bounceM: high - low, heightM: height(lab) });
    expect.soft(at2.wow).toEqual([1, 1, 1, 1]);
    expect.soft(allFeet).toEqual([1, 1, 1, 1]); expect.soft(settledAtS).toBeLessThan(2);
    expect.soft(maxRoll).toBeLessThan(1); expect.soft(maxPitch).toBeLessThan(1);
    expect.soft(creep).toBeLessThan(0.01); expect.soft(high - low).toBeLessThan(0.003);
    expect.soft(height(lab)).toBeGreaterThan(0);
  });

  it("hovers at twenty metres at the predicted rotor speed", async () => {
    const lab = await boot(testCase, 20);
    let maxHeightError = 0;
    advance(lab, 10, command(testCase.quad.modes.normal), () => { maxHeightError = Math.max(maxHeightError, Math.abs(height(lab) - 20)); });
    const targetRpm = lab.multirotor.airframe.hoverOmega(lab.sample.massKg, lab.sample.rho) * RPM;
    const rpms = [0, 1, 2, 3].map(i => lab.multirotor.plant.output[PLANT.output.globals + i * PLANT.output.stride + PLANT.output.OMEGA] * RPM);
    const maxRpmError = Math.max(...rpms.map(rpm => Math.abs(rpm / targetRpm - 1)));
    report(lab, "hover", { heightErrorM: maxHeightError, targetRpm, frontLeftRpm: rpms[0], frontRightRpm: rpms[1],
      rearLeftRpm: rpms[2], rearRightRpm: rpms[3], rpmErrorPercent: maxRpmError * 100 });
    expect.soft(maxHeightError).toBeLessThan(0.2); expect.soft(maxRpmError).toBeLessThan(0.03);
  });

  for (const [modeName, mode] of Object.entries(testCase.quad.modes)) {
    it(`brakes from full ${modeName} forward speed and holds the stopping point after release`, async () => {
      const lab = await boot(testCase, 20), controller = createDroneController(testCase.droneProfile);
      controllers.push(controller);
      const sticks = { ...centered, sport: modeName === "sport" };
      controlledAdvance(lab, controller, 10, { ...sticks, pitch: 1 });
      expect.soft(lab.sample.vn).toBeGreaterThanOrEqual(mode.speedMps * .97);
      const releaseLat = lab.values[22], releaseHeight = height(lab);
      const distance = () => (lab.values[22] - releaseLat) * 6378137;
      let farthest = 0;
      for (let step = 0; step < 18 / DT; step++) {
        controlledStep(lab, controller, sticks);
        farthest = Math.max(farthest, distance());
      }
      const stopped = distance(), stoppedLon = lab.values[23];
      let holdWander = 0, heightError = 0;
      for (let step = 0; step < 10 / DT; step++) {
        controlledStep(lab, controller, sticks);
        farthest = Math.max(farthest, distance());
        holdWander = Math.max(holdWander, Math.hypot(distance() - stopped,
          (lab.values[23] - stoppedLon) * 6378137 * Math.cos(releaseLat)));
        heightError = Math.max(heightError, Math.abs(height(lab) - releaseHeight));
      }
      report(lab, modeName + " forward release", { stoppingDistanceM: stopped, retraceM: farthest - distance(),
        holdWanderM: holdWander, finalGroundSpeedMps: groundSpeed(lab), heightErrorM: heightError });
      expect.soft(stopped).toBeGreaterThan(1);
      expect.soft(farthest - distance()).toBeLessThan(.5);
      expect.soft(holdWander).toBeLessThan(.25);
      expect.soft(groundSpeed(lab)).toBeLessThan(.1);
      expect.soft(heightError).toBeLessThan(.25);
    });

    it.each([1, -1])(`brakes a full ${modeName} vertical command of %s before holding the stopping altitude`, async vertical => {
      const lab = await boot(testCase, 100), controller = createDroneController(testCase.droneProfile);
      controllers.push(controller);
      const sticks = { ...centered, sport: modeName === "sport" };
      controlledAdvance(lab, controller, 6, { ...sticks, vertical });
      const target = vertical > 0 ? mode.climbMps : mode.descentMps;
      expect.soft(-vertical * lab.sample.vd).toBeGreaterThanOrEqual(target * .95);
      const releaseHeight = height(lab), releaseLat = lab.values[22], releaseLon = lab.values[23];
      let farthest = 0;
      for (let step = 0; step < 18 / DT; step++) {
        controlledStep(lab, controller, sticks);
        farthest = Math.max(farthest, vertical * (height(lab) - releaseHeight));
      }
      const stoppedHeight = height(lab);
      let holdWander = 0, horizontalError = 0;
      for (let step = 0; step < 10 / DT; step++) {
        controlledStep(lab, controller, sticks);
        farthest = Math.max(farthest, vertical * (height(lab) - releaseHeight));
        holdWander = Math.max(holdWander, Math.abs(height(lab) - stoppedHeight));
        horizontalError = Math.max(horizontalError, Math.hypot((lab.values[22] - releaseLat) * 6378137,
          (lab.values[23] - releaseLon) * 6378137 * Math.cos(releaseLat)));
      }
      const stoppingDistance = vertical * (stoppedHeight - releaseHeight);
      report(lab, modeName + (vertical > 0 ? " climb release" : " descent release"), {
        stoppingDistanceM: stoppingDistance, retraceM: farthest - vertical * (height(lab) - releaseHeight),
        holdWanderM: holdWander, finalVerticalSpeedMps: lab.sample.vd, horizontalErrorM: horizontalError });
      expect.soft(stoppingDistance).toBeGreaterThan(.5);
      expect.soft(farthest - vertical * (height(lab) - releaseHeight)).toBeLessThan(.5);
      expect.soft(holdWander).toBeLessThan(.25);
      expect.soft(Math.abs(lab.sample.vd)).toBeLessThan(.1);
      expect.soft(horizontalError).toBeLessThan(.25);
    });

    it(`lands from forty metres with full ${modeName} descent through the shipped controller`, async () => {
      const lab = await boot(testCase, 40), controller = createDroneController(testCase.droneProfile);
      controllers.push(controller);
      const maxVd = controlledLanding(lab, controller, modeName === "sport", modeName + " full descent landing");
      expect.soft(maxVd).toBeGreaterThanOrEqual(mode.descentMps * .97);
    });

    it(`reaches ${modeName} speed in ten seconds within its tilt and height limits`, async () => {
      const lab = await boot(testCase, 20);
      let maxTilt = 0, maxHeightError = 0, reached97AtS = Infinity;
      advance(lab, 10, command(mode, { vn: mode.speedMps }), t => {
        if (lab.sample.vn >= 0.97 * mode.speedMps) reached97AtS = Math.min(reached97AtS, t);
        maxTilt = Math.max(maxTilt, tilt(lab)); maxHeightError = Math.max(maxHeightError, Math.abs(height(lab) - 20));
      });
      report(lab, modeName + " speed", { targetMps: mode.speedMps, speedMps: lab.sample.vn, percent: lab.sample.vn / mode.speedMps * 100,
        reached97AtS, maxTiltDeg: maxTilt, heightErrorM: maxHeightError });
      expect.soft(reached97AtS).toBeLessThanOrEqual(10);
      expect.soft(lab.sample.vn).toBeGreaterThanOrEqual(0.97 * mode.speedMps);
      expect.soft(lab.sample.vn).toBeLessThanOrEqual(1.02 * mode.speedMps);
      expect.soft(maxTilt).toBeLessThanOrEqual(mode.tiltMaxDeg + 1.5);
      expect.soft(maxHeightError).toBeLessThan(1.5);
    });

    it(`climbs and descends at ${modeName} rates through the vortex ring`, async () => {
      const climb = await boot(testCase, 20);
      advance(climb, 6, command(mode, { vd: -mode.climbMps }));
      const descent = await boot(testCase, 100);
      let maxTilt = 0, drift = 0, maxVrs = 0;
      advance(descent, 10, command(mode, { vd: mode.descentMps }), () => {
        maxTilt = Math.max(maxTilt, tilt(descent)); drift = Math.max(drift, groundSpeed(descent));
        for (let i = 0; i < 4; i++) maxVrs = Math.max(maxVrs, descent.multirotor.plant.output[PLANT.output.globals + i * PLANT.output.stride + PLANT.output.VRS]);
      });
      report(descent, modeName + " vertical", { climbTargetMps: mode.climbMps, climbMps: -climb.sample.vd,
        descentTargetMps: mode.descentMps, descentMps: descent.sample.vd, maxTiltDeg: maxTilt, driftMps: drift, maxVrs });
      expect.soft(Math.abs(-climb.sample.vd / mode.climbMps - 1)).toBeLessThan(0.05);
      expect.soft(Math.abs(descent.sample.vd / mode.descentMps - 1)).toBeLessThan(0.05);
      expect.soft(maxVrs).toBeGreaterThan(0.1);
      expect.soft(maxTilt).toBeLessThan(8); expect.soft(drift).toBeLessThan(0.5);
    });
  }

  it("lands through the shipped controller after climb, hover, forward flight and release", async () => {
    const lab = await boot(testCase, .04), controller = createDroneController(testCase.droneProfile);
    controllers.push(controller);
    controlledAdvance(lab, controller, 2, centered);
    controlledAdvance(lab, controller, 3, { ...centered, vertical: 1 });
    controlledAdvance(lab, controller, 4, centered);
    controlledAdvance(lab, controller, 9, { ...centered, pitch: 1 });
    controlledAdvance(lab, controller, 5, centered);
    controlledLanding(lab, controller, false, "browser sequence landing");
  });

  it("keeps the Momentum camera behind the drone after a stop, a turn in place and a fly-off", async () => {
    const lab = await boot(testCase, 20), controller = createDroneController(testCase.droneProfile);
    controllers.push(controller);
    const frames = watchMomentumView(lab, controller, [
      { phase: "forward", seconds: 5, sticks: { ...centered, pitch: 1 } },
      { phase: "stop", seconds: 6, sticks: centered },
      { phase: "turn", seconds: 1.5, sticks: { ...centered, yaw: 1 } },
      { phase: "turned", seconds: 1, sticks: centered },
      { phase: "fly off", seconds: 4, sticks: { ...centered, pitch: 1 } },
    ]);
    const of = (phase: string) => frames.filter(frame => frame.phase === phase);
    const offset = (frame: ViewFrame) => Math.abs(wrapDeg(frame.viewDeg - frame.droneDeg));
    const stopped = of("stop").at(-1)!, turned = of("turned").at(-1)!, flyOff = of("fly off");
    let swing = 0, peakRate = 0, previous = turned;
    for (const frame of flyOff) {
      swing = Math.max(swing, Math.abs(wrapDeg(frame.viewDeg - turned.viewDeg)));
      peakRate = Math.max(peakRate, Math.abs(wrapDeg(frame.viewDeg - previous.viewDeg)) * 60);
      previous = frame;
    }
    const stillSpeed = Math.max(...[...of("turn"), ...of("turned")].map(frame => frame.speedMps));
    const turnDeg = wrapDeg(turned.droneDeg - stopped.droneDeg);
    report(lab, "momentum turn in place", { turnDeg, stillSpeedMps: stillSpeed, offsetAfterTurnDeg: offset(turned),
      flyOffSwingDeg: swing, flyOffPeakRateDegS: peakRate, flyOffSpeedMps: flyOff.at(-1)!.speedMps });
    // The scenario itself: behind the drone at the stop, a turn without moving, then a real fly-off.
    expect(offset(stopped)).toBeLessThan(3);
    expect(stillSpeed).toBeLessThan(.5);
    expect(Math.abs(turnDeg)).toBeGreaterThan(60);
    expect(flyOff.at(-1)!.speedMps).toBeGreaterThan(5);
    // Standing still there is no course, so the view turns with the drone,
    // and flying off along the new heading does not swing it.
    expect.soft(offset(turned), "view off the drone's heading after turning in place, degrees").toBeLessThan(5);
    expect.soft(swing, "view swing while flying off, degrees").toBeLessThan(10);
    expect.soft(peakRate, "peak view turn rate while flying off, degrees per second").toBeLessThan(30);
  });

  it("leans into a ten metre per second north wind with downwind body drag", async () => {
    const lab = await boot(testCase, 20);
    const wind = lab.sdk.createPropertyBatch(["atmosphere/wind-north-fps"], { create: false });
    try { expect(wind.missing).toEqual([]); wind.write([10 / FT]); } finally { wind.dispose(); }
    lab.step(command(testCase.quad.modes.normal));
    const initialDragN = lab.values[slots["aero/force/X"]] * LBF;
    advance(lab, 10, command(testCase.quad.modes.normal));
    report(lab, "wind", { northWindMps: 10, initialDragN, groundSpeedMps: groundSpeed(lab), pitchDeg: lab.sample.theta / DEG });
    expect.soft(initialDragN).toBeGreaterThan(0);
    expect.soft(groundSpeed(lab)).toBeLessThan(0.1);
    expect.soft(lab.sample.theta / DEG).toBeGreaterThan(5); expect.soft(lab.sample.theta / DEG).toBeLessThan(20);
  });

  it("lands from a one metre per second descent without a hard impact or bounce", async () => {
    const lab = await boot(testCase, 2);
    const touchdownAglM = groundContactClearanceMeters(lab.sdk, 0, 0);
    expect(touchdownAglM).toBeCloseTo(testCase.directory === "DJI-Mini2" ? .035 : .0558, 8);
    const sticks: DroneStickCommand = { pitch: 0, roll: 0, vertical: -1 / testCase.quad.modes.normal.descentMps,
      yaw: 0, yawMode: "angularVelocity", yawAngleDeg: null, gimbalPitchDeg: 0, sport: false, shutter: false, capture360: false };
    let armed = true, disarmSeconds = 0;
    let contacted = false, peakLoad = 0, peakGearLoad = 0, bounce = 0, low = Infinity, minGroundEffect = 1, impactSpeed = 0;
    for (let step = 0; step < 10 / DT; step++) {
      const priorVd = lab.sample.vd;
      const onGround = wow(lab).some(value => value === 1);
      // Fly the shipped slowdown and idle on contact, then hold descent to disarm.
      disarmSeconds = onGround ? disarmSeconds + DT : 0;
      if (disarmSeconds >= 1 - 1e-9) armed = false;
      lab.step(planDroneCommand({
        profile: testCase.droneProfile, command: onGround ? { ...sticks, vertical: -1 } : sticks,
        psi: lab.sample.psi, latDeg: lab.values[22] / DEG, lonDeg: lab.values[23] / DEG,
        altM: lab.values[24] * FT, vn: lab.sample.vn, ve: lab.sample.ve, vd: lab.sample.vd,
        hold: null, aglM: height(lab), touchdownAglM, onGround,
        armed, dt: DT, gimbalDeg: 0,
      }).flight);
      if (wow(lab).some(value => value === 1)) {
        if (!contacted) impactSpeed = priorVd;
        contacted = true;
      }
      peakLoad = Math.max(peakLoad, verticalLoad(lab));
      peakGearLoad = Math.max(peakGearLoad, gearLoad(lab));
      // Count suspension recovery as rebound too, even with feet still down.
      if (contacted) { low = Math.min(low, height(lab)); bounce = Math.max(bounce, height(lab) - low); }
      for (let i = 0; i < 4; i++) minGroundEffect = Math.min(minGroundEffect,
        lab.multirotor.plant.output[PLANT.output.globals + i * PLANT.output.stride + PLANT.output.GROUND_EFFECT]);
    }
    report(lab, "landing", { touchdownAglM, impactSpeedMps: impactSpeed, peakLoadG: peakLoad, peakGearLoadG: peakGearLoad, bounceM: bounce,
      minCgHeightM: low, groundEffect: minGroundEffect, wow: wow(lab).join(",") });
    expect.soft(contacted).toBe(true); expect.soft(wow(lab)).toEqual([1, 1, 1, 1]);
    expect.soft(peakLoad).toBeLessThan(3); expect.soft(bounce).toBeLessThan(0.005);
    expect.soft(low).toBeGreaterThan(0);
    expect.soft(minGroundEffect).toBeLessThan(1);
  });
});
