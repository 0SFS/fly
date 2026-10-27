import {
  registerAircraftFleet,
  type AircraftDefinition,
  type AircraftFamilyDefinition,
} from "@0sfs/aircraft/aircraftCatalog";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import { registerEngine } from "@0sfs/engines/engineRegistry";
import { registerExternalTanks } from "@0sfs/fuel/externalTankDefinitions";
import { registerAircraftAudioInstallation } from "@0sfs/sound/aircraftAudioProfiles";
import { registerEngineAcousticDefinition, telemetryById, type EngineAcousticDefinition } from "@0sfs/sound/engineAcousticDefinitions";
import { registerPayloadInstallation } from "@0sfs/stores/stationTable";
import { applyStoreClearance, registerPayloadStore, registerRefusedStore, registerStorePresets } from "@0sfs/stores/storeCatalog";
import type { StoreCard } from "@0sfs/stores/storeCatalog";
import { F135_ENGINE_GAS_SUPPORT } from "../aircraft/f135Installation";
import c172 from "@0sfs/c172/manifest" with { type: "json" };
import sf50 from "@0sfs/sf-50/manifest" with { type: "json" };
import f35b from "@0sfs/f-35b/manifest" with { type: "json" };
import io320 from "@0sfs/io320/manifest" with { type: "json" };
import fj33 from "@0sfs/fj33/manifest" with { type: "json" };
import f135 from "@0sfs/f135/manifest" with { type: "json" };
import aim120 from "@0sfs/aim-120/manifest" with { type: "json" };
import gbu12 from "@0sfs/gbu-12/manifest" with { type: "json" };
import gbu32 from "@0sfs/gbu-32/manifest" with { type: "json" };
import aim9x from "@0sfs/aim-9x/manifest" with { type: "json" };
import asraam from "@0sfs/asraam/manifest" with { type: "json" };
import paveway from "@0sfs/paveway-iv/manifest" with { type: "json" };
import gau22 from "@0sfs/gau-22-pod/manifest" with { type: "json" };
import tank from "@0sfs/f-35b-external-tank/manifest" with { type: "json" };

/**
 * Catalogue order. The landing page checks that one flight script lists these
 * thumbnails in this order, with each family's label, summary and note.
 */
export const BUILTIN_FAMILY_THUMBNAILS = [
  "aircraft/thumbnails/cessna-172.png",
  "aircraft/thumbnails/cirrus-vision-jet.png",
  "aircraft/thumbnails/f-35b.png",
] as const;

interface EngineMod {
  engine: {
    id: string; label: string; summary: string; type: "piston" | "turbine";
    jsbsimEngineFiles: readonly string[];
    rotorBlades: EngineAcousticDefinition["parameters"] extends never ? never : {
      outer: number; inner: number | null; outerEstimated: boolean; innerEstimated: boolean;
    };
    startSpeed: { property: string; runningAt: number };
    maxEngineRpm?: number;
    gauges: { primary: string; secondary: string | null; label: string };
    acousticProfile?: {
      id: string; engineClass: string; manufacturerFamily: string; rendererId: string;
      telemetryId: string; label: string; approximation: string; parameters: EngineAcousticDefinition["parameters"];
    };
  };
}

interface AircraftMod {
  aircraft: {
    family: AircraftFamilyDefinition;
    definitions: readonly AircraftDefinition[];
    fdmProfiles: Readonly<Record<string, unknown>>;
    audio?: { engineDefinitionId: string };
    payloadInstallation?: {
      structuralReferenceIn: { x: number; y: number; z: number };
      stations: Parameters<typeof registerPayloadInstallation>[0]["stations"];
      stationClearances: Record<string, { stations: number[]; ratingException: StoreCard["ratingException"] }>;
      refusedStores?: readonly { key: string; label: string; refusal: string | null }[];
      meshFits: Parameters<typeof registerPayloadInstallation>[0]["meshFits"];
      presets: Parameters<typeof registerStorePresets>[0];
      externalTankInstallations?: readonly {
        tankKey: string; index: number; label: string; attachmentProperty: string;
        locationIn: { x: number; y: number; z: number };
      }[];
      bayDoors?: {
        bays: Parameters<typeof registerPayloadInstallation>[0]["bays"];
        fit: Parameters<typeof registerPayloadInstallation>[0]["bayDoorFit"];
        doorOpenRad: number; doorFullTravelSeconds: number; internalStoreVisibleAt: number;
      };
    };
  };
}

interface StoreMod { payload?: { payloadType?: string; store?: Parameters<typeof registerPayloadStore>[0] } }
interface TankMod { payload?: { tank?: { key: string; capacityLbs: number; dryWeightLbs: number } } }

void F135_ENGINE_GAS_SUPPORT;

const aircraftMods = [c172, sf50, f35b] as unknown as AircraftMod[];
const families = aircraftMods.map(mod => mod.aircraft.family);
for (const [index, family] of families.entries()) {
  const thumbnail = family.thumbnail?.path;
  if (thumbnail !== BUILTIN_FAMILY_THUMBNAILS[index]) {
    throw new Error(`Aircraft family ${family.id} thumbnail is ${thumbnail}, expected ${BUILTIN_FAMILY_THUMBNAILS[index]}.`);
  }
}
registerAircraftFleet(families, aircraftMods.flatMap(mod => mod.aircraft.definitions));

for (const mod of [io320, fj33, f135] as unknown as EngineMod[]) {
  const engine = mod.engine;
  registerEngine(engine);
  const acoustic = engine.acousticProfile;
  const telemetry = acoustic ? telemetryById(acoustic.telemetryId) : undefined;
  if (acoustic && telemetry) {
    registerEngineAcousticDefinition({ ...acoustic, telemetry, parameters: acoustic.parameters });
  }
}

const stores = [aim120, gbu12, gbu32, aim9x, asraam, paveway, gau22] as unknown as StoreMod[];
stores.sort((left, right) => (left.payload?.store?.id ?? 0) - (right.payload?.store?.id ?? 0));
for (const mod of stores) {
  if (mod.payload?.store) registerPayloadStore(mod.payload.store);
}

for (const mod of aircraftMods) {
  const audio = mod.aircraft.audio?.engineDefinitionId;
  if (audio) {
    for (const id of Object.keys(mod.aircraft.fdmProfiles)) registerAircraftAudioInstallation(id as AircraftId, audio);
  }
  const installation = mod.aircraft.payloadInstallation;
  if (!installation) continue;
  for (const [key, clearance] of Object.entries(installation.stationClearances)) {
    applyStoreClearance(key, clearance.stations, clearance.ratingException);
  }
  for (const refused of installation.refusedStores ?? []) {
    if (refused.refusal) registerRefusedStore(refused.key, refused.label, refused.refusal);
  }
  registerStorePresets(installation.presets);
  if (installation.bayDoors) {
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
  }
  const tankDefinition = (tank as unknown as TankMod).payload?.tank;
  if (tankDefinition && installation.externalTankInstallations) {
    registerExternalTanks("f-35b", installation.externalTankInstallations.filter(item => item.tankKey === tankDefinition.key).map(item => ({
      index: item.index,
      label: item.label,
      attachmentProperty: item.attachmentProperty,
      capacityLbs: tankDefinition.capacityLbs,
      dryWeightLbs: tankDefinition.dryWeightLbs,
      locationIn: item.locationIn,
    })));
  }
}
