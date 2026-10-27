/**
 * One-shot exporter. Run while the TypeScript catalogs still hold the data:
 *   OSFS_WRITE_MODS=1 npx vitest run src/flight/mods/exportBuiltinMods.test.ts
 * Writes public/0sfs-mod.json for the official aircraft, engines and payloads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AIRCRAFT_CATALOG, AIRCRAFT_FAMILIES } from "@0sfs/aircraft/aircraftCatalog";
import { F135_ENGINE_GEOMETRY } from "@0sfs/f135/generated/f135EngineData";
import { F135_DEFINITION, FJ33_DEFINITION, IO320_DEFINITION } from "@0sfs/sound/engineAcousticDefinitions";
import { C172_ROTOR_BLADES, F135_ROTOR_BLADES, FJ33_ROTOR_BLADES } from "@0sfs/engines/engineRotorDefinitions";
import { STORE_CARDS, STORE_PRESETS, WEAPON_PAYLOAD_LIMIT_LBS } from "@0sfs/stores/storeCatalog";
import {
  BAY_DOOR_FIT, BAYS, DOOR_FULL_TRAVEL_SECONDS, DOOR_OPEN_RAD, F35B_STRUCTURAL_REFERENCE_IN,
  INTERNAL_STORE_VISIBLE_AT, STATIONS, STORE_MESH_FITS,
} from "@0sfs/stores/stationTable";
import { F35B_STRUCTURAL_REFERENCE_IN as FUEL_REFERENCE, getExternalTankDefinitions } from "@0sfs/fuel/externalTankDefinitions";
import { FDM_PROFILES } from "../jsbsim/fdmProfiles";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";

const org = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const provenance = (repo: string, license = "AGPL-3.0-only", noticeFiles?: string[]) => ({
  repository: `https://github.com/0SFS/${repo}`,
  owner: "0SFS",
  license,
  authors: ["0SFS contributors"],
  ...(noticeFiles ? { noticeFiles } : {}),
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "bodyCollisionProbes" ? undefined : item)) as T;
}

function write(repo: string, manifest: unknown): void {
  const file = path.join(org, repo, "public", "0sfs-mod.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
}

const JSBSIM = {
  c172: ["aircraft/c172p/c172p.xml", "aircraft/c172p/reset00.xml", "aircraft/c172p/reset01.xml"],
  io320: ["engine/eng_io320.xml", "engine/prop_75in2f.xml"],
  sf50: ["aircraft/sf50/sf50.xml"],
  sf50g2: ["aircraft/sf50-g2/sf50-g2.xml"],
  sf50g3: ["aircraft/sf50-g3/sf50-g3.xml"],
  fj33: ["engine/fj33_5a.xml", "engine/direct.xml"],
  f35b: [
    "aircraft/F-35B-jsbsim/F-35B-jsbsim.xml",
    "aircraft/F-35B-jsbsim/Systems/pushback.xml",
    "aircraft/F-35B-jsbsim/Engines/direct.xml",
  ],
  f35bEmpirical: [
    "aircraft/F-35B-jsbsim-empirical/F-35B-jsbsim-empirical.xml",
    "aircraft/F-35B-jsbsim-empirical/Engines/liftfan.xml",
    "aircraft/F-35B-jsbsim-empirical/Engines/sidefan.xml",
  ],
  f135: [
    "aircraft/F-35B-jsbsim/Engines/F135-PW-600.xml",
    "aircraft/F-35B-jsbsim-empirical/Engines/F135-PW-600.xml",
  ],
};

describe("export builtin mod manifests", () => {
  it.skipIf(!process.env.OSFS_WRITE_MODS)("writes the official manifests from the live catalogs", () => {
    expect(process.env.OSFS_WRITE_MODS).toBe("1");
    const byFamily = new Map(AIRCRAFT_FAMILIES.map(family => [family.id, family]));
    const definitions = (familyId: string) => AIRCRAFT_CATALOG.filter(entry => entry.familyId === familyId);
    const profiles = (ids: readonly AircraftId[]) => Object.fromEntries(ids.map(id => [id, clone(FDM_PROFILES[id])]));

    write("C172", {
      schemaVersion: 1, id: "0sfs/c172", kind: "aircraft", name: "Cessna 172 Skyhawk",
      summary: byFamily.get("cessna-172")!.summary, execution: "declarative",
      provenance: provenance("C172"), dependencies: ["0SFS/IO320"],
      jsbsimFiles: JSBSIM.c172,
      aircraft: {
        family: clone(byFamily.get("cessna-172")),
        definitions: clone(definitions("cessna-172")),
        fdmProfiles: profiles(["cessna-172"]),
        audio: { engineDefinitionId: "io320-piston" },
      },
    });

    write("SF-50", {
      schemaVersion: 1, id: "0sfs/sf-50", kind: "aircraft", name: "Cirrus Vision Jet",
      summary: byFamily.get("cirrus-vision-jet")!.summary, execution: "declarative",
      provenance: provenance("SF-50"), dependencies: ["0SFS/FJ33"],
      jsbsimFiles: [...JSBSIM.sf50, ...JSBSIM.sf50g2, ...JSBSIM.sf50g3],
      aircraft: {
        family: clone(byFamily.get("cirrus-vision-jet")),
        definitions: clone(definitions("cirrus-vision-jet")),
        fdmProfiles: profiles(["cirrus-vision-jet", "cirrus-vision-jet-g2", "cirrus-vision-jet-g3"]),
        audio: { engineDefinitionId: "fj33-reference" },
      },
    });

    const clearances: Record<string, { stations: number[]; ratingException: { stations: readonly number[]; cellLbs: number } | null }> = {};
    const refused = [];
    for (const card of STORE_CARDS) {
      if (!card.selectable) {
        refused.push({ key: card.key, label: card.label, refusal: card.refusal });
        continue;
      }
      clearances[card.key] = { stations: [...card.stations], ratingException: card.ratingException ? clone(card.ratingException) : null };
    }
    const tanks = getExternalTankDefinitions("f-35b");
    write("F-35B", {
      schemaVersion: 1, id: "0sfs/f-35b", kind: "aircraft", name: "Lockheed Martin F-35B Lightning II",
      summary: byFamily.get("f-35b")!.summary, execution: "declarative",
      provenance: provenance("F-35B"),
      dependencies: ["0SFS/F135", "0SFS/F-35B-external-tank", "0SFS/AIM-120", "0SFS/GBU-12", "0SFS/GBU-32", "0SFS/AIM-9X", "0SFS/ASRAAM", "0SFS/Paveway-IV", "0SFS/GAU-22-pod"],
      jsbsimFiles: [...JSBSIM.f35b, ...JSBSIM.f35bEmpirical],
      aircraft: {
        family: clone(byFamily.get("f-35b")),
        definitions: clone(definitions("f-35b")),
        fdmProfiles: profiles(["f-35b"]),
        audio: { engineDefinitionId: "f135-approximation" },
        payloadInstallation: {
          structuralReferenceIn: clone(F35B_STRUCTURAL_REFERENCE_IN),
          weaponPayloadLimitLbs: WEAPON_PAYLOAD_LIMIT_LBS,
          stations: clone(STATIONS),
          stationClearances: clearances,
          refusedStores: refused,
          meshFits: clone(STORE_MESH_FITS),
          presets: clone(STORE_PRESETS),
          externalTankInstallations: tanks.map(tank => ({
            tankKey: "f-35b-425gal-tank", index: tank.index, label: tank.label,
            attachmentProperty: tank.attachmentProperty, locationIn: clone(tank.locationIn),
          })),
          bayDoors: {
            bays: clone(BAYS), fit: clone(BAY_DOOR_FIT),
            doorOpenRad: DOOR_OPEN_RAD, doorFullTravelSeconds: DOOR_FULL_TRAVEL_SECONDS,
            internalStoreVisibleAt: INTERNAL_STORE_VISIBLE_AT,
          },
        },
      },
    });

    const acoustic = (definition: { id: string; engineClass: string; manufacturerFamily: string; rendererId: string; label: string; approximation: string; parameters: unknown; telemetry: { id: string } }) => ({
      id: definition.id, engineClass: definition.engineClass, manufacturerFamily: definition.manufacturerFamily,
      rendererId: definition.rendererId, telemetryId: definition.telemetry.id, label: definition.label,
      approximation: definition.approximation, parameters: clone(definition.parameters),
    });
    const assets = F135_ENGINE_GEOMETRY.assets;
    write("IO320", {
      schemaVersion: 1, id: "0sfs/io320", kind: "engine", name: "Lycoming IO-320",
      summary: "The piston and propeller installed on the Cessna 172.", execution: "declarative",
      provenance: provenance("IO320"), jsbsimFiles: JSBSIM.io320,
      engine: {
        id: "io320", label: "Lycoming IO-320", summary: "Four-cylinder piston with the 75 in two-blade propeller.", type: "piston",
        jsbsimEngineFiles: JSBSIM.io320, rotorBlades: clone(C172_ROTOR_BLADES),
        startSpeed: { property: "propulsion/engine[0]/engine-rpm", runningAt: 0.8 * 550 },
        maxEngineRpm: 2700,
        gauges: { primary: "propulsion/engine[0]/propeller-rpm", secondary: "propulsion/engine[0]/engine-rpm", label: "RPM" },
        acousticProfile: acoustic(IO320_DEFINITION),
      },
    });
    write("FJ33", {
      schemaVersion: 1, id: "0sfs/fj33", kind: "engine", name: "Williams FJ33-5A",
      summary: "The turbofan installed on the Cirrus Vision Jet.", execution: "declarative",
      provenance: provenance("FJ33"), jsbsimFiles: JSBSIM.fj33,
      engine: {
        id: "fj33-5a", label: "Williams FJ33-5A", summary: "Single turbofan used by every Vision Jet generation.", type: "turbine",
        jsbsimEngineFiles: JSBSIM.fj33, rotorBlades: clone(FJ33_ROTOR_BLADES),
        startSpeed: { property: "propulsion/engine[0]/n2", runningAt: 53.4 },
        gauges: { primary: "propulsion/engine[0]/n1", secondary: "propulsion/engine[0]/n2", label: "N1 %" },
        acousticProfile: acoustic(FJ33_DEFINITION),
      },
    });
    write("F135", {
      schemaVersion: 1, id: "0sfs/f135", kind: "engine", name: "Pratt & Whitney F135-PW-600",
      summary: "The STOVL engine installed on the F-35B.", execution: "declarative",
      provenance: provenance("F135"), jsbsimFiles: JSBSIM.f135,
      engine: {
        id: "f135-pw-600", label: "Pratt & Whitney F135-PW-600", summary: "Coupled engine plant and the earlier empirical turbine.", type: "turbine",
        jsbsimEngineFiles: JSBSIM.f135, rotorBlades: clone(F135_ROTOR_BLADES),
        startSpeed: { property: "propulsion/engine[0]/n2", runningAt: 60 },
        gauges: { primary: "propulsion/engine[0]/n1", secondary: "propulsion/engine[0]/n2", label: "N1 %" },
        engineAssets: {
          full: { path: assets[0].path, triangles: assets[0].triangles },
          installed: { path: assets[1].path, triangles: assets[1].triangles },
          rig: {
            bearingNames: ["F135_Bearing1", "F135_Bearing2", "F135_Bearing3"],
            bearingInclinationDeg: F135_ENGINE_GEOMETRY.bearingTiltDegrees,
            aperture: clone(F135_ENGINE_GEOMETRY.aperture),
          },
        },
        exhaustOpticalProfiles: [{ id: "f135-visible-approximation-v1", hudAccentHex: "#ff985f" }],
        acousticProfile: acoustic(F135_DEFINITION),
      },
    });

    const payloads: { repo: string; id: string; name: string; summary: string; store: Record<string, unknown> }[] = [];
    for (const card of STORE_CARDS) {
      if (!card.selectable) continue;
      const repo = card.key === "gau-22-pod" ? "GAU-22-pod"
        : card.key === "paveway-iv" ? "Paveway-IV"
          : card.key === "aim-120" ? "AIM-120"
            : card.key === "aim-9x" ? "AIM-9X"
              : card.key === "gbu-12" ? "GBU-12"
                : card.key === "gbu-32" ? "GBU-32"
                  : "ASRAAM";
      payloads.push({
        repo, id: `0sfs/${card.key}`, name: card.label, summary: card.massNote ?? card.label,
        store: {
          id: card.id, key: card.key, label: card.label, massLbs: card.massLbs, dragAreaFt2: card.dragAreaFt2,
          lengthM: card.lengthM, diameterM: card.diameterM, spanM: card.spanM, boxM: card.boxM,
          meshStandIn: card.meshStandIn, rounds: card.rounds, massNote: card.massNote,
        },
      });
    }
    for (const item of payloads) {
      write(item.repo, {
        schemaVersion: 1, id: item.id, kind: "payload", name: item.name, summary: item.summary, execution: "declarative",
        provenance: provenance(item.repo),
        payload: { payloadType: "store", store: item.store },
      });
    }
    const tank = tanks[0]!;
    write("F-35B-external-tank", {
      schemaVersion: 1, id: "0sfs/f-35b-external-tank", kind: "payload", name: "425 gal external fuel tank",
      summary: "One 425 gallon external fuel tank for the F-35B.", execution: "declarative",
      provenance: provenance("F-35B-external-tank", "GPL-3.0-only", [
        "aircraft/f-35b/ExternalTank_FlightGear.NOTICE.md",
        "aircraft/f-35b/ExternalTank_LICENSE-GPL-3.0.txt",
        "aircraft/f-35b/ExternalTank_FlightGear.provenance.json",
      ]),
      payload: {
        payloadType: "external-tank",
        tank: {
          key: "f-35b-425gal-tank", label: "425 gal external fuel tank",
          capacityLbs: tank.capacityLbs, dryWeightLbs: tank.dryWeightLbs,
          meshPath: "aircraft/f-35b/ExternalTank_FlightGear.glb",
        },
      },
    });
    expect(FUEL_REFERENCE).toEqual(F35B_STRUCTURAL_REFERENCE_IN);
    expect(payloads).toHaveLength(7);
  });
});
