/**
 * The only drone module the flight startup graph imports. The feature chunk
 * loads from `loadDroneFeature` and from nowhere else.
 */
import { DJI_QUADCOPTER_MOD_ID, QUADCOPTER_MOD_ID, quadAircraftIds } from "./quadRegistry";

export const DRONE_MOD_ID = DJI_QUADCOPTER_MOD_ID;
export const QUAD_LAYER_IDS = [QUADCOPTER_MOD_ID, DJI_QUADCOPTER_MOD_ID, "0sfs/dji-mini2", "0sfs/dji-air2s"] as const;
export const DRONE_AIRCRAFT_IDS = ["dji-mini2", "dji-air2s"] as const;
export type DroneAircraftId = (typeof DRONE_AIRCRAFT_IDS)[number];

export type DroneMotorPosition = "front-left" | "front-right" | "rear-left" | "rear-right";
export interface DroneMotorReading {
  position: DroneMotorPosition;
  rpm: number;
  direction: 1 | -1;
}
/** Simulated rotor speeds from the plant, not ESC telemetry. */
export interface DroneMotorTelemetry {
  aircraftId: string;
  label: string;
  hoverRpm: number;
  maxRpm: number;
  /** Advances with physics only, so instruments freeze while paused. */
  simTimeS: number;
  motors: readonly DroneMotorReading[];
  source: "simulated";
}

/** Acoustic inputs from the accepted rotor plant step, in the physical rotor order. */
export interface DroneAcousticRotor {
  rpm: number;
  thrustN: number;
  shaftTorqueNm: number;
  inducedVelocityMps: number;
  vrs: number;
  valid: boolean;
}
export interface DroneAcousticSample {
  valid: boolean;
  armed: boolean;
  simTimeS: number;
  airDensityKgM3: number;
  /** Body axes: forward, right, down; relative to the air, in m/s. */
  airVelocityBodyMps: readonly [number, number, number];
  rotors: readonly DroneAcousticRotor[];
}
export interface DroneAcousticTelemetry extends DroneAcousticSample {
  aircraftId: string;
  propulsionId?: string;
}

export function isDroneAircraftId(id: string): id is DroneAircraftId {
  return (DRONE_AIRCRAFT_IDS as readonly string[]).includes(id) || quadAircraftIds().includes(id);
}

export interface DroneMeshMount {
  mount(modelRoot: import("@babylonjs/core").TransformNode): () => void;
  dispose(): void;
}

export interface DroneFeatureHooks {
  /** UI owned by the applied feature; closing its tab only detaches it. */
  cameraTab?(): HTMLElement;
  /** A propulsion-specific instrument supplied only by the applied lazy feature. */
  createEngineMonitor?(root: HTMLElement, options: import("@0sfs/engines/engineMonitor").EngineMonitorOptions): import("@0sfs/engines/engineMonitor").EngineMonitorHandle;
  /** Immediately releases a removed active aircraft and clears its native wrench. */
  releaseAircraft?(aircraftId: string): void;
  beforeStep(step: DroneStepContext): void;
  afterView(view: DroneViewContext): void;
  dispose(): void;
}

export interface DroneStepContext {
  dtSeconds: number;
  sdk: import("@felipegalind0/jsbsim").JSBSimSdk;
  command: DroneStickCommand;
  terrainMeters: number | null;
}

export interface DroneViewContext {
  paused?: boolean;
  terrainMeters?: number | null;
  state: import("@0sfs/ground-contact/flightState").FlightState;
  scene: import("@babylonjs/core").Scene;
  aircraftRoot: import("@babylonjs/core").TransformNode;
  requestRender(): void;
  /** WebGPU when the flight renderer selected it. Capture refuses anything else. */
  rendererMode: "webgpu" | "webgl2" | "webgl";
}

export interface DroneStickCommand {
  pitch: number;
  roll: number;
  vertical: number;
  yaw: number;
  yawMode: "angularVelocity" | "angle";
  yawAngleDeg: number | null;
  gimbalPitchDeg: number;
  sport: boolean;
  shutter: boolean;
  capture360: boolean;
}

/** Phone command fields the gate accepts without importing the quad protocol. */
export interface DronePhoneCommand {
  droneId: string;
  pitch: number;
  roll: number;
  vertical: number;
  yaw: number;
  yawMode: "angularVelocity" | "angle";
  yawAngleDeg?: number;
  gimbalPitchDeg: number;
  sport?: boolean;
  shutter?: 1;
  capture360?: boolean;
}

type FeatureModule = {
  attach(hooks: { setHooks(next: DroneFeatureHooks | null): void; setMesh(next: DroneMeshMount | null): void }): void;
};

let hooks: DroneFeatureHooks | null = null;
let mesh: DroneMeshMount | null = null;
let loading: Promise<void> | null = null;
let disposed = false;
let activeId: string | null = null;
let gimbalTarget = 0;
let captureHeld = false;
let telemetry: Record<string, unknown> | null = null;
let motorTelemetry: DroneMotorTelemetry | null = null;
let acousticTelemetry: DroneAcousticTelemetry | null = null;
let refusal: string | null = null;
let removalSwitch: ((modId: string, removedAircraftIds: readonly string[]) => void) | null = null;

