import { Quaternion, UniversalCamera, Vector3, type Camera, type Scene } from "@babylonjs/core";

/** How long after the pilot last moved the camera a ready arrival comes down. */
export const ARRIVAL_RESUME_IDLE_MS = 600;
/** How long the camera takes to come down from where the pilot left it. */
export const ARRIVAL_RESUME_SECONDS = 1.5;

/** Estimates change the remaining duration, never rewind progress or move it instantly. */
export function createArrivalProgress() {
  let value = 0, elapsed = 0;
  let deadline: number | null = null;
  let previousEstimate: number | null = null;
  let finalSeen = false;
  return {
    step(dt: number, remainingMs: number | null, ready: boolean): number {
      if (!Number.isFinite(dt) || dt <= 0 || value === 1) return value;
      dt = Math.min(0.1, dt);
      const estimate = remainingMs !== null && Number.isFinite(remainingMs) && remainingMs >= 0 ? remainingMs : null;
      if (deadline === null) deadline = elapsed + (estimate === null ? 3 : Math.max(0.5, Math.min(12, estimate / 1000 - 0.5)));
      else if (!finalSeen && estimate !== null && estimate !== previousEstimate) {
        deadline = elapsed + Math.max(0.5, Math.min(12, estimate / 1000 - 0.5));
      }
      previousEstimate = estimate;
      if (ready && !finalSeen) {
        finalSeen = true;
        deadline = Math.min(deadline, elapsed + 0.65);
      }
      // Interpolate from the current value over the remaining interval. A new
      // estimate changes speed, while the rendered position remains continuous.
      value += (1 - value) * Math.min(1, dt / Math.max(dt, deadline - elapsed));
      elapsed += dt;
      if (elapsed >= deadline - 1e-9) value = 1;
      return value;
    },
  };
}

/**
 * A presentation camera only. Region preparation never owns the render camera.
 * It comes down to the aircraft's camera as the map around it loads. A camera
 * gesture holds it where the pilot puts it; once the map is ready and the
 * pilot has let go, it comes down from there.
 */
export function createLoadingCamera(options: {
  scene: Scene; target: Camera; anchor: Vector3; up: Vector3; requestRender(): void; reducedMotion: boolean;
  beginContinuous?(): void; endContinuous?(): void;
  /** Whether a camera gesture is under way, such as a held drag or a pushed stick. */
  isGestureActive?(): boolean;
}) {
  const { scene, target, anchor, requestRender } = options;
  // Reduced motion uses the regular, interactive camera immediately. It must
  // never leave a stationary presentation camera covering the flight camera.
  if (options.reducedMotion) {
    scene.activeCamera = target;
    return {
      update() {}, orbit: () => false, zoom: () => false, takeover() {},
      isFinished: () => true, isManual: () => false, dispose() {},
    };
  }
  const presentation = new UniversalCamera("flight-arrival-camera", anchor.add(options.up.normalizeToNew().scale(3000)), scene);
  presentation.inputs.clear();
  presentation.minZ = target.minZ;
  presentation.maxZ = target.maxZ;
  presentation.fov = target.fov;
  presentation.upVector.copyFrom(Vector3.Forward());
  presentation.setTarget(anchor);
  const start = presentation.position.clone();
  const initialRotation = presentation.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(presentation.rotation);
  presentation.rotationQuaternion = initialRotation.clone();
  presentation.updateUpVectorFromRotation = true;
  let minimum = false, ready = false, manual = false, disposed = false;
  let held = false;
  const beginHold = () => { if (!held) { held = true; options.beginContinuous?.(); } };
  const releaseHold = () => { if (held) { held = false; options.endContinuous?.(); } };
  // When the pilot last had the camera, and its way down from where they left it.
  let lastGestureAt = -Infinity;
  let descent: { position: Vector3; rotation: Quaternion; elapsed: number } | null = null;
  let remainingMs: number | null = null;
  let last = performance.now();
  const timeline = createArrivalProgress();
  const destination = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
  const readTarget = () => {
    // The destination camera can be parented to the aircraft, cockpit or a
    // world-follow pivot. Force its view before reading its world transform.
    target.getViewMatrix(true);
    target.getWorldMatrix().decompose(scale, rotation, destination);
  };
  scene.activeCamera = presentation;
  const takeover = () => {
    manual = true;
    descent = null;
    lastGestureAt = performance.now();
    releaseHold();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    releaseHold();
    scene.onBeforeRenderObservable.remove(observer);
    if (scene.activeCamera === presentation) scene.activeCamera = target;
    presentation.dispose();
  };
  // Eases from a pose towards the destination just read.
  const travel = (position: Vector3, orientation: Quaternion, t: number) => {
    const eased = t * t * (3 - 2 * t);
    Vector3.LerpToRef(position, destination, eased, presentation.position);
    Quaternion.SlerpToRef(orientation, rotation, eased, presentation.rotationQuaternion!);
    if (t === 1) dispose();
    else requestRender();
  };
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    // Asset completion and the aircraft's normal camera update may select its
    // flight camera. This camera stays until it arrives, or until the pilot
    // explicitly selects another view or starts another placement.
    scene.activeCamera = presentation;
    if (manual) {
      // The pilot's camera until the map is ready and they have let it go.
      if (!ready) return;
      if (options.isGestureActive?.()) lastGestureAt = now;
      if (now - lastGestureAt < ARRIVAL_RESUME_IDLE_MS) { requestRender(); return; }
      manual = false;
      descent = { position: presentation.position.clone(), rotation: presentation.rotationQuaternion!.clone(), elapsed: 0 };
      beginHold();
    }
    if (descent) {
      readTarget();
      descent.elapsed += dt;
      travel(descent.position, descent.rotation, Math.min(1, descent.elapsed / ARRIVAL_RESUME_SECONDS));
    } else if (minimum) {
      readTarget();
      travel(start, initialRotation, timeline.step(dt, remainingMs, ready));
    }
  });
  requestRender();
  return {
    update(progress: { minimumReady: boolean; finalReady: boolean; estimatedRemainingMs: number | null }) {
      if (disposed) return;
      minimum ||= progress.minimumReady;
      ready = progress.finalReady;
      remainingMs = progress.estimatedRemainingMs;
      if (minimum && !manual) beginHold();
      if (minimum) requestRender();
    },
    orbit(yaw: number, pitch: number): boolean {
      if (disposed || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return false;
      takeover();
      presentation.rotationQuaternion!.multiplyInPlace(Quaternion.RotationYawPitchRoll(yaw, pitch, 0)).normalize();
      requestRender();
      return true;
    },
    zoom(factor: number): boolean {
      if (disposed || !Number.isFinite(factor) || factor <= 0) return false;
      takeover();
      const direction = Vector3.Forward(scene.useRightHandedSystem).applyRotationQuaternion(presentation.rotationQuaternion!);
      presentation.position.addInPlace(direction.scale((1 - factor) * Math.max(1, Vector3.Distance(presentation.position, anchor))));
      requestRender();
      return true;
    },
    takeover() { if (!disposed) takeover(); },
    /** Whether the camera has reached the aircraft's, or was put away. */
    isFinished: () => disposed,
    /** Whether the pilot has the camera: it waits for them to let go. */
    isManual: () => manual && !disposed,
    dispose,
  };
}
