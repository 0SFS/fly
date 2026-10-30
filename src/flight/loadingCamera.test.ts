import { NullEngine, Quaternion, Scene, TransformNode, UniversalCamera, Vector3 } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARRIVAL_RESUME_IDLE_MS, ARRIVAL_RESUME_SECONDS, createArrivalProgress, createLoadingCamera } from "./loadingCamera";

const disposals: Array<() => void> = [];
afterEach(() => { for (const dispose of disposals.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });

describe("arrival timeline", () => {
  it("finishes in three seconds without an ETA instead of approaching forever", () => {
    const progress = createArrivalProgress();
    let value = 0;
    for (let frame = 0; frame < 180; frame++) value = progress.step(1 / 60, null, false);
    expect(value).toBe(1);
  });
  it("stays continuous and monotonic when estimates lengthen or shorten", () => {
    const progress = createArrivalProgress();
    let previous = 0;
    for (let frame = 0; frame < 480; frame++) {
      const eta = frame < 60 ? 4000 : frame < 120 ? 9000 : 2000;
      const value = progress.step(1 / 60, eta, false);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value - previous).toBeLessThan(0.04);
      previous = value;
    }
    expect(previous).toBe(1);
  });
  it("finishes smoothly after early final readiness and ignores invalid elapsed time", () => {
    const progress = createArrivalProgress();
    const first = progress.step(0.1, 8000, false);
    for (const dt of [0, -1, NaN, Infinity]) expect(progress.step(dt, 1000, true)).toBe(first);
    let previous = first;
    for (let frame = 0; frame < 40; frame++) {
      const next = progress.step(1 / 60, 8000, true);
      expect(next - previous).toBeLessThan(0.03);
      previous = next;
    }
    expect(previous).toBe(1);
  });
});

function cameraFixture(reducedMotion = false) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const parent = new TransformNode("camera-parent", scene);
  parent.position.set(40, 30, 20);
  parent.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.5, 0.2, 0.1);
  const target = new UniversalCamera("flight-camera", new Vector3(2, 5, -10), scene);
  target.parent = parent;
  target.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.2, -0.15, 0.05);
  scene.activeCamera = target;
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const render = vi.fn(), beginContinuous = vi.fn(), endContinuous = vi.fn();
  const gesture = { active: false };
  const arrival = createLoadingCamera({ scene, target, anchor: Vector3.Zero(), up: Vector3.Up(), requestRender: render, reducedMotion,
    beginContinuous, endContinuous, isGestureActive: () => gesture.active });
  disposals.push(() => { arrival.dispose(); scene.dispose(); engine.dispose(); });
  return {
    scene, target, parent, arrival, render, beginContinuous, endContinuous, gesture,
    frame(dt = 1 / 60) { now += dt * 1000; scene.onBeforeRenderObservable.notifyObservers(scene); },
    /** Frames for this long, in seconds. */
    frames(seconds: number) { for (let frame = 0; frame < Math.round(seconds * 60); frame++) this.frame(); },
  };
}

