import { createCameraGimbal } from "@0sfs/camera-gimbal";
import type { Scene } from "@babylonjs/core";
import type { DroneProfile } from "./droneTypes";
export type DroneGimbalRig = ReturnType<typeof createCameraGimbal>;
export function createDroneGimbal(scene: Scene, profile: DroneProfile): DroneGimbalRig {
  return createCameraGimbal(scene, { name: "drone-gimbal", offset: { x: 0, y: -0.02, z: 0.05 }, vfovRad: profile.vfovRad });
}