export function noteActiveAircraft(id: string): void {
  activeId = id;
  if (motorTelemetry?.aircraftId !== id) motorTelemetry = null;
  if (acousticTelemetry?.aircraftId !== id) acousticTelemetry = null;
}

export function activeAircraftId(): string | null {
  return activeId;
}

export function droneHeldGimbal(): number {
  return gimbalTarget;
}

export function setDroneHeldGimbal(deg: number): void {
  gimbalTarget = deg;
}

export function nudgeDroneGimbal(deltaDeg: number, minDeg: number, maxDeg: number): void {
  gimbalTarget = Math.min(maxDeg, Math.max(minDeg, gimbalTarget + deltaDeg));
}

export function droneHeldCapture(): boolean {
  return captureHeld;
}

export function setDroneHeldCapture(on: boolean): void {
  captureHeld = on;
}

export function toggleDroneCapture(): void {
  captureHeld = !captureHeld;
}

export function setDroneTelemetry(next: Record<string, unknown> | null): void {
  telemetry = next;
}

export function droneRefusal(): string | null {
  return refusal;
}

export function setDroneRefusal(next: string | null): void {
  refusal = next;
}

export function droneTelemetry(): Record<string, unknown> | null {
  return telemetry;
}

export function setDroneMotorTelemetry(next: DroneMotorTelemetry | null): void {
  motorTelemetry = next;
}

export function droneMotorTelemetry(): DroneMotorTelemetry | null {
  return motorTelemetry;
}

export function setDroneAcousticTelemetry(next: DroneAcousticTelemetry | null): void {
  acousticTelemetry = next;
}
/** Cheap read: loading the electric sound never imports the drone feature or plant. */
export function droneAcousticTelemetry(): DroneAcousticTelemetry | null {
  return acousticTelemetry;
}

export function setDroneRemovalSwitch(handler: ((modId: string, removedAircraftIds: readonly string[]) => void) | null): void {
  removalSwitch = handler;
}

export function droneMeshHook(): DroneMeshMount | null {
  return mesh;
}

export function droneCameraTab(): HTMLElement | null {
  return hooks?.cameraTab?.() ?? null;
}

export function droneHooks(): DroneFeatureHooks | null {
  return hooks;
}

export function loadDroneFeature(): Promise<void> {
  if (disposed) return Promise.reject(new Error("The drone mod was removed."));
  loading ??= import("./droneFeature").then(module => {
    const feature = module as FeatureModule;
    feature.attach({
      setHooks(next) { hooks = next; },
      setMesh(next) { mesh = next; },
    });
  });
  return loading;
}

export function onModRemoved(modId: string, removedAircraftIds: readonly string[] = []): void {
  if (activeId && removedAircraftIds.includes(activeId)) {
    // Release before the asynchronous aircraft switch can take another physics step.
    hooks?.releaseAircraft?.(activeId);
    telemetry = null;
    motorTelemetry = null;
    acousticTelemetry = null;
  }
  const layer = (QUAD_LAYER_IDS as readonly string[]).includes(modId);
  if ((layer || removedAircraftIds.length > 0) && quadAircraftIds().length === 0) {
    disposed = true;
    hooks?.dispose();
    mesh?.dispose();
    hooks = null;
    mesh = null;
    loading = null;
    telemetry = null;
    motorTelemetry = null;
    acousticTelemetry = null;
    refusal = null;
    captureHeld = false;
  }
  if (removedAircraftIds.length > 0) removalSwitch?.(modId, removedAircraftIds);
}

export function onModAdded(modId: string): void {
  if ((QUAD_LAYER_IDS as readonly string[]).includes(modId) || quadAircraftIds().length > 0) disposed = false;
}

export function currentDroneCommand(
  phone: DronePhoneCommand | null,
  desktop: { elevator: number; aileron: number; rudder: number; throttle: number; climb?: number },
): DroneStickCommand {
  if (phone) {
    return {
      pitch: phone.pitch,
      roll: phone.roll,
      vertical: phone.vertical,
      yaw: phone.yaw,
      yawMode: phone.yawMode,
      yawAngleDeg: phone.yawAngleDeg ?? null,
      gimbalPitchDeg: phone.gimbalPitchDeg,
      sport: phone.sport === true,
      shutter: phone.shutter === 1,
      capture360: phone.capture360 === true || captureHeld,
    };
  }
  return {
    pitch: desktop.elevator,
    roll: desktop.aileron,
    yaw: desktop.rudder,
    vertical: desktop.climb ?? 0,
    yawMode: "angularVelocity",
    yawAngleDeg: null,
    gimbalPitchDeg: gimbalTarget,
    sport: false,
    shutter: false,
    capture360: captureHeld,
  };
}
