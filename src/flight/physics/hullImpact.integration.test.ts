import { readFileSync } from "node:fs";
import { GEAR_CONTACT_FIELDS, JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it } from "vitest";
import { DEG_TO_RAD, geodeticToEcef } from "foss-earth/cameraMath";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import { bodyToLocalRotation, type BodyCollisionProbe } from "@0sfs/ground-contact/collisionGeometry";
import { groundContactUnits } from "@0sfs/ground-contact/groundContactClearance";
import { createVisibleMeshCollision } from "@0sfs/ground-contact/visibleMeshCollision";
import { bootstrapAircraft } from "../jsbsim/bootstrapC172";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { LEGACY_PHYSICS_HZ_120 } from "./physicsRate";

const METERS_PER_FOOT = 0.3048;
const LAT0 = 34, LON0 = -118.3;
/** The visible surface: a level plane at this ellipsoidal height. */
const SURFACE_METERS = 300;
/** The collision's default restitution. */
const RESTITUTION = 0.25;
const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
const instances: JSBSimSdk[] = [];
const releases: Array<() => void> = [];
afterEach(() => {
  // Native batches and readers before their SDK.
  for (const release of releases.splice(0)) release();
  for (const sdk of instances.splice(0)) sdk.destroy();
});

type Vector = { x: number; y: number; z: number };
const lat = LAT0 * DEG_TO_RAD, lon = LON0 * DEG_TO_RAD;
const UP: Vector = { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
const ORIGIN = geodeticToEcef(lat, lon, SURFACE_METERS);
const height = (at: Vector) => (at.x - ORIGIN.x) * UP.x + (at.y - ORIGIN.y) * UP.y + (at.z - ORIGIN.z) * UP.z;

/** The plane, struck from either side as Babylon picking is. */
const plane: SurfaceQuery = {
  sample: () => ({ heightMeters: SURFACE_METERS }) as SurfaceHit,
  raycast: (from, movement, distance) => {
    const speed = Math.hypot(movement.x, movement.y, movement.z);
    const along = (movement.x * UP.x + movement.y * UP.y + movement.z * UP.z) / speed;
    if (Math.abs(along) < 1e-12) return null;
    const t = -height(from) / along;
    if (t < 0 || t > distance) return null;
    const point = { x: from.x + movement.x / speed * t, y: from.y + movement.y / speed * t, z: from.z + movement.z / speed * t };
    return { point, normal: UP, distanceMeters: t, heightMeters: SURFACE_METERS } as SurfaceHit;
  },
};

async function boot(id: AircraftId) {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  const profile = getFdmProfile(id);
  for (const file of resolveAircraftDataFiles(manifest, profile.dataPackage ?? id)) {
    sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  }
  await bootstrapAircraft(sdk, id, LEGACY_PHYSICS_HZ_120, { engineRunning: false, airspeedKts: 0, latDeg: LAT0, lonDeg: LON0,
    altFt: (SURFACE_METERS + 50) / METERS_PER_FOOT, headingDeg: 0, throttleNorm: 0 });
  return { sdk, probes: profile.bodyCollisionProbes };
}

const read = (sdk: JSBSimSdk, path: string) => sdk.getPropertyValue(path);

/** A probe's point from the live CG in body feet: forward, right, down; `swept` adds its inset. */
function lever(sdk: JSBSimSdk, probe: BodyCollisionProbe, swept: boolean): number[] {
  return [(read(sdk, "inertia/cg-x-in") - probe.xIn) / 12, (probe.yIn - read(sdk, "inertia/cg-y-in")) / 12,
    (read(sdk, "inertia/cg-z-in") - probe.zIn - (swept ? probe.insetIn : 0)) / 12];
}

/** JSBSim's body-to-NED rotation, row-major. */
function rotation(sdk: JSBSimSdk): Float64Array {
  return bodyToLocalRotation(read(sdk, "attitude/phi-deg") * DEG_TO_RAD,
    read(sdk, "attitude/theta-deg") * DEG_TO_RAD, read(sdk, "attitude/psi-deg") * DEG_TO_RAD);
}

/** A probe's height above the plane, in metres. Near the origin the local frame is the plane's. */
function probeHeight(sdk: JSBSimSdk, probe: BodyCollisionProbe, swept: boolean): number {
  const m = rotation(sdk), r = lever(sdk, probe, swept);
  const down = (m[6] * r[0] + m[7] * r[1] + m[8] * r[2]) * METERS_PER_FOOT;
  const cg = geodeticToEcef(read(sdk, "position/lat-geod-deg") * DEG_TO_RAD,
    read(sdk, "position/long-gc-deg") * DEG_TO_RAD, read(sdk, "position/h-sl-ft") * METERS_PER_FOOT);
  return height(cg) - down;
}

/** The rigid-body state, and the struck point's velocity, from JSBSim as it is now. */
function observe(sdk: JSBSimSdk, probe: BodyCollisionProbe) {
  const rates = ["p", "q", "r"].map(axis => read(sdk, `velocities/${axis}-rad_sec`));
  const ned = ["north", "east", "down"].map(axis => read(sdk, `velocities/v-${axis}-fps`));
  const mass = read(sdk, "inertia/mass-slugs");
  // The native tensor from its properties' signs: -J12, +J13 and -J23.
  const ixy = -read(sdk, "inertia/ixy-slugs_ft2"), ixz = read(sdk, "inertia/ixz-slugs_ft2"), iyz = -read(sdk, "inertia/iyz-slugs_ft2");
  const inertia = [[read(sdk, "inertia/ixx-slugs_ft2"), ixy, ixz], [ixy, read(sdk, "inertia/iyy-slugs_ft2"), iyz],
    [ixz, iyz, read(sdk, "inertia/izz-slugs_ft2")]];
  const spin = rates.reduce((sum, rate, row) => sum + rate * inertia[row].reduce((dot, value, column) => dot + value * rates[column], 0), 0);
  const kinetic = 0.5 * mass * ned.reduce((sum, value) => sum + value * value, 0) + 0.5 * spin;
  // The point's velocity: v + ω × r, turned into the local frame.
  const [p, q, r] = rates, arm = lever(sdk, probe, true), m = rotation(sdk);
  const turn = [q * arm[2] - r * arm[1], r * arm[0] - p * arm[2], p * arm[1] - q * arm[0]];
  const point = [0, 1, 2].map(row => ned[row] + m[row * 3] * turn[0] + m[row * 3 + 1] * turn[1] + m[row * 3 + 2] * turn[2]);
  return {
    rates, kinetic,
    /** Up is positive: the plane's normal. */
    pointNormal: -point[2], pointSlide: Math.hypot(point[0], point[1]), groundSpeed: Math.hypot(ned[0], ned[1]),
  };
}

interface Pose { rollDeg: number; pitchDeg: number; northFps: number; downFps: number }

/**
 * Starts the aircraft in `pose` with `struck`'s swept point a few centimetres
 * above the plane and every other probe higher, then steps until the plane is
 * struck. JSBSim's own terrain is far below: only the hull probes meet the plane.
 */
async function strike(id: AircraftId, struck: string, pose: Pose, friction?: number) {
  const { sdk, probes } = await boot(id);
  const probe = probes.find(candidate => candidate.name === struck)!;
  const initial = (altitudeMeters: number) => {
    for (const [property, value] of Object.entries({
      "ic/lat-geod-deg": LAT0, "ic/long-gc-deg": LON0, "ic/h-sl-ft": altitudeMeters / METERS_PER_FOOT,
      "ic/terrain-elevation-ft": (SURFACE_METERS - 1000) / METERS_PER_FOOT,
      "ic/phi-deg": pose.rollDeg, "ic/theta-deg": pose.pitchDeg, "ic/psi-true-deg": 0,
      "ic/vn-fps": pose.northFps, "ic/ve-fps": 0, "ic/vd-fps": pose.downFps,
      "ic/p-rad_sec": 0, "ic/q-rad_sec": 0, "ic/r-rad_sec": 0,
    })) sdk.setPropertyValue(property, value);
    expect(sdk.runIc()).toBe(true);
  };
  initial(SURFACE_METERS + 10);
  initial(SURFACE_METERS + 10 - probeHeight(sdk, probe, true) + 0.04);
  for (const other of probes) if (other !== probe) expect(probeHeight(sdk, other, true)).toBeGreaterThan(probeHeight(sdk, probe, true) + 0.1);
  const collision = createVisibleMeshCollision(sdk, plane, { bodyProbes: probes, friction });
  releases.push(() => collision.dispose());
  collision.update();
  for (let step = 0; step < 60; step++) {
    expect(sdk.run()).toBe(true);
    const crossed = probes.filter(candidate => probeHeight(sdk, candidate, true) < 0).map(candidate => candidate.name);
    const before = observe(sdk, probe);
    if (collision.update()) {
      expect(crossed).toEqual([struck]);
      // Moved out along the normal until the hull point, not the swept point inside it, clears the surface.
      expect(probeHeight(sdk, probe, false)).toBeCloseTo(0.01, 3);
      return { sdk, probes, probe, collision, before, after: observe(sdk, probe) };
    }
    expect(crossed).toEqual([]);
  }
  throw new Error(`${id} never struck the plane with its ${struck}`);
}

/** Each probe's swept point stays on or above the plane, and its hull point no deeper than its inset. */
function expectClear(sdk: JSBSimSdk, probes: readonly BodyCollisionProbe[]) {
  for (const probe of probes) {
    expect(probeHeight(sdk, probe, true)).toBeGreaterThan(-0.002);
    expect(probeHeight(sdk, probe, false)).toBeGreaterThan(-probe.insetIn * 0.0254 - 0.002);
  }
}

describe("hull impacts against a visible surface with real JSBSim", () => {
  const WINGTIP: Pose = { rollDeg: 30, pitchDeg: 0, northFps: 80, downFps: 6 };

  it.each([
    // An upward hit on the lowered right tip rolls the aircraft left; drag there yaws the nose right.
    { id: "cessna-172", struck: "right-wing", pose: WINGTIP, signs: { p: -1, r: 1 } },
    // An upward hit ahead of the CG pitches the nose up; behind it, down.
    { id: "f-35b", struck: "nose", pose: { rollDeg: 0, pitchDeg: -10, northFps: 150, downFps: 20 }, signs: { q: 1 } },
    { id: "cirrus-vision-jet", struck: "tail", pose: { rollDeg: 0, pitchDeg: 15, northFps: 100, downFps: 8 }, signs: { q: -1 } },
  ] as const)("turns a $id $struck strike into rates of the physical sign, without adding energy", async ({ id, struck, pose, signs }) => {
    const { before, after } = await strike(id, struck, pose);
    const change = after.rates.map((rate, axis) => rate - before.rates[axis]);
    (["p", "q", "r"] as const).forEach((axis, index) => {
      const sign = (signs as Partial<Record<"p" | "q" | "r", number>>)[axis];
      if (sign) expect(Math.sign(change[index])).toBe(sign);
    });
    // The struck point now leaves the surface, and nothing gained energy.
    expect(before.pointNormal).toBeLessThan(0);
    expect(after.pointNormal).toBeGreaterThan(0);
    expect(after.kinetic).toBeLessThan(before.kinetic);
    if (id === "f-35b") {
      // A hit in the plane of symmetry turns the aircraft about its pitch axis only.
      expect(Math.abs(change[0])).toBeLessThan(1e-6 * Math.abs(change[1]) + 1e-9);
      expect(Math.abs(change[2])).toBeLessThan(1e-3 * Math.abs(change[1]) + 1e-9);
    }
  });

  it("returns the struck point at its restitution, and friction slows the slide a frictionless hit keeps", async () => {
    const frictionless = await strike("cessna-172", "right-wing", WINGTIP, 0);
    // Newton's restitution at the point, through RunIC's restored rates and velocities.
    expect(frictionless.after.pointNormal).toBeCloseTo(-RESTITUTION * frictionless.before.pointNormal, 2);
    expect(frictionless.after.pointSlide).toBeCloseTo(frictionless.before.pointSlide, 0);
    const rubbing = await strike("cessna-172", "right-wing", WINGTIP);
    expect(rubbing.before.pointSlide).toBeCloseTo(frictionless.before.pointSlide, 6);
    expect(rubbing.after.pointSlide).toBeLessThan(frictionless.after.pointSlide - 1);
    expect(rubbing.after.groundSpeed).toBeLessThan(frictionless.after.groundSpeed);
    expect(rubbing.after.groundSpeed).toBeLessThan(rubbing.before.groundSpeed);
    // The drag at the right tip yaws the nose right.
    expect(rubbing.after.rates[2] - rubbing.before.rates[2]).toBeGreaterThan(frictionless.after.rates[2] - frictionless.before.rates[2]);
    expect(rubbing.after.kinetic).toBeLessThan(frictionless.after.kinetic);
  });

  it.each([
    { id: "cessna-172", struck: "right-wing", pose: WINGTIP },
    { id: "f-35b", struck: "nose", pose: { rollDeg: 0, pitchDeg: -10, northFps: 150, downFps: 20 } },
  ] as const)("keeps every $id probe out of the surface for a second of scraping after the hit", async ({ id, struck, pose }) => {
    const { sdk, probes, collision } = await strike(id, struck, pose);
    expectClear(sdk, probes);
    let impacts = 0;
    for (let step = 0; step < LEGACY_PHYSICS_HZ_120; step++) {
      expect(sdk.run()).toBe(true);
      if (collision.update()) impacts++;
      expectClear(sdk, probes);
    }
    expect(impacts).toBeGreaterThan(0);
  });
});

describe("hull STRUCTURE contacts with real JSBSim", () => {
  it.each(["cessna-172", "cirrus-vision-jet", "f-35b"] as const)("meet level ground before any inset %s probe, at any attitude", async id => {
    const { sdk, probes } = await boot(id);
    const cg = ["x", "y", "z"].map(axis => read(sdk, `inertia/cg-${axis}-in`));
    // STRUCTURE units only: with the gear up they are all that meets the ground.
    const contacts = groundContactUnits(sdk).filter(({ prefix }) => prefix.startsWith("contact/"))
      .map(({ prefix }) => ["x", "y", "z"].map(axis => read(sdk, `${prefix}${axis}-position`)));
    expect(contacts.length).toBeGreaterThanOrEqual(5);
    const inset = probes.filter(probe => probe.insetIn > 0);
    expect(inset.length).toBeGreaterThan(2);
    for (let rollDeg = -90; rollDeg <= 90; rollDeg += 15) for (let pitchDeg = -30; pitchDeg <= 30; pitchDeg += 10) {
      const m = bodyToLocalRotation(rollDeg * DEG_TO_RAD, pitchDeg * DEG_TO_RAD, 0);
      // Depth below the CG of a structural point.
      const depth = ([x, y, z]: readonly number[]) => m[6] * (cg[0] - x) + m[7] * (y - cg[1]) + m[8] * (cg[2] - z);
      const lowestContact = Math.max(...contacts.map(depth));
      for (const probe of inset) expect(depth([probe.xIn, probe.yIn, probe.zIn])).toBeLessThanOrEqual(lowestContact + 1e-9);
    }
  });

  it.each([
    { id: "cirrus-vision-jet", maxCompressionIn: 1.2 },
    { id: "f-35b", maxCompressionIn: 1.5 },
  ] as const)("rest $id gear-up on its belly, carrying its weight at a small compression", async ({ id, maxCompressionIn }) => {
    const { sdk } = await boot(id);
    const profile = getFdmProfile(id);
    for (const [property, value] of Object.entries({
      "ic/lat-geod-deg": LAT0, "ic/long-gc-deg": LON0, "ic/h-sl-ft": (SURFACE_METERS + profile.stance.staticMeters + 0.3) / METERS_PER_FOOT,
      "ic/terrain-elevation-ft": SURFACE_METERS / METERS_PER_FOOT, "ic/vc-kts": 0, "ic/phi-deg": 10,
      "ic/theta-deg": profile.stance.staticPitchRad / DEG_TO_RAD, "ic/psi-true-deg": 0,
      "gear/gear-cmd-norm": 0, "gear/gear-pos-norm": 0,
    })) sdk.setPropertyValue(property, value);
    expect(sdk.runIc()).toBe(true);
    for (let step = 0; step < 15 * LEGACY_PHYSICS_HZ_120; step++) expect(sdk.run()).toBe(true);
    expect(Math.abs(read(sdk, "velocities/v-down-fps"))).toBeLessThan(0.05);
    for (const axis of ["p", "q", "r"]) expect(Math.abs(read(sdk, `velocities/${axis}-rad_sec`))).toBeLessThan(0.01);
    expect(read(sdk, "position/h-sl-ft") * METERS_PER_FOOT - SURFACE_METERS).toBeGreaterThan(0.1);
    const reader = sdk.createGearContactReader();
    releases.push(() => reader.dispose());
    const values = reader.read(new Float64Array(reader.count * reader.stride));
    const field = (unit: number, name: (typeof GEAR_CONTACT_FIELDS)[number]) => values[unit * reader.stride + GEAR_CONTACT_FIELDS.indexOf(name)];
    let load = 0, touching = 0;
    for (let unit = 0; unit < reader.count; unit++) {
      if (!field(unit, "wow")) continue;
      // Only hull contacts touch, none deeper than an ordinary scrape.
      expect(field(unit, "isBogey")).toBe(0);
      expect(field(unit, "compressionFt") * 12).toBeLessThan(maxCompressionIn);
      load -= field(unit, "strutForceLbs");
      touching++;
    }
    expect(touching).toBeGreaterThanOrEqual(3);
    expect(load / (read(sdk, "inertia/mass-slugs") * 32.174)).toBeCloseTo(1, 1);
  });
});
