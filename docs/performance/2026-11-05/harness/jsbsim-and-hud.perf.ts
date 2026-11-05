// @vitest-environment jsdom
// Measurements behind docs/performance/2026-11-05/README.md. Each case appends
// one JSON line to build/perf-20261105/results.jsonl. Run with the vitest
// config in this folder; see its header for the command.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { applyFlightControls } from "@0sfs/controls/applyFlightControls";
import { setExternalFuelTankAttached } from "@0sfs/fuel/externalFuelTanks";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { it } from "vitest";
import { computeAttitudeScene, createAttitudeProjection } from "../../../../src/flight/hud/attitudeIndicator";
import { bootstrapAircraft } from "../../../../src/flight/jsbsim/bootstrapC172";
import { getFdmProfile, type EngineModelId } from "../../../../src/flight/jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../../../../src/flight/jsbsim/hydrateJsbsimData";

const fly = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = path.join(fly, "build/perf-20261105");
mkdirSync(out, { recursive: true });
const record = (row: object): void => appendFileSync(path.join(out, "results.jsonl"), JSON.stringify({ ...row, node: process.version }) + "\n");
const COUNT_INVOKES = process.env.COUNT_INVOKES === "1";
type Counter = typeof globalThis & { __osfsInvokes?: number };

/** A copy of the Emscripten glue whose invoke_* trampolines count their calls. */
function countingGlue(): { moduleUrl: URL; wasmUrl: URL } {
  const dir = path.join(out, "counting-glue");
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(fileURLToPath(wasmModuleUrl), "utf8");
  let patched = 0;
  const glue = source.replace(/function (invoke_[a-z]+)\(([^)]*)\)\{/g, (_match, name: string, args: string) => {
    patched++;
    return `function ${name}(${args}){globalThis.__osfsInvokes=(globalThis.__osfsInvokes||0)+1;`;
  });
  if (patched === 0) throw new Error("No invoke_* trampolines found: the SDK was built without JavaScript exception handling.");
  writeFileSync(path.join(dir, "jsbsim_wasm.mjs"), glue);
  copyFileSync(fileURLToPath(wasmBinaryUrl), path.join(dir, "jsbsim_wasm.wasm"));
  return { moduleUrl: pathToFileURL(path.join(dir, "jsbsim_wasm.mjs")), wasmUrl: pathToFileURL(path.join(dir, "jsbsim_wasm.wasm")) };
}
const urls = COUNT_INVOKES ? countingGlue() : { moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl };

/** One aircraft at 60 Hz, airborne at 5,000 ft, as the flight bootstraps it. */
async function aircraft(id: string, engineModel?: EngineModelId): Promise<JSBSimSdk> {
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  const sdk = await JSBSimSdk.create({ ...urls, persistence: { enabled: false }, log: { console: false } });
  const manifest: unknown = JSON.parse(readFileSync(path.join(fly, "public/jsbsim-data/manifest.json"), "utf8"));
  const packages = engineModel === "empirical" ? [id, `${id}-empirical-engine`] : [id];
  for (const file of new Set(packages.flatMap(name => resolveAircraftDataFiles(manifest, name)))) {
    sdk.writeDataFile(file, readFileSync(path.join(fly, "public/jsbsim-data", file), "utf8"));
  }
  await bootstrapAircraft(sdk, id as never, 60, { altFt: 5000, ...(engineModel ? { engineModel } : {}) });
  if (id === "f-35b") for (const index of [2, 3]) setExternalFuelTankAttached(sdk, "f-35b", index, false);
  for (let i = 0; i < 600; i++) sdk.run();
  return sdk;
}

const microseconds = (count: number, work: () => void): number => {
  const started = performance.now();
  for (let i = 0; i < count; i++) work();
  return (performance.now() - started) * 1000 / count;
};

const PATHS_22 = ["position/h-sl-ft", "attitude/phi-deg", "attitude/theta-deg", "attitude/psi-deg", "inertia/cg-x-in", "inertia/cg-y-in",
  "inertia/cg-z-in", "gear/gear-pos-norm", "position/lat-geod-deg", "position/long-gc-deg", "velocities/v-down-fps",
  "position/terrain-elevation-asl-ft", "velocities/u-fps", "velocities/v-fps", "velocities/w-fps", "velocities/p-rad_sec",
  "velocities/q-rad_sec", "velocities/r-rad_sec", "inertia/weight-lbs", "velocities/vc-kts", "accelerations/n-pilot-z-norm", "fcs/elevator-pos-rad"];

