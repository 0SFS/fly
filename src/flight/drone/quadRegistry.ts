import type { DroneCameraModData, DjiQuadModData, QuadcopterModData, QuadVehicleModData } from "@0sfs/mods/schema";
import type { buildDroneProfile, DroneProfile } from "./droneTypes";

export const QUADCOPTER_MOD_ID = "0sfs/quadcopter";
export const DJI_QUADCOPTER_MOD_ID = "0sfs/dji-quadcopter";
let common: QuadcopterModData | null = null;
let dji: DjiQuadModData | null = null;
let build: typeof buildDroneProfile | null = null;
const cameras = new Map<string, DroneCameraModData>();
const vehicles = new Map<string, { label: string; vehicle: QuadVehicleModData }>();
const profiles = new Map<string, DroneProfile>();

/** The lazy feature supplies the runtime builder. Adding a mod stores only data. */
export function setQuadProfileBuilder(builder: typeof buildDroneProfile): void { build = builder; profiles.clear(); }
export function installDroneCamera(id: string, profile: DroneCameraModData): void { cameras.set(id, profile); profiles.clear(); }
export function installQuadCommon(data: QuadcopterModData): void { common = data; profiles.clear(); }
export function installDjiCommon(data: DjiQuadModData): void { dji = data; profiles.clear(); }

export function installQuadVehicle(id: string, label: string, vehicle: QuadVehicleModData): void {
  if (!common || !dji) throw new Error(`${id} needs the Quadcopter and DJI-Quadcopter mods installed first.`);
  if (!cameras.has(vehicle.cameraId)) throw new Error(`${id} needs camera mod ${vehicle.cameraId} installed first.`);
  vehicles.set(id, { label, vehicle });
  profiles.delete(id);
}
export function uninstallQuadVehicle(id: string): void { vehicles.delete(id); profiles.delete(id); }
export function uninstallQuadLayer(modId: string): void {
  cameras.delete(modId);
  for (const [id, { vehicle }] of vehicles) if (vehicle.cameraId === modId) vehicles.delete(id);
  if (modId === QUADCOPTER_MOD_ID) common = null;
  if (modId === DJI_QUADCOPTER_MOD_ID) dji = null;
  if (!common || !dji) vehicles.clear();
  profiles.clear();
}
export function quadProfile(id: string): DroneProfile | null {
  const installed = vehicles.get(id);
  const camera = installed && cameras.get(installed.vehicle.cameraId);
  if (!installed || !camera || !build || !common || !dji) return null;
  if (!profiles.has(id)) profiles.set(id, build(id, installed.label, common, dji, installed.vehicle, camera));
  return profiles.get(id)!;
}
export function quadAircraftIds(): readonly string[] { return [...vehicles.keys()]; }
