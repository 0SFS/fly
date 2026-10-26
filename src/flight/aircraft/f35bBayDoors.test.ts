import { readFileSync } from "node:fs";
import {
  LoadAssetContainerAsync, Matrix, Mesh, NullEngine, Quaternion, Ray, Scene, TransformNode, Vector3, VertexBuffer,
  type AbstractMesh,
} from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";
import { createAircraftModel } from "@0sfs/aircraft/createAircraftModel";
import { createStoreVisuals } from "@0sfs/stores/createStoreVisuals";
import { emptyLoad, storesForStation } from "@0sfs/stores/storeCatalog";
import { BAYS, STATIONS } from "@0sfs/stores/stationTable";

// The readiness wait is FOSS Earth's; this environment passes `whenReady` instead.
vi.mock("foss-earth/runtime", () => ({ whenMeshesReady: async () => {} }));

const load = (url: string, scene: Scene) =>
  LoadAssetContainerAsync(new Uint8Array(readFileSync(`public${url}`)), scene, { pluginExtension: ".glb" });

/** F-35B/docs/proposals/f35b-weapon-bay-door-geometry.md, "Numeric pose checks": left shells. */
const SPEC = {
  inboard: {
    closed: [[0.350000, -0.241070, -1.600000], [0.894000, 0.145470, 2.500000]],
    open: [[0.205273, -0.682232, -1.615423], [0.408193, 0.029455, 2.488813]],
  },
  outboard: {
    closed: [[0.906000, -0.227520, -1.600000], [1.420000, 0.215075, 2.500000]],
    open: [[1.402183, -0.587632, -1.613740], [1.646978, 0.198613, 2.494273]],
  },
} as const;

/** The spec's six-decimal rounding and Float32 vertex storage. */
const POSE_TOLERANCE_M = 5e-6;

async function loadedJet() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  // Off the origin and turned, so the doors are checked through the frame and not by coincidence.
  const parent = new TransformNode("aircraft", scene);
  parent.position.set(12, 3, -7);
  parent.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.7, 0.1, -0.2);
  const visuals = createStoreVisuals(scene, parent, { getWorldFromEcef: () => null, lifetimeSeconds: 15, maxDetachedStores: 2 });
  let waited: readonly AbstractMesh[] = [];
  const model = createAircraftModel(scene, parent, {
    aircraftId: "f-35b", lodId: "hd",
    loadContainer: load,
    whenReady: async meshes => { waited = meshes.filter(mesh => mesh.name.startsWith("bay-") && !mesh.isEnabled()); },
    prepareModel: airframe => visuals.fitAirframe(airframe),
  });
  await vi.waitFor(() => expect(model.getState().status).toBe("ready"), { timeout: 20000 });
  expect(model.getState().error).toBeNull();
  const toBody = Matrix.Invert(parent.computeWorldMatrix(true));
  return {
    engine, scene, parent, visuals, model, waited, toBody,
    teardown() { model.dispose(); visuals.dispose(); scene.dispose(); engine.dispose(); },
  };
}

function bodyBounds(meshes: readonly AbstractMesh[], toBody: Matrix): [number[], number[]] {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const v = new Vector3();
  for (const mesh of meshes) {
    const m = mesh.computeWorldMatrix(true).multiply(toBody);
    const p = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < p.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, m, v);
      [v.x, v.y, v.z].forEach((value, axis) => {
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      });
    }
  }
  return [min, max];
}

type BodyVector = readonly [number, number, number];
const UP: BodyVector = [0, 1, 0], DOWN: BodyVector = [0, -1, 0];

/** The nearest of `meshes` from a body-frame point along a body-frame direction: its name, how far, and the hit's height. */
function firstHit(
  meshes: readonly AbstractMesh[], parent: TransformNode, from: BodyVector, toward: BodyVector,
): { name: string; distance: number; y: number } | null {
  const world = parent.computeWorldMatrix(true);
  const ray = new Ray(
    Vector3.TransformCoordinates(new Vector3(...from), world), Vector3.TransformNormal(new Vector3(...toward), world).normalize(), 6,
  );
  let best: { name: string; distance: number } | null = null;
  for (const mesh of meshes) {
    // No frame is drawn here, so world bounds are brought up to date by hand.
    mesh.computeWorldMatrix(true);
    const hit = ray.intersectsMesh(mesh, false);
    if (hit.hit && (!best || hit.distance < best.distance)) best = { name: mesh.name, distance: hit.distance };
  }
  return best && { ...best, y: from[1] + toward[1] * best.distance };
}

/** The nearest mesh straight up from (x, z) under the belly, body frame. */
function firstAbove(meshes: readonly AbstractMesh[], parent: TransformNode, x: number, z: number): string | null {
  return firstHit(meshes, parent, [x, -2, z], UP)?.name ?? null;
}