const CASES: [string, EngineModelId?][] = [["cessna-172"], ["cirrus-vision-jet"], ["f-35b"], ["f-35b", "empirical"]];

for (const [id, engineModel] of CASES) {
  it(`JSBSim step and property costs: ${id}${engineModel ? ` (${engineModel})` : ""}`, async () => {
    const sdk = await aircraft(id, engineModel);
    const counter = globalThis as Counter;
    counter.__osfsInvokes = 0;
    const steps = id === "f-35b" && !engineModel ? 2000 : 6000;
    const stepUs = microseconds(steps, () => sdk.run());
    const invokesPerStep = (counter.__osfsInvokes ?? 0) / steps;
    counter.__osfsInvokes = 0;
    let sink = 0;
    const getUs = microseconds(50_000, () => { sink += sdk.getPropertyValue("velocities/vc-kts"); });
    const invokesPerGet = (counter.__osfsInvokes ?? 0) / 50_000;
    const setUs = microseconds(50_000, () => sdk.setPropertyValue("fcs/elevator-cmd-norm", 0));
    const batch = sdk.createPropertyBatch(PATHS_22, { create: false });
    const values = new Float64Array(PATHS_22.length);
    const batchUs = microseconds(20_000, () => batch.read(values));
    const scalarUs = microseconds(5_000, () => { for (let k = 0; k < PATHS_22.length; k++) values[k] = sdk.getPropertyValue(PATHS_22[k]); });
    record({
      case: "jsbsim-step", aircraft: id, engineModel: engineModel ?? "default", countingInvokes: COUNT_INVOKES,
      usPerStep: +stepUs.toFixed(1), invokesPerStep: COUNT_INVOKES ? +invokesPerStep.toFixed(1) : null,
      scalarGetUs: +getUs.toFixed(2), invokesPerScalarGet: COUNT_INVOKES ? +invokesPerGet.toFixed(1) : null, scalarSetUs: +setUs.toFixed(2),
      batch22Us: +batchUs.toFixed(2), scalar22Us: +scalarUs.toFixed(1), batchMissing: batch.missing.length, finite: Number.isFinite(sink),
    });
    batch.dispose();
    sdk.destroy();
  });
}

/** A flat test surface 250 m above the WGS84 ellipsoid. */
const flatSurface = (() => {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), height = 250;
  const sample = (latDeg: number, lonDeg: number) => {
    const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const point = { x: (n + height) * Math.cos(lat) * Math.cos(lon), y: (n + height) * Math.cos(lat) * Math.sin(lon), z: (n * (1 - e2) + height) * Math.sin(lat) };
    const length = Math.hypot(point.x, point.y, point.z);
    return { point, normal: { x: point.x / length, y: point.y / length, z: point.z / length }, distanceMeters: 0, heightMeters: height, meshId: "flat", revision: 1, quality: 1 };
  };
  return { sample, raycast: () => null, revision: () => 1 };
})();

for (const id of ["cessna-172", "f-35b"]) {
  it(`Scalar property calls per step from terrain contact and controls: ${id}`, async () => {
    const sdk = await aircraft(id);
    const profile = getFdmProfile(id as never);
    const contact = createTerrainContact(sdk, flatSurface as never, profile.stance, { bodyProbes: profile.bodyCollisionProbes });
    const calls = { get: 0, set: 0 };
    const get = sdk.getPropertyValue.bind(sdk), set = sdk.setPropertyValue.bind(sdk);
    sdk.getPropertyValue = (property: string) => { calls.get++; return get(property); };
    sdk.setPropertyValue = (property: string, value: number) => { calls.set++; return set(property, value); };
    const controls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.8, pitchTrim: 0, rollTrim: 0, flaps: 0, brake: 0 };
    const step = () => {
      contact.update(false, false, true, true);
      applyFlightControls(sdk, controls as never, 1, profile.rudderSign);
      sdk.run();
    };
    for (let i = 0; i < 120; i++) step();
    calls.get = 0; calls.set = 0;
    const steps = 2000;
    const stepUs = microseconds(steps, step);
    const perStep = { get: calls.get / steps, set: calls.set / steps };
    const contactUs = microseconds(steps, () => contact.update(false, false, true, true));
    const controlsUs = microseconds(steps, () => applyFlightControls(sdk, controls as never, 1, profile.rudderSign));
    record({ case: "step-calls", aircraft: id, scalarGetsPerStep: perStep.get, scalarSetsPerStep: perStep.set,
      usPerStepIncludingRun: +stepUs.toFixed(1), terrainContactUpdateUs: +contactUs.toFixed(1), applyFlightControlsUs: +controlsUs.toFixed(1) });
    contact.dispose();
    sdk.destroy();
  });
}

