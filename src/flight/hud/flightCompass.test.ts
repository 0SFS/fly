import { NullEngine, Quaternion, Scene, TransformNode, UniversalCamera, Vector3 } from "@babylonjs/core";
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