describe("F-35B weapon-bay doors on the AF267 airframe", () => {
  it("hangs four leaves cut from the lower skin within the spec's pose bounds, closed and at 97 degrees", async () => {
    const jet = await loadedJet();
    try {
      const doorMeshes = jet.scene.meshes.filter(mesh => mesh.name.startsWith("bay-"));
      expect(doorMeshes.map(mesh => mesh.name).sort()).toEqual([
        "bay-0-inboard-door", "bay-0-inboard-door-inner", "bay-0-outboard-door", "bay-0-outboard-door-inner",
        "bay-1-inboard-door", "bay-1-inboard-door-inner", "bay-1-outboard-door", "bay-1-outboard-door-inner",
        "bay-lining",
      ]);
      // Compiled hidden with the airframe, never drawn before it.
      expect(new Set(jet.waited)).toEqual(new Set(doorMeshes));
      for (const mesh of doorMeshes) {
        expect(mesh.metadata).toEqual({ aircraftVisualOnly: true, castsShadows: false });
        expect(mesh.isPickable).toBe(false);
        expect(mesh.receiveShadows).toBe(false);
      }
      // The exterior is the livery it was cut from.
      const livery = jet.scene.getMeshByName("fuselage_primitive0")!;
      expect(jet.scene.getMeshByName("bay-1-inboard-door")!.material).toBe(livery.material);

      for (const [pose, u] of [["closed", 0], ["open", 1]] as const) {
        jet.visuals.poseDoors([u, u], [u, u]);
        for (const bay of BAYS) for (const leaf of bay.leaves) {
          const name = `bay-${bay.bay}-${leaf.leaf}-door`;
          const meshes = [jet.scene.getMeshByName(name)!, jet.scene.getMeshByName(`${name}-inner`)!];
          const [min, max] = bodyBounds(meshes, jet.toBody);
          const [specMin, specMax] = SPEC[leaf.leaf][pose];
          // Right shells mirror X: [xmin, xmax] becomes [-xmax, -xmin].
          const expectedMin = bay.bay === 1 ? specMin : [-specMax[0], specMin[1], specMin[2]];
          const expectedMax = bay.bay === 1 ? specMax : [-specMin[0], specMax[1], specMax[2]];
          for (let axis = 0; axis < 3; axis++) {
            expect(Math.abs(min[axis]! - expectedMin[axis]!), `${name} ${pose} min ${axis}`).toBeLessThan(POSE_TOLERANCE_M);
            expect(Math.abs(max[axis]! - expectedMax[axis]!), `${name} ${pose} max ${axis}`).toBeLessThan(POSE_TOLERANCE_M);
          }
        }
      }
    } finally { jet.teardown(); }
  }, 30000);

  it("shows the recessed lining behind an open bay, not the belly, and the leaf when shut", async () => {
    const jet = await loadedJet();
    try {
      const fuselage = jet.scene.meshes.filter(mesh => /^fuselage_primitive\d+$/.test(mesh.name));
      const lining = jet.scene.getMeshByName("bay-lining")!;
      const leaves = jet.scene.meshes.filter(mesh => /^bay-\d-(inboard|outboard)-door$/.test(mesh.name));
      for (const bay of BAYS) for (const leaf of bay.leaves) {
        const xs = leaf.outline.map(([x]) => Math.abs(x));
        const inner = Math.min(...xs) + 0.03, outer = Math.max(...xs) - 0.03, side = Math.sign(leaf.hingeAft.x);
        // Short of the serrated ends, which reach in to Z -1.52 and 2.20.
        for (let i = 0; i <= 4; i++) for (let k = 0; k <= 8; k++) {
          const x = side * (inner + (outer - inner) * i / 4), z = -1.45 + 3.6 * k / 8;
          jet.visuals.poseDoors([0, 0], [0, 0]);
          expect(firstAbove([...fuselage, lining, ...leaves], jet.parent, x, z)).toBe(`bay-${bay.bay}-${leaf.leaf}-door`);
          jet.visuals.poseDoors([1, 1], [1, 1]);
          expect(firstAbove([...fuselage, lining], jet.parent, x, z), `(${x}, ${z})`).toBe("bay-lining");
        }
      }
    } finally { jet.teardown(); }
  }, 30000);

  it("cuts only the fuselage, leaves the gear doors, and poses nothing while the doors rest", async () => {
    const jet = await loadedJet();
    const reference = new Scene(jet.engine);
    try {
      const fresh = await load("/aircraft/f-35b/F-35B_AF267-airframe.glb", reference);
      const changed = fresh.meshes.filter(mesh => {
        const loaded = jet.scene.getMeshByName(mesh.name);
        return loaded instanceof Mesh && loaded.getTotalIndices() !== mesh.getTotalIndices();
      }).map(mesh => mesh.name);
      expect(changed).toEqual(["fuselage_primitive0"]);
      for (const gearDoor of ["leftDoor", "rightDoor"]) {
        expect(jet.scene.meshes.some(mesh => mesh.name === gearDoor || mesh.name.startsWith(`${gearDoor}_primitive`))).toBe(true);
      }
      jet.visuals.poseDoors([0.4, 0.7], [1, 1]);
      const pose = vi.spyOn(Quaternion, "RotationAxisToRef");
      expect(jet.visuals.poseDoors([0.4, 0.7], [1, 1])).toBe(false);
      // A hair short of 97 degrees is still moving, so the pose cannot stop there.
      expect(jet.visuals.poseDoors([0.9995, 0.9995], [1, 1])).toBe(false);
      expect(jet.visuals.poseDoors([1, 1], [1, 1])).toBe(true);
      expect(pose).toHaveBeenCalledTimes(8);
      pose.mockClear();
      for (let frame = 0; frame < 10; frame++) jet.visuals.poseDoors([1, 1], [1, 1]);
      expect(pose).not.toHaveBeenCalled();
      pose.mockRestore();
      jet.model.dispose();
      expect(jet.scene.meshes.filter(mesh => mesh.name.startsWith("bay-"))).toEqual([]);
    } finally { reference.dispose(); jet.teardown(); }
  }, 30000);

  it("hangs each store clear of the airframe: under the wing or belly, or inside the bay with the leaves shut", async () => {
    const jet = await loadedJet();
    try {
      const airframe = jet.scene.meshes.filter(mesh => !mesh.name.startsWith("store-") && mesh.getTotalVertices() > 0);
      const lining = airframe.filter(mesh => mesh.name === "bay-lining");
      for (const station of STATIONS) for (const card of storesForStation(station.station)) {
        const label = `station ${station.station} ${card.key}`;
        const load = emptyLoad();
        load[station.station] = card.key;
        jet.visuals.sync({ load, bayCmd: [1, 1], bayPos: [1, 1], gunRounds: 0, masterArm: false });
        // A shut bay hides its stores; the rays still find them where they hang.
        jet.visuals.poseDoors([0, 0], [0, 0]);
        const store = jet.scene.meshes.filter(mesh => mesh.name.startsWith(`store-${station.station}-`));
        const [min, max] = bodyBounds(store, jet.toBody);
        const nearX = Math.min(Math.abs(min[0]!), Math.abs(max[0]!)), farX = Math.max(Math.abs(min[0]!), Math.abs(max[0]!));
        let above = Infinity, below = Infinity, wall = Infinity;
        const overhead = new Set<string>(), underfoot = new Set<string>(), bare: number[] = [];
        // Columns over the store's plan, tail (k = 0) to nose.
        for (let i = 0; i <= 4; i++) for (let k = 0; k <= 30; k++) {
          const x = min[0]! + 0.005 + (max[0]! - min[0]! - 0.01) * i / 4;
          const z = min[2]! + 0.005 + (max[2]! - min[2]! - 0.01) * k / 30;
          const top = firstHit(store, jet.parent, [x, 3, z], DOWN), bottom = firstHit(store, jet.parent, [x, -3, z], UP);
          if (!top || !bottom) continue;
          // From the store's far face, so a surface through the store reads as a negative gap.
          const up = firstHit(airframe, jet.parent, [x, bottom.y, z], UP);
          if (up) {
            above = Math.min(above, up.y - top.y);
            overhead.add(up.name);
          } else bare.push(k);
          const down = firstHit(airframe, jet.parent, [x, top.y, z], DOWN);
          if (down) {
            below = Math.min(below, bottom.y - down.y);
            underfoot.add(down.name);
          }
          if (station.bay !== null && i === 2) {
            // Across the bay at the store's mid-height, toward the jamb the station sits against:
            // the heavy station's inboard wall, the light station's outboard wall.
            const outward = station.place === "bay-light" ? 1 : -1;
            const across = firstHit(lining, jet.parent, [x, (top.y + bottom.y) / 2, z], [outward * Math.sign(x), 0, 0]);
            const jamb = across ? Math.abs(x) + outward * across.distance : null;
            wall = Math.min(wall, jamb === null ? -Infinity : outward > 0 ? jamb - farX : nearX - jamb);
          }
        }
        if (station.bay === null) {
          // Seated close under the skin at rest, not hung off a pylon.
          expect(above, label).toBeGreaterThan(0.015);
          expect(above, label).toBeLessThan(0.04);
          if (station.place === "centerline") {
            expect(bare, label).toEqual([]);
            for (const name of overhead) expect(name, label).toMatch(/^fuselage_primitive\d+$/);
          } else {
            // Noses run ahead of the leading edge; the aft 40 per cent, fins and all, is under the wing.
            expect(bare.filter(k => k <= 12), label).toEqual([]);
            for (const name of overhead) expect(name, label).not.toMatch(/^bay-/);
          }
        } else {
          expect(bare, label).toEqual([]);
          // The lining, or the inlet duct where the lining opens under it.
          for (const name of overhead) expect(name, label).toMatch(/^(bay-lining|F135_)/);
          for (const name of underfoot) expect(name, label).toMatch(new RegExp(`^bay-${station.bay}-(inboard|outboard)-door-inner$`));
          expect(above, label).toBeGreaterThan(0.02);
          expect(below, label).toBeGreaterThan(0.02);
          expect(wall, label).toBeGreaterThan(0.02);
        }
      }
    } finally { jet.teardown(); }
  }, 60000);
});
