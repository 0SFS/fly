import { AIRCRAFT_CATALOG, registerAircraftMod, type AircraftDefinition, type AircraftFamilyDefinition } from "@0sfs/aircraft/aircraftCatalog";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import { getRegisteredEngine, registerEngine, type RegisteredEngine } from "@0sfs/engines/engineRegistry";
import type { LoadedModRecord } from "@0sfs/mods";
import { registerAircraftAudioInstallation } from "@0sfs/sound/aircraftAudioProfiles";
import { registerEngineAcousticDefinition, telemetryById } from "@0sfs/sound/engineAcousticDefinitions";
import { registerPayloadInstallation } from "@0sfs/stores/stationTable";
import { registerPayloadStore, registerRefusedStore, registerStorePresets, storeByKey, type StoreCard } from "@0sfs/stores/storeCatalog";
import { FDM_PROFILES, registerFdmProfile } from "../jsbsim/fdmProfiles";
import { onModAdded } from "../drone/droneGate";
import { installDroneCamera, installDjiCommon, installQuadCommon, installQuadVehicle } from "../drone/quadRegistry";
import { installCameraPreview } from "../drone/cameraPreviewRegistry";

function applyQuadLayer(record: LoadedModRecord): void {
  const manifest = record.manifest;
  if (manifest.camera) installDroneCamera(manifest.id, manifest.camera);
  if (manifest.quadcopter) installQuadCommon(manifest.quadcopter);
  if (manifest.dji) installDjiCommon(manifest.dji);
  const definition = manifest.aircraft?.definitions[0] as { id?: string; label?: string } | undefined;
  if (manifest.quad && definition?.id && definition.label) installQuadVehicle(definition.id, definition.label, manifest.quad);
  if (manifest.quadcopter || manifest.dji || manifest.quad) onModAdded(manifest.id);
}

/** Registers a mod that was not already part of the built-in fleet. Dependencies register first. */
export function applyDynamicMod(record: LoadedModRecord): void {
  const seen = new Set<string>();
  const visit = (item: LoadedModRecord): void => {
    if (seen.has(item.manifest.id)) return;
    for (const dependency of item.dependencies) visit(dependency);
    seen.add(item.manifest.id);
    applyOne(item);
  };
  visit(record);
}

function applyOne(record: LoadedModRecord): void {
  applyQuadLayer(record);
  const manifest = record.manifest;
  if (manifest.cameraPreview) installCameraPreview(record);
  if (manifest.kind === "payload" && manifest.payload?.payloadType === "store" && manifest.payload.store) {
    const store = manifest.payload.store as StoreCard;
    if (!storeByKey(store.key)) registerPayloadStore(store);
  }
  if (manifest.kind === "engine" && manifest.engine && !getRegisteredEngine(manifest.engine.id)) {
    const engine = manifest.engine as RegisteredEngine & { acousticProfile?: { id: string; telemetryId: string; parameters: never; engineClass: string; manufacturerFamily: string; rendererId: string; label: string; approximation: string } };
    registerEngine(engine);
    const acoustic = engine.acousticProfile;
    const telemetry = acoustic ? telemetryById(acoustic.telemetryId) : undefined;
    if (acoustic && telemetry) registerEngineAcousticDefinition({ ...acoustic, telemetry, parameters: acoustic.parameters });
  }
  if (manifest.kind !== "aircraft" || !manifest.aircraft) return;
  const assetPath = (path: string): string => !path || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path)
    ? path : `${record.baseUrl}${path}`;
  const definitions = (manifest.aircraft.definitions as unknown as AircraftDefinition[]).map(definition => ({
    ...definition,
    lods: definition.lods.map(lod => ({ ...lod, path: assetPath(lod.path) })),
  }));
  if (definitions.every(definition => AIRCRAFT_CATALOG.some(item => item.id === definition.id))) return;
  const family = manifest.aircraft.family as unknown as AircraftFamilyDefinition;
  registerAircraftMod({ ...family, thumbnail: { ...family.thumbnail, path: assetPath(family.thumbnail.path) } }, definitions);
  for (const [id, profile] of Object.entries(manifest.aircraft.fdmProfiles)) {
    if (FDM_PROFILES[id as AircraftId]) continue;
    registerFdmProfile(id as AircraftId, profile as Parameters<typeof registerFdmProfile>[1]);
  }
  const audio = manifest.aircraft.audio?.engineDefinitionId;
  if (audio) {
    for (const definition of definitions) registerAircraftAudioInstallation(definition.id, audio);
  }
  const installation = manifest.aircraft.payloadInstallation as Parameters<typeof registerPayloadInstallation>[0] & {
    stationClearances?: Record<string, { stations: number[]; ratingException: StoreCard["ratingException"] }>;
    refusedStores?: readonly { key: string; label: string; refusal: string | null }[];
    presets?: Parameters<typeof registerStorePresets>[0];
    externalTankInstallations?: readonly { tankKey: string; index: number; label: string; attachmentProperty: string; locationIn: { x: number; y: number; z: number } }[];
    bayDoors?: { bays: Parameters<typeof registerPayloadInstallation>[0]["bays"]; fit: Parameters<typeof registerPayloadInstallation>[0]["bayDoorFit"]; doorOpenRad: number; doorFullTravelSeconds: number; internalStoreVisibleAt: number };
  } | undefined;
  if (!installation?.bayDoors) return;
  registerPayloadInstallation({
    structuralReferenceIn: installation.structuralReferenceIn,
    stations: installation.stations,
    meshFits: installation.meshFits,
    bays: installation.bayDoors.bays,
    bayDoorFit: installation.bayDoors.fit,
    doorOpenRad: installation.bayDoors.doorOpenRad,
    doorFullTravelSeconds: installation.bayDoors.doorFullTravelSeconds,
    internalStoreVisibleAt: installation.bayDoors.internalStoreVisibleAt,
  });
  for (const refused of installation.refusedStores ?? []) {
    if (refused.refusal && !storeByKey(refused.key)) registerRefusedStore(refused.key, refused.label, refused.refusal);
  }
  if (installation.presets) registerStorePresets(installation.presets);
}