it("F135 plant numerics in steady flight, reduced and component algorithms", async () => {
  const sdk = await aircraft("f-35b");
  const plant = "propulsion/engine[0]/plant/";
  const fields = ["numerics/step-algorithm", "numerics/iterations", "numerics/step-iterations", "numerics/publication-iterations",
    "numerics/residual-evaluations", "numerics/substeps", "numerics/fallback-reason"];
  const mean = (steps: number) => {
    const sums: Record<string, number> = {};
    for (let i = 0; i < steps; i++) {
      sdk.run();
      for (const field of fields) sums[field] = (sums[field] ?? 0) + sdk.getPropertyValue(plant + field) / steps;
    }
    return Object.fromEntries(Object.entries(sums).map(([field, value]) => [field, +value.toFixed(2)]));
  };
  const reduced = { configured: sdk.getPropertyValue(plant + "settings/algorithm"), numerics: mean(600), usPerStep: +microseconds(1200, () => sdk.run()).toFixed(1) };
  sdk.setPropertyValue(plant + "settings/algorithm", 0);
  for (let i = 0; i < 120; i++) sdk.run();
  const component = { numerics: mean(600), usPerStep: +microseconds(1200, () => sdk.run()).toFixed(1) };
  record({ case: "f135-plant", reduced, component });
  sdk.destroy();
});

for (const id of ["cessna-172", "f-35b"]) {
  it.skipIf(COUNT_INVOKES)(`Self time of a JSBSim step by owner (CPU profile): ${id}`, async () => {
    const sdk = await aircraft(id);
    const session = new Session();
    session.connect();
    const post = <T = unknown>(method: string, params: object = {}) => new Promise<T>((resolve, reject) =>
      session.post(method, params, (error, result) => error ? reject(error) : resolve(result as T)));
    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", { interval: 50 });
    await post("Profiler.start");
    const steps = id === "f-35b" ? 4000 : 20_000;
    const stepUs = microseconds(steps, () => sdk.run());
    const { profile } = await post<{ profile: { nodes: { id: number; callFrame: { functionName: string; url: string } }[]; samples: number[]; timeDeltas: number[] } }>("Profiler.stop");
    session.disconnect();
    const nodes = new Map(profile.nodes.map(node => [node.id, node]));
    const owners = new Map<string, number>();
    let total = 0;
    profile.samples.forEach((sample, index) => {
      const { functionName: name, url } = nodes.get(sample)!.callFrame;
      // The inspector's own calls around the loop are not part of a step.
      if (url.startsWith("node:inspector")) return;
      const owner = name.startsWith("invoke_") ? "invoke trampolines"
        : /stackSave|stackRestore|getWasmTableEntry|setThrew/.test(name) ? "trampoline stack and table helpers"
        : url.startsWith("wasm://") ? "WebAssembly" : `other (${name || "anonymous"})`;
      const delta = profile.timeDeltas[index] ?? 0;
      owners.set(owner, (owners.get(owner) ?? 0) + delta);
      total += delta;
    });
    const shares = Object.fromEntries([...owners].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([owner, us]) => [owner, +(100 * us / total).toFixed(1)]));
    record({ case: "jsbsim-profile", aircraft: id, usPerStepWhileProfiling: +stepUs.toFixed(1), selfTimePercent: shares });
    sdk.destroy();
  });
}

it("Attitude indicator scene, with grid lines (Canvas 2D) and without (WebGPU)", () => {
  const projection = createAttitudeProjection(220, 220 * 0.45);
  let frame = 0;
  const scene = (lines: boolean) => computeAttitudeScene({
    rollRad: 0.3 + frame * 1e-4, pitchRad: 0.05 + frame * 1e-5, headingRad: 1.2 + frame++ * 2e-5,
    northVelocityFps: 150, eastVelocityFps: 20, verticalSpeedFps: 3,
  }, projection, { lines });
  const sample = scene(true);
  const projectedPoints = [sample.horizon, sample.skyRings, sample.groundRings, sample.meridians, sample.cardinalMeridians]
    .reduce((sum, lines) => sum + lines.reduce((count, line) => count + line.length / 2, 0), 0);
  for (let i = 0; i < 2000; i++) { scene(true); scene(false); }
  const best = (lines: boolean) => Math.min(...[0, 1, 2].map(() => microseconds(5000, () => scene(lines))));
  record({ case: "attitude-scene", usWithLines: +best(true).toFixed(1), usWithoutLines: +best(false).toFixed(1), polylinePointsDrawn: projectedPoints });
});
