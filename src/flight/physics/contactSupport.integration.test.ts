import { readFileSync } from "node:fs";
import { GEAR_CONTACT_FIELDS, JSBSimSdk, type GearContactReader } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import { C172_GROUND_CONTACTS, metresPerDegree } from "@0sfs/ground-contact/collisionGeometry";
import { createTerrainContact as createContact } from "@0sfs/ground-contact/terrainContact";
// The package does not export its WASM core yet; this is the installed copy's loader.
import { instantiateGroundContact } from "../../../node_modules/@0sfs/ground-contact/wasm/index.js";
import { createFixedStepPhysicsLoop } from "./fixedStepLoop";
import { acceptTerrainRelocations } from "../testing/acceptTerrainRelocations";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { LEGACY_FIXED_DT_120, LEGACY_PHYSICS_HZ_120 } from "./physicsRate";

const METERS_PER_FOOT = 0.3048;
const BASE_METERS = 300;
const LAT0 = 34, LON0 = -118.3;
const SCALE = metresPerDegree(LAT0);
const STANCE = getFdmProfile("cessna-172").stance;
const BODY_X = GEAR_CONTACT_FIELDS.indexOf("bodyXFt");
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });

const wasm = () => instantiateGroundContact(readFileSync(new URL("../../../node_modules/@0sfs/ground-contact/wasm/single/ground_contact.wasm", import.meta.url)));
/** The kernel the scenarios run on: the TypeScript reference, then the WASM one. A core per test. */
const active: { core?: Awaited<ReturnType<typeof wasm>> } = {};
const KERNELS = ["typescript", "single"] as const;
function useKernel(kernel: (typeof KERNELS)[number]) {
  beforeEach(async () => { active.core = kernel === "single" ? await wasm() : undefined; });
  afterEach(() => { active.core?.dispose(); active.core = undefined; });
}
function createTerrainContact(...[sdk, surface, stance]: Parameters<typeof createContact>) {
  const contact = createContact(sdk, surface, stance, { core: active.core });
  expect(contact.status().kernel).toBe(active.core ? "single" : "typescript");
  // Terrain corrections are answered Yes; these scenarios measure the move itself.
  return acceptTerrainRelocations(contact);
}

/** Surface height at metres north and east of the start. */
type Height = (north: number, east: number) => number;

async function setup(speedKts = 0, aboveGroundMeters = STANCE.staticMeters) {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  const manifest = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8")) as { files: string[] };
  for (const file of manifest.files) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
  sdk.loadModel("c172p");
  sdk.setDt(LEGACY_FIXED_DT_120);
  for (const [property, value] of Object.entries({ "ic/lat-geod-deg": LAT0, "ic/long-gc-deg": LON0,
    "ic/h-sl-ft": (BASE_METERS + aboveGroundMeters) / METERS_PER_FOOT,
    "ic/terrain-elevation-ft": BASE_METERS / METERS_PER_FOOT,
    "ic/psi-true-deg": 0, "ic/theta-deg": 2.48, "ic/vc-kts": speedKts, "ic/vd-fps": 0,
    "fcs/mixture-cmd-norm": 0, "fcs/throttle-cmd-norm": 0 })) sdk.setPropertyValue(property, value);
  expect(sdk.runIc()).toBe(true);
  return sdk;
}

/** The surface the aircraft sees, counting samples; `revision` is the world's version. */
function surfaceOf(height: Height) {
  const world = { revision: 0, samples: 0 };
  const surface: SurfaceQuery = { raycast: () => null, sample: (lat, lon) => {
    world.samples++;
    return { heightMeters: height((lat - LAT0) * SCALE.lat, (lon - LON0) * SCALE.lon),
      revision: world.revision, quality: 15 } as SurfaceHit;
  } };
  return { world, surface };
}

/**
 * How deep each contact unit is in its own ground and in the plane JSBSim was
 * given, in metres. Uses JSBSim's own contact locations and attitude, not the
 * geometry under test; a wheel's depth in the plane is its strut compression.
 */
