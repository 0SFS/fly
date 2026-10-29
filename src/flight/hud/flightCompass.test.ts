import { Matrix, NullEngine, Quaternion, Scene, TransformNode, UniversalCamera, Vector3 } from "@babylonjs/core";
import { expect, it, vi } from "vitest";
import { createFloatingOrigin } from "../bridge/floatingOrigin";
import { createFlightCompass } from "./flightCompass";

const compass = vi.hoisted(() => ({ update: vi.fn(), destroy: vi.fn() }));
vi.mock("foss-earth/runtime", () => ({
  createCanvasTextureDevicePorts: vi.fn(() => ({})),
  createOrbitCompass: vi.fn(() => compass),
}));
import { createOrbitCompass } from "foss-earth/runtime";

it("places the tour's compass from the active camera through a moving flight frame", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const origin = createFloatingOrigin(scene, new TransformNode("world", scene));
  const view = new UniversalCamera("view", new Vector3(10, 20, 30), scene);
  view.maxZ = 250_000;
  scene.activeCamera = view;
  const handle = createFlightCompass(scene, origin, {} as Document, vi.fn());
  try {
    expect(vi.mocked(createOrbitCompass).mock.calls.at(-1)![1].horizonMaxDistanceMeters).toBe(200_000);
    handle.update(view);
    expect(compass.update).toHaveBeenLastCalledWith(null, 0, null);
    const state = { latDeg: 0, lonDeg: 0, altMeters: 1000, headingRad: 0, pitchRad: 0, rollRad: 0 };
    origin.apply(state as Parameters<typeof origin.apply>[0]);
    handle.update(view);
    // At 0°N 0°E: local east = ECEF +y, up = +x, south = -z.
    expect(compass.update).toHaveBeenLastCalledWith(null, 0, { x: 6_379_157, y: 10, z: -30 });
    const toScene = vi.mocked(createOrbitCompass).mock.calls.at(-1)![1].ecefToScene!;
    expect(toScene({ x: 6_379_157, y: 10, z: -30 })).toEqual({ x: 10, y: 20, z: 30 });
    origin.apply({ ...state, lonDeg: 90 } as Parameters<typeof origin.apply>[0]);
    handle.update(view);
    const eye = compass.update.mock.calls.at(-1)![2];
    expect(eye.x).toBeCloseTo(-10, 6);
    expect(eye.y).toBeCloseTo(6_379_157, 6);
    expect(eye.z).toBeCloseTo(-30, 6);
    // Cockpit/chase offsets rotate with the aircraft even while physics is paused.
    view.parent = origin.aircraftRoot;
    origin.aircraftRoot.rotationQuaternion = Quaternion.Identity();
    origin.aircraftRoot.position.set(5, 6, 7);
    handle.update(view);
    const movedEye = compass.update.mock.calls.at(-1)![2];
    expect(movedEye.x).toBeCloseTo(-15, 6);
    expect(movedEye.y).toBeCloseTo(6_379_163, 6);
    expect(movedEye.z).toBeCloseTo(-37, 6);
    origin.aircraftRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI / 2, 0);
    handle.update(view);
    const turnedEye = compass.update.mock.calls.at(-1)![2];
    expect(turnedEye.x).toBeCloseTo(-35, 6);
    expect(turnedEye.y).toBeCloseTo(6_379_163, 6);
    expect(turnedEye.z).toBeCloseTo(3, 6);
    const rootMatrix = vi.spyOn(origin.aircraftRoot, "computeWorldMatrix");
    const cameraView = vi.spyOn(view, "getViewMatrix");
    handle.update(view);
    expect(rootMatrix).not.toHaveBeenCalled();
    expect(cameraView).not.toHaveBeenCalled();
    const stillEye = compass.update.mock.calls.at(-1)![2];
    expect(stillEye.x).toBeCloseTo(-35, 6);
    expect(stillEye.y).toBeCloseTo(6_379_163, 6);
    expect(stillEye.z).toBeCloseTo(3, 6);
    rootMatrix.mockRestore();
    cameraView.mockRestore();
    handle.update(null);
    expect(compass.update).toHaveBeenLastCalledWith(null, 0, null);
  } finally {
    handle.destroy();
    expect(compass.destroy).toHaveBeenCalledOnce();
    origin.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it("samples a nested aircraft move and does not recompute a clean chain", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const origin = createFloatingOrigin(scene, new TransformNode("world", scene));
  const mount = new TransformNode("mount", scene);
  mount.parent = origin.aircraftRoot;
  mount.position.set(1, 2, 3);
  mount.rotationQuaternion = Quaternion.Identity();
  const view = new UniversalCamera("nested", new Vector3(10, 20, 30), scene);
  view.parent = mount;
  scene.activeCamera = view;
  compass.update.mockClear();
  const handle = createFlightCompass(scene, origin, {} as Document, vi.fn());
  try {
    const state = { latDeg: 0, lonDeg: 90, altMeters: 1000, headingRad: 0, pitchRad: 0, rollRad: 0 };
    origin.apply(state as Parameters<typeof origin.apply>[0]);
    handle.update(view);
    const parked = compass.update.mock.calls.at(-1)![2];

    origin.aircraftRoot.position.set(5, 6, 7);
    origin.aircraftRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI / 2, 0);
    handle.update(view);
    const eye = compass.update.mock.calls.at(-1)![2];
    const scaling = Vector3.One();
    const mounted = Vector3.TransformCoordinates(view.position, Matrix.Compose(scaling, Quaternion.Identity(), mount.position));
    const world = Vector3.TransformCoordinates(mounted, Matrix.Compose(scaling, origin.aircraftRoot.rotationQuaternion!, origin.aircraftRoot.position));
    const reference = origin.getOriginEcef()!;
    const { m } = origin.getWorldFromEcef()!;
    const expected = {
      x: reference.x + m[0] * world.x + m[1] * world.y + m[2] * world.z,
      y: reference.y + m[4] * world.x + m[5] * world.y + m[6] * world.z,
      z: reference.z + m[8] * world.x + m[9] * world.y + m[10] * world.z,
    };
    expect(eye.x).toBeCloseTo(expected.x, 6);
    expect(eye.y).toBeCloseTo(expected.y, 6);
    expect(eye.z).toBeCloseTo(expected.z, 6);
    expect(eye.x).not.toBeCloseTo(parked.x, 4);

    const rootMatrix = vi.spyOn(origin.aircraftRoot, "computeWorldMatrix");
    const mountMatrix = vi.spyOn(mount, "computeWorldMatrix");
    const cameraView = vi.spyOn(view, "getViewMatrix");
    handle.update(view);
    expect(rootMatrix).not.toHaveBeenCalled();
    expect(mountMatrix).not.toHaveBeenCalled();
    expect(cameraView).not.toHaveBeenCalled();
    const again = compass.update.mock.calls.at(-1)![2];
    expect(again.x).toBeCloseTo(expected.x, 6);
    expect(again.y).toBeCloseTo(expected.y, 6);
    expect(again.z).toBeCloseTo(expected.z, 6);
  } finally {
    handle.destroy();
    origin.dispose();
    scene.dispose();
    engine.dispose();
  }
});