describe("loading camera", () => {
  it("waits for minimum detail then reaches the parented destination and releases ownership", () => {
    const t = cameraFixture();
    const presentation = t.scene.activeCamera!;
    const start = presentation.position.clone();
    for (let frame = 0; frame < 60; frame++) t.frame();
    expect(presentation.position.equals(start)).toBe(true);
    t.arrival.update({ minimumReady: true, finalReady: false, estimatedRemainingMs: null });
    for (let frame = 0; frame < 90; frame++) t.frame();
    const expected = t.target.globalPosition;
    expect(Vector3.Distance(presentation.position, expected)).toBeGreaterThan(1);
    expect(Vector3.Distance(presentation.position, start)).toBeGreaterThan(100);
    for (let frame = 0; frame < 90; frame++) t.frame();
    expect(t.arrival.isFinished()).toBe(true);
    expect(t.scene.activeCamera).toBe(t.target);
    expect(Vector3.Distance(presentation.position, t.target.globalPosition)).toBeLessThan(0.001);
    const expectedRotation = new Quaternion();
    t.target.getWorldMatrix().decompose(undefined, expectedRotation);
    expect(Math.abs(Quaternion.Dot((presentation as UniversalCamera).rotationQuaternion!, expectedRotation))).toBeCloseTo(1, 5);
    expect(presentation.isDisposed()).toBe(true);
    expect(t.beginContinuous).toHaveBeenCalledOnce();
    expect(t.endContinuous).toHaveBeenCalledOnce();
  });
  it("keeps the pilot's pose while the map loads, then comes down from it once they let go", () => {
    const t = cameraFixture();
    const presentation = t.scene.activeCamera! as UniversalCamera;
    t.arrival.update({ minimumReady: true, finalReady: false, estimatedRemainingMs: 4000 });
    t.frames(0.5);
    expect(t.arrival.orbit(0.2, -0.1)).toBe(true);
    expect(t.arrival.zoom(0.8)).toBe(true);
    const manualPose = presentation.position.clone();
    for (let frame = 0; frame < 120; frame++) {
      t.scene.activeCamera = t.target;
      t.frame();
    }
    expect(t.scene.activeCamera).toBe(presentation);
    expect(presentation.position.equals(manualPose)).toBe(true);
    expect(t.arrival.isManual()).toBe(true);
    expect(t.arrival.isFinished()).toBe(false);
    // Ready while the pilot still holds the camera: it stays.
    t.gesture.active = true;
    t.arrival.update({ minimumReady: true, finalReady: true, estimatedRemainingMs: 0 });
    t.frames(3);
    expect(presentation.position.equals(manualPose)).toBe(true);
    // Let go: it waits a moment, then comes down smoothly from there.
    t.gesture.active = false;
    t.frames(ARRIVAL_RESUME_IDLE_MS / 1000 - 0.1);
    expect(presentation.position.equals(manualPose)).toBe(true);
    expect(t.arrival.isManual()).toBe(true);
    const distance = Vector3.Distance(manualPose, t.target.globalPosition);
    let previous = presentation.position.clone(), largestStep = 0;
    for (let frame = 0; frame < (ARRIVAL_RESUME_SECONDS + 0.5) * 60 && !t.arrival.isFinished(); frame++) {
      t.frame();
      largestStep = Math.max(largestStep, Vector3.Distance(previous, presentation.position));
      previous = presentation.position.clone();
    }
    expect(largestStep).toBeLessThan(distance * 0.03);
    expect(t.arrival.isFinished()).toBe(true);
    expect(t.arrival.isManual()).toBe(false);
    expect(t.scene.activeCamera).toBe(t.target);
    expect(Vector3.Distance(presentation.position, t.target.globalPosition)).toBeLessThan(0.001);
  });
  it("stops coming down when the pilot takes the camera again, and comes down once they let go", () => {
    const t = cameraFixture();
    const presentation = t.scene.activeCamera!;
    t.arrival.takeover();
    t.arrival.update({ minimumReady: true, finalReady: true, estimatedRemainingMs: 0 });
    t.frames(ARRIVAL_RESUME_IDLE_MS / 1000 + 0.5);
    expect(t.arrival.isManual()).toBe(false);
    expect(t.arrival.isFinished()).toBe(false);
    expect(t.arrival.zoom(0.9)).toBe(true);
    const held = presentation.position.clone();
    t.frames(0.3);
    expect(presentation.position.equals(held)).toBe(true);
    t.frames(ARRIVAL_RESUME_IDLE_MS / 1000 + ARRIVAL_RESUME_SECONDS + 0.2);
    expect(t.arrival.isFinished()).toBe(true);
    expect(t.scene.activeCamera).toBe(t.target);
  });
  it("holds continuous frames only while the camera travels, never while the pilot has it", () => {
    const t = cameraFixture();
    expect(t.beginContinuous).not.toHaveBeenCalled();
    t.arrival.update({ minimumReady: false, finalReady: false, estimatedRemainingMs: null });
    expect(t.beginContinuous).not.toHaveBeenCalled();
    t.arrival.update({ minimumReady: true, finalReady: false, estimatedRemainingMs: null });
    t.arrival.update({ minimumReady: true, finalReady: false, estimatedRemainingMs: null });
    expect(t.beginContinuous).toHaveBeenCalledOnce();
    t.arrival.takeover();
    expect(t.endContinuous).toHaveBeenCalledOnce();
    t.arrival.update({ minimumReady: true, finalReady: true, estimatedRemainingMs: 0 });
    expect(t.beginContinuous).toHaveBeenCalledOnce();
    // Coming down from where the pilot left it.
    t.frames(ARRIVAL_RESUME_IDLE_MS / 1000 + 0.1);
    expect(t.beginContinuous).toHaveBeenCalledTimes(2);
    expect(t.endContinuous).toHaveBeenCalledOnce();
    t.frames(ARRIVAL_RESUME_SECONDS + 0.2);
    expect(t.arrival.isFinished()).toBe(true);
    expect(t.endContinuous).toHaveBeenCalledTimes(2);
    t.arrival.dispose();
    expect(t.beginContinuous).toHaveBeenCalledTimes(2);
    expect(t.endContinuous).toHaveBeenCalledTimes(2);
  });
  it("uses the regular camera immediately with reduced motion and does not keep an observer", () => {
    const t = cameraFixture(true);
    expect(t.scene.activeCamera).toBe(t.target);
    t.arrival.update({ minimumReady: true, finalReady: true, estimatedRemainingMs: 0 });
    expect(t.arrival.isFinished()).toBe(true);
    expect(t.arrival.orbit(0.1, 0.1)).toBe(false);
    expect(t.scene.cameras).toEqual([t.target]);
  });
  it("releases callbacks and leaves a newly selected camera alone during cleanup", () => {
    const t = cameraFixture();
    const other = new UniversalCamera("explicit-view", Vector3.Zero(), t.scene);
    t.scene.activeCamera = other;
    t.arrival.dispose();
    expect(t.scene.activeCamera).toBe(other);
    const count = t.render.mock.calls.length;
    t.frame();
    t.arrival.update({ minimumReady: true, finalReady: true, estimatedRemainingMs: 0 });
    expect(t.render).toHaveBeenCalledTimes(count);
    expect(t.arrival.zoom(0.8)).toBe(false);
  });
});