function contactDepths(sdk: JSBSimSdk, reader: GearContactReader, height: Height) {
  const radians = Math.PI / 180;
  const roll = sdk.getPropertyValue("attitude/phi-deg") * radians;
  const pitch = sdk.getPropertyValue("attitude/theta-deg") * radians;
  const heading = sdk.getPropertyValue("attitude/psi-deg") * radians;
  const sr = Math.sin(roll), cr = Math.cos(roll), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sh = Math.sin(heading), ch = Math.cos(heading);
  const altitude = sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT;
  const plane = sdk.getPropertyValue("position/terrain-elevation-asl-ft") * METERS_PER_FOOT;
  const north0 = (sdk.getPropertyValue("position/lat-geod-deg") - LAT0) * SCALE.lat;
  const east0 = (sdk.getPropertyValue("position/long-gc-deg") - LON0) * SCALE.lon;
  const values = reader.read();
  const own: number[] = [], inPlane: number[] = [];
  for (let unit = 0; unit < reader.count; unit++) {
    // Uncompressed contact point from the centre of gravity: forward, right, down.
    const base = unit * reader.stride + BODY_X;
    const x = values[base] * METERS_PER_FOOT, y = values[base + 1] * METERS_PER_FOOT, z = values[base + 2] * METERS_PER_FOOT;
    const north = cp * ch * x + (sr * sp * ch - cr * sh) * y + (cr * sp * ch + sr * sh) * z;
    const east = cp * sh * x + (sr * sp * sh + cr * ch) * y + (cr * sp * sh - sr * ch) * z;
    const down = -sp * x + sr * cp * y + cr * cp * z;
    own.push(height(north0 + north, east0 + east) - (altitude - down));
    inPlane.push(plane - (altitude - down));
  }
  return { own, inPlane, plane, centre: height(north0, east0), north: north0, altitude };
}

const unitIndex = (name: string) => C172_GROUND_CONTACTS.findIndex(contact => contact.name === name);

