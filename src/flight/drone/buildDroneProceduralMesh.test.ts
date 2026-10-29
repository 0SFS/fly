import { MeshBuilder, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountDroneProceduralMesh } from "./buildDroneProceduralMesh";

const FRAME = {
  rotors: [
    { position: "front-left", hubM: [-.08, -.07, .03], spin: 1 },
    { position: "front-right", hubM: [-.08, .09, .04], spin: -1 },
    { position: "rear-left", hubM: [.11, -.06, .02], spin: -1 },
    { position: "rear-right", hubM: [.12, .08, .01], spin: 1 },
  ],
  cgM: [.04, .01, .02],
  propellerRadiusM: .0597,
} as const;
const HUBS = [[.08, .01, .12], [-.08, .02, .12], [.07, 0, -.07], [-.07, -.01, -.08]];
let engine: NullEngine;
let scene: Scene;
let root: TransformNode;
beforeEach(() => {
  engine = new NullEngine(); scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  root = new TransformNode("model-root", scene);
});
afterEach(() => { scene.dispose(); engine.dispose(); });

function expectPosition(actual: Vector3, expected: readonly number[]): void {
  for (let axis = 0; axis < 3; axis++) expect(actual.asArray()[axis]).toBeCloseTo(expected[axis], 7);
}

describe("procedural drone mesh", () => {
  it("places motors and rotor pivots at the CG-relative hubs and joins each arm to the body centre", () => {
    mountDroneProceduralMesh(root, FRAME);
    for (let index = 0; index < HUBS.length; index++) {
      const motor = scene.getMeshByName(`drone-motor-${index}`)!;
      const pivot = scene.getTransformNodeByName(`drone-rotor-${index}`)!;
      expect(motor.parent).toBe(root);
      expect(pivot.parent).toBe(root);
      expectPosition(motor.position, HUBS[index]);
      expectPosition(pivot.position, HUBS[index]);
      const arm = scene.getMeshByName(`drone-arm-${index}`)!;
      const halfLength = arm.getBoundingInfo().boundingBox.extendSize.z;
      const world = arm.computeWorldMatrix(true);
      expectPosition(Vector3.TransformCoordinates(new Vector3(0, 0, -halfLength), world), [0, 0, 0]);
      expectPosition(Vector3.TransformCoordinates(new Vector3(0, 0, halfLength), world), HUBS[index]);
    }
    const frontLeft = scene.getMeshByName("drone-motor-0")!;
    expect(frontLeft.position.x).toBeGreaterThan(0);
    expect(frontLeft.position.z).toBeGreaterThan(0);
  });

  it.each([.0597, .0917])("uses the simulated propeller's diameter for radius %s", propellerRadiusM => {
    mountDroneProceduralMesh(root, { ...FRAME, propellerRadiusM });
    for (let index = 0; index < FRAME.rotors.length; index++) {
      const blades = scene.getMeshByName(`drone-blades-${index}`)!;
      expect(blades.parent).toBe(scene.getTransformNodeByName(`drone-rotor-${index}`));
      expect(blades.getBoundingInfo().boundingBox.extendSize.z * 2).toBeCloseTo(2 * propellerRadiusM, 7);
    }
  });

  it("disposes every owned mesh, pivot and material while preserving the model root and unrelated resources", () => {
    const other = MeshBuilder.CreateBox("other", {}, scene); other.parent = root;
    other.material = new StandardMaterial("other-material", scene);
    const meshes = scene.meshes.slice(), transforms = scene.transformNodes.slice(), materials = scene.materials.slice();
    const dispose = mountDroneProceduralMesh(root, FRAME);
    dispose(); dispose();
    expect(scene.meshes).toEqual(meshes);
    expect(scene.transformNodes).toEqual(transforms);
    expect(scene.materials).toEqual(materials);
    expect(root.isDisposed()).toBe(false);
  });
});
