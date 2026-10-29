import type { DroneCameraModData, DjiQuadModData, QuadcopterModData, QuadVehicleModData } from "@0sfs/mods/schema";

export const DEADZONE = 0.03;
export const PHYSICS_DT = 1 / 120;

import { fovFromDiagonal, type CameraProfile } from "@0sfs/drone-camera/profile";
export { fovFromDiagonal } from "@0sfs/drone-camera/profile";

export interface DroneProfile extends CameraProfile, QuadVehicleModData {
  id: string;
  label: string;
  kPos: number;
  deadzone: number;
  gridOverlap: number;
  gimbalSlewDeg: number;
  positionHoldMps: number;
  gimbalRollDeg: number;
  familyId: string;
  properties: QuadcopterModData["properties"];
}

/** Vehicle numbers come from the airframe mod. Shared gains come from Quadcopter. Sensor, lens and still metadata come from the selected camera mod. */
export function buildDroneProfile(
  id: string,
  label: string,
  common: QuadcopterModData,
  dji: DjiQuadModData,
  vehicle: QuadVehicleModData,
  camera: DroneCameraModData,
): DroneProfile {
  const fov = fovFromDiagonal(camera.sensorW, camera.sensorH, camera.diagonalFovDeg);
  return {
    id,
    label,
    ...vehicle,
    ...camera,
    ...fov,
    kPos: common.gains.kPos,
    deadzone: common.gains.deadzone,
    gridOverlap: common.gridOverlap,
    gimbalSlewDeg: common.gimbalSlewDeg,
    positionHoldMps: common.positionHoldMps,
    gimbalRollDeg: dji.gimbalRollDeg,
    familyId: dji.familyId,
    properties: common.properties,
  };
}

export function dead(value: number, zone = DEADZONE): number {
  return Math.abs(value) < zone ? 0 : value;
}

export function wrap(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