describe.each(KERNELS)("contact support on sloped ground with real JSBSim on %s", kernel => {
  useKernel(kernel);

  it.each([
    { surface: "a 12% runway grade, nose uphill", unit: "NOSE", height: ((north: number) => BASE_METERS + 0.12 * north) as Height },
    // Steep enough to bring the tail down; on 20% the main wheels still carry the aircraft.
    { surface: "a 30% grade, tail uphill", unit: "TAIL", height: ((north: number) => BASE_METERS - 0.3 * north) as Height },
    { surface: "an embankment under the left wing", unit: "LEFT_TIP",
      height: ((_north: number, east: number) => BASE_METERS + Math.max(0, -east - 3)) as Height },
  ])("rests on $surface with no contact deeper in its own ground than the gear is compressed", async ({ unit, height }) => {
    const sdk = await setup();
    const { surface } = surfaceOf(height);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    const reader = sdk.createGearContactReader();
    for (let step = 0; step < 360; step++) loop.update(LEGACY_FIXED_DT_120, () => contact.update(false, false, true, true));
    expect(loop.getFault()).toBeNull();
    const depths = contactDepths(sdk, reader, height);
    const compressed = Math.max(...depths.inPlane);
    // Resting on its gear at an ordinary compression.
    expect(compressed).toBeGreaterThan(0.005);
    expect(compressed).toBeLessThan(0.15);
    // Each contact meets its own ground no deeper than the deepest strut is compressed...
    for (const own of depths.own) expect(own).toBeLessThan(compressed + 0.01);
    // ...and the contact over the highest ground is the one carrying the aircraft.
    expect(depths.own[unitIndex(unit)]).toBeGreaterThan(compressed - 0.01);
    // The ground under the centre alone would have left that contact this much deeper.
    expect(depths.plane - depths.centre).toBeGreaterThan(0.1);
  });

  it.each([
    { tiles: "raster", google: false },
    // Google's revision changes with every tile visibility change, without the heights changing.
    { tiles: "Google", google: true },
  ])("taxis up a 12% grade on $tiles tiles without a wheel entering its ground", async ({ google }) => {
    const height: Height = north => BASE_METERS + 0.12 * Math.max(0, north - 4);
    const sdk = await setup(15);
    const { world, surface } = surfaceOf(height);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    const reader = sdk.createGearContactReader();
    let calls = 0, mostSamples = 0;
    const update = () => {
      if (google) world.revision++;
      const before = world.samples;
      const result = contact.update(false, google, true, true);
      // The first call places the aircraft and samples every contact.
      if (calls++ > 0) mostSamples = Math.max(mostSamples, world.samples - before);
      return result;
    };
    const start = contactDepths(sdk, reader, height);
    let deepest = Number.NEGATIVE_INFINITY, aboveCentre = 0;
    for (let step = 0; step < 360; step++) {
      loop.update(LEGACY_FIXED_DT_120, update);
      const depths = contactDepths(sdk, reader, height);
      deepest = Math.max(deepest, Math.max(...depths.own) - Math.max(...depths.inPlane));
      aboveCentre = Math.max(aboveCentre, depths.plane - depths.centre);
    }
    expect(loop.getFault()).toBeNull();
    const end = contactDepths(sdk, reader, height);
    expect(end.north - start.north).toBeGreaterThan(8);
    expect(end.altitude - start.altitude).toBeGreaterThan(0.5);
    // A contact's ground is filtered over 0.29 m of travel, about 3.5 cm behind on this grade.
    expect(deepest).toBeLessThan(0.05);
    // The nose wheel climbed ahead of the centre: the centre's ground was this far too low.
    expect(aboveCentre).toBeGreaterThan(0.1);
    // The centre, the refinement anchor under it, and two contacts at most.
    if (google) expect(mostSamples).toBeLessThanOrEqual(4);
  });

  it("does not stand on a roof over a wingtip", async () => {
    const height: Height = (_north, east) => BASE_METERS + (east < -5 ? 10 : 0);
    const sdk = await setup();
    const { surface } = surfaceOf(height);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    for (let step = 0; step < 240; step++) loop.update(LEGACY_FIXED_DT_120, () => contact.update(false, false, true, true));
    expect(loop.getFault()).toBeNull();
    // The left wingtip is under the roof; the wheels stay on the ground.
    const depths = contactDepths(sdk, sdk.createGearContactReader(), height);
    expect(depths.own[unitIndex("LEFT_TIP")]).toBeGreaterThan(5);
    expect(depths.plane).toBeCloseTo(BASE_METERS, 6);
  });

  it.each([
    { tiles: "raster", google: false },
    { tiles: "Google", google: true },
  ])("does not climb onto a roof a $tiles refinement puts over a wingtip", async ({ google }) => {
    let roof = false;
    const height: Height = (_north, east) => BASE_METERS + (roof && east < -5 ? 10 : 0);
    const sdk = await setup();
    const { world, surface } = surfaceOf(height);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    const step = () => loop.update(LEGACY_FIXED_DT_120, () => contact.update(false, google, true, true));
    for (let count = 0; count < 240; count++) step();
    const settled = sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT;
    // The world refines under the wingtip only; the ground under the centre is unchanged.
    roof = true;
    world.revision++;
    for (let count = 0; count < 240; count++) step();
    expect(loop.getFault()).toBeNull();
    const depths = contactDepths(sdk, sdk.createGearContactReader(), height);
    expect(depths.own[unitIndex("LEFT_TIP")]).toBeGreaterThan(5);
    expect(depths.plane).toBeCloseTo(BASE_METERS, 6);
    expect(Math.abs(depths.altitude - settled)).toBeLessThan(0.01);
  });

  it("follows a refinement that brings a roof down within reach of a wingtip, rather than faulting", async () => {
    // The tip rests about 2.1 m above the ground; the roof comes down from 10 m to 2.7 m.
    let roof = BASE_METERS + 10;
    const height: Height = (_north, east) => east < -5 ? roof : BASE_METERS;
    const sdk = await setup();
    const { world, surface } = surfaceOf(height);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    const reader = sdk.createGearContactReader();
    const step = () => loop.update(LEGACY_FIXED_DT_120, () => contact.update(false, false, true, true));
    for (let count = 0; count < 240; count++) step();
    expect(contactDepths(sdk, reader, height).plane).toBeCloseTo(BASE_METERS, 6);
    roof = BASE_METERS + 2.7;
    world.revision++;
    for (let count = 0; count < 240; count++) step();
    expect(loop.getFault()).toBeNull();
    // Each contact meets its own ground no deeper than the deepest is compressed in the plane.
    const depths = contactDepths(sdk, reader, height);
    for (const own of depths.own) expect(own).toBeLessThan(Math.max(...depths.inPlane) + 0.01);
    expect(depths.plane).toBeGreaterThan(BASE_METERS + 0.3);
  });

  it("samples only the centre while the contacts are out of reach", async () => {
    const sdk = await setup(100, 100);
    const { world, surface } = surfaceOf(() => BASE_METERS);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    let mostSamples = 0;
    for (let step = 0; step < 120; step++) {
      loop.update(LEGACY_FIXED_DT_120, () => {
        const before = world.samples;
        const result = contact.update(false, false, true, true);
        mostSamples = Math.max(mostSamples, world.samples - before);
        return result;
      });
    }
    expect(loop.getFault()).toBeNull();
    expect(mostSamples).toBe(1);
  });

  it.each([
    // Ahead of the centre and the main wheels: the nose wheel, which carries the aircraft.
    { under: "the nose wheel", google: false, bumped: (north: number) => north > 0.8 },
    { under: "the nose wheel", google: true, bumped: (north: number) => north > 0.8 },
    // Behind the centre: the main wheels, which a lazy check must not leave for last forever.
    { under: "the main wheels", google: false, bumped: (north: number) => north < -0.2 },
    { under: "the main wheels", google: true, bumped: (north: number) => north < -0.2 },
  ])("follows a refinement under $under alone (Google tiles: $google)", async ({ google, bumped }) => {
    let bump = 0;
    const height: Height = north => BASE_METERS + (bumped(north) ? bump : 0);
    const sdk = await setup();
    const { world, surface } = surfaceOf(height);
    const contact = createTerrainContact(sdk, surface, STANCE);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    const reader = sdk.createGearContactReader();
    let moves = 0;
    const update = () => {
      if (google) world.revision++;
      const result = contact.update(false, google, true, true);
      if (result === "reset") moves++;
      return result;
    };
    for (let step = 0; step < 600; step++) loop.update(LEGACY_FIXED_DT_120, update);
    const altitude = sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT;
    const settled = [0, 1, 2].map(unit => sdk.getPropertyValue(`gear/unit[${unit}]/compression-ft`) * METERS_PER_FOOT);
    const before = Math.max(...contactDepths(sdk, reader, height).own);
    bump = 0.2;
    // The plane rises until no contact is deeper in its own ground than before.
    const rise = Math.max(...contactDepths(sdk, reader, height).own) - before;
    expect(rise).toBeGreaterThan(0.15);
    const reinitialised = vi.spyOn(sdk, "resetToInitialConditions"), ranIc = vi.spyOn(sdk, "runIc");
    world.revision++;
    // The centre's ground did not change: raster confirms every contact at
    // once, Google one contact at a time, every contact within nine turns of
    // 31 steps. Each main wheel moves the plane as it is confirmed.
    const plane = () => sdk.getPropertyValue("position/terrain-elevation-asl-ft") * METERS_PER_FOOT;
    let steps = 0;
    while (plane() < BASE_METERS + rise - 0.0005 && steps < 9 * 31) { loop.update(LEGACY_FIXED_DT_120, update); steps++; }
    expect(moves).toBeGreaterThanOrEqual(1);
    if (!google) expect([moves, steps]).toEqual([1, 1]);
    expect(sdk.getPropertyValue("position/terrain-elevation-asl-ft") * METERS_PER_FOOT).toBeCloseTo(BASE_METERS + rise, 3);
    expect(sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT - altitude).toBeCloseTo(rise, 3);
    const compressed = [0, 1, 2].map(unit => sdk.getPropertyValue(`gear/unit[${unit}]/compression-ft`) * METERS_PER_FOOT);
    for (let unit = 0; unit < 3; unit++) expect(compressed[unit]).toBeCloseTo(settled[unit], 3);
    expect(reinitialised).not.toHaveBeenCalled();
    expect(ranIc).not.toHaveBeenCalled();
    expect(loop.getFault()).toBeNull();
  });
});

