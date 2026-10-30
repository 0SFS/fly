import {
  registerAircraftFleet,
  type AircraftDefinition,
  type AircraftFamilyDefinition,
} from "@0sfs/aircraft/aircraftCatalog";
import { registerEngine } from "@0sfs/engines/engineRegistry";
import { registerExternalTanks } from "@0sfs/fuel/externalTankDefinitions";
import { installAudioMod } from "@0sfs/sound/installAudioMod";
import type { ModEngineContribution } from "@0sfs/mods/schema";
import { registerPayloadInstallation } from "@0sfs/stores/stationTable";
import { applyStoreClearance, registerPayloadStore, registerRefusedStore, registerStorePresets } from "@0sfs/stores/storeCatalog";
import type { StoreCard } from "@0sfs/stores/storeCatalog";
import { F135_ENGINE_GAS_SUPPORT } from "../aircraft/f135Installation";
import { BUNDLED_MODS } from "./bundledMods";
import { BUILTIN_AIRCRAFT_MODS } from "./builtinAircraftMods";

/**
 * Catalogue order. The landing page checks that one flight script lists these
 * thumbnails in this order, with each family's label, summary and note.
 */
export const BUILTIN_FAMILY_THUMBNAILS = [
  "aircraft/thumbnails/cessna-172.png",
  "aircraft/thumbnails/cirrus-vision-jet.png",
  "aircraft/thumbnails/f-35b.png",
] as const;

interface EngineMod { id: string; engine: ModEngineContribution }

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

const manifests = BUNDLED_MODS.map(([, manifest]) => manifest);
for (const manifest of manifests) installAudioMod(manifest, { bundled: true });
const aircraftMods = BUILTIN_AIRCRAFT_MODS as unknown as AircraftMod[];
const families = aircraftMods.map(mod => mod.aircraft.family);
for (const [index, family] of families.entries()) {
  const thumbnail = family.thumbnail?.path;
  if (thumbnail !== BUILTIN_FAMILY_THUMBNAILS[index]) {
    throw new Error(`Aircraft family ${family.id} thumbnail is ${thumbnail}, expected ${BUILTIN_FAMILY_THUMBNAILS[index]}.`);
  }
}
registerAircraftFleet(families, aircraftMods.flatMap(mod => mod.aircraft.definitions));

for (const mod of manifests.filter(manifest => manifest.kind === "engine") as unknown as EngineMod[]) {
  const engine = mod.engine;
  registerEngine(engine, mod.id);

}

const payloads = manifests.filter(manifest => manifest.kind === "payload");
const stores = payloads.filter(manifest => manifest.payload?.payloadType === "store") as unknown as StoreMod[];
const tanks = payloads.filter(manifest => manifest.payload?.payloadType === "external-tank") as unknown as TankMod[];
stores.sort((left, right) => (left.payload?.store?.id ?? 0) - (right.payload?.store?.id ?? 0));
for (const mod of stores) {
  if (mod.payload?.store) registerPayloadStore(mod.payload.store);
}

for (const mod of aircraftMods) {
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
  const externalTanks = (installation.externalTankInstallations ?? []).flatMap(item => {
    const tank = tanks.find(mod => mod.payload?.tank?.key === item.tankKey)?.payload?.tank;
    return tank ? [{
      index: item.index,
      label: item.label,
      attachmentProperty: item.attachmentProperty,
      capacityLbs: tank.capacityLbs,
      dryWeightLbs: tank.dryWeightLbs,
      locationIn: item.locationIn,
    }] : [];
  });
  if (externalTanks.length) {
    for (const id of Object.keys(mod.aircraft.fdmProfiles)) registerExternalTanks(id, externalTanks);
  }
}