describe.each(KERNELS)("a surface refinement under a settled aircraft with real JSBSim on %s", kernel => {
  useKernel(kernel);
  const compressions = (sdk: JSBSimSdk) => [0, 1, 2].map(unit => sdk.getPropertyValue(`gear/unit[${unit}]/compression-ft`) * METERS_PER_FOOT);

  it.each([
    { delta: 0.3, google: false, speedKts: 0 }, { delta: -0.3, google: false, speedKts: 0 },
    { delta: 1, google: false, speedKts: 0 }, { delta: 0.3, google: true, speedKts: 0 },
    { delta: -1, google: true, speedKts: 0 },
    { delta: 0.3, google: false, speedKts: 15 }, { delta: -0.5, google: true, speedKts: 15 },
  ])("keeps the gear compressed through a $delta m refinement at $speedKts kt (Google tiles: $google)", async ({ delta, google, speedKts }) => {
    // The same aircraft twice; only one sees the world refine.
    const runs = await Promise.all([0, 1].map(async () => {
      let offset = 0;
      const sdk = await setup(speedKts);
      const { world, surface } = surfaceOf(() => BASE_METERS + offset);
      const contact = createTerrainContact(sdk, surface, STANCE);
      const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
      const step = () => loop.update(LEGACY_FIXED_DT_120, () => contact.update(false, google, true, true));
      const refine = () => { offset += delta; world.revision++; };
      return { sdk, loop, step, refine };
    }));
    const [refined, reference] = runs;
    for (let step = 0; step < 600; step++) { refined.step(); reference.step(); }
    const settled = compressions(refined.sdk);
    for (const wheel of settled) expect(wheel).toBeGreaterThan(0.005);
    const above = refined.sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT - BASE_METERS;
    const reinitialised = vi.spyOn(refined.sdk, "resetToInitialConditions"), ranIc = vi.spyOn(refined.sdk, "runIc");
    refined.refine();
    let worst = 0;
    for (let step = 0; step < 240; step++) {
      refined.step(); reference.step();
      const moved = compressions(refined.sdk), unmoved = compressions(reference.sdk);
      // Never dropped from the uncompressed stance: the same compression, step for step.
      for (let wheel = 0; wheel < 3; wheel++) worst = Math.max(worst, Math.abs(moved[wheel] - unmoved[wheel]));
      if (step === 0) {
        expect(refined.sdk.getPropertyValue("position/terrain-elevation-asl-ft") * METERS_PER_FOOT).toBeCloseTo(BASE_METERS + delta, 6);
        expect(refined.sdk.getPropertyValue("position/h-sl-ft") * METERS_PER_FOOT - BASE_METERS - delta).toBeCloseTo(above, 3);
      }
    }
    expect(worst).toBeLessThan(0.0001);
    expect(reinitialised).not.toHaveBeenCalled();
    expect(ranIc).not.toHaveBeenCalled();
    expect(refined.loop.getFault()).toBeNull();
    expect(reference.loop.getFault()).toBeNull();
  });
});

describe("WASM contact support with real JSBSim", () => {
  it("flies the reference's flight up a grade through refinements, on JSBSim's own property batches", async () => {
    const height: Height = (north, east) => BASE_METERS + 0.12 * Math.max(0, north - 4) + (east < -5 ? 0.4 : 0);
    const runs = await Promise.all([undefined, await wasm()].map(async core => {
      const sdk = await setup(15);
      const { world, surface } = surfaceOf(height);
      const contact = acceptTerrainRelocations(createContact(sdk, surface, STANCE, { core }));
      const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
      return { sdk, world, contact, loop, core };
    }));
    const [reference, wasmRun] = runs;
    let worst = 0;
    for (let step = 0; step < 480; step++) {
      for (const run of runs) {
        // Google's revision changes every step; a reset half way hands over again.
        run.world.revision++;
        if (step === 240) run.contact.reset();
        run.loop.update(LEGACY_FIXED_DT_120, () => run.contact.update(false, true, true, true));
      }
      for (const property of ["position/terrain-elevation-asl-ft", "position/h-sl-ft", "position/lat-geod-deg"]) {
        worst = Math.max(worst, Math.abs(wasmRun.sdk.getPropertyValue(property) - reference.sdk.getPropertyValue(property)));
      }
    }
    expect(wasmRun.contact.status()).toEqual({ requestedKernel: "single", kernel: "single", fallbackReason: null });
    expect(reference.loop.getFault()).toBeNull();
    expect(wasmRun.loop.getFault()).toBeNull();
    // The aircraft climbed the grade on both.
    expect(wasmRun.sdk.getPropertyValue("position/terrain-elevation-asl-ft") * METERS_PER_FOOT).toBeGreaterThan(BASE_METERS + 0.5);
    expect(worst).toBeLessThan(1e-9);
    wasmRun.contact.dispose();
    wasmRun.core!.dispose();
  });
});
