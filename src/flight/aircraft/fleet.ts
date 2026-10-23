import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { SF50_VARIANTS } from "@0sfs/sf-50/sf50Variants";
import { getEngineExhaustOpticalProfile } from "@0sfs/exhaust/engineExhaustProfiles";
import { F135_ENGINE_GEOMETRY } from "@0sfs/f135/generated/f135EngineData";
import { F135_ENGINE_GAS_SUPPORT } from "./f135Installation";
import {
  registerAircraftFleet,
  type AircraftDefinition,
  type AircraftFamilyDefinition,
  type AircraftFamilyVariantDefinition,
  type AircraftLodDefinition,
  type AircraftModelCredit,
} from "@0sfs/aircraft/aircraftCatalog";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";

/**
 * The fleet this simulator flies: every aircraft family and package, assembled
 * from the aircraft packs and registered with the aircraft catalog when this
 * module is evaluated. Import it before anything reads the catalog.
 */

/** Drop each visual root to align with its profile's settled ground stance. */
const modelOffsetY = (id: AircraftId): number => -getFdmProfile(id).stance.staticMeters;

const PROCEDURAL: AircraftModelCredit = {
  artist: "felipegalin0",
  note: "Measured reconstruction, designed explicitly for max runtime speed.",
};

const THUMBNAIL_CREDIT: AircraftModelCredit = {
  artist: PROCEDURAL.artist,
  note: "Static render of the existing procedural LOD3 aircraft mesh.",
};

const F35B_CREDIT: AircraftModelCredit = {
  artist: "AF267",
  note: "Sketchfab model, converted from the author's Blender source.",
  licence: "CC BY 4.0",
  sourceUrl: "https://sketchfab.com/3d-models/lockheed-martin-f-35b-lightning-ii-5d54a6af45974ad386ae74d42b33374a",
};

const SF50_FAMILY_VARIANTS: readonly AircraftFamilyVariantDefinition[] = [
  ...SF50_VARIANTS.map((variant): AircraftFamilyVariantDefinition => ({
    id: variant.id,
    aircraftId: variant.aircraftId,
    label: variant.id.toUpperCase(),
  })),
  { id: "g2+", aircraftId: "cirrus-vision-jet-g2", label: "G2+" },
];

/** Family cards choose an airframe; variants below the gallery choose its package. */
const AIRCRAFT_FAMILIES: readonly AircraftFamilyDefinition[] = [
  {
    id: "cessna-172",
    label: "Cessna 172 Skyhawk",
    summary: "High-wing trainer. Flight model and visuals both available.",
    thumbnail: { path: "aircraft/thumbnails/cessna-172.png", credit: THUMBNAIL_CREDIT },
    defaultAircraftId: "cessna-172",
    variants: [{ id: "cessna-172", aircraftId: "cessna-172", label: "Cessna 172 Skyhawk" }],
  },
  {
    id: "cirrus-vision-jet",
    label: "Cirrus Vision Jet",
    summary: "Single-engine personal jet. G1, G2, G2+ and G3 variants.",
    thumbnail: { path: "aircraft/thumbnails/cirrus-vision-jet.png", credit: THUMBNAIL_CREDIT },
    defaultAircraftId: "cirrus-vision-jet",
    variants: SF50_FAMILY_VARIANTS,
    variantLabel: "Generation",
    developmentNote: "G1, G2 and G3 have separate runtime packages. G2+ is currently mapped to the G2 runtime while separate physics/package support is not yet implemented. Choosing a generation does not provide calibrated generation-specific performance, a new cabin or complete generation-specific avionics.",
  },
  {
    id: "f-35b",
    label: "Lockheed Martin F-35B Lightning II",
    summary: "STOVL fighter. Experimental flight model and AF267 exterior model.",
    thumbnail: {
      path: "aircraft/thumbnails/f-35b.png",
      credit: { ...F35B_CREDIT, note: "Static render of AF267's F-35B model." },
    },
    defaultAircraftId: "f-35b",
    variants: [{ id: "f-35b", aircraftId: "f-35b", label: "F-35B" }],
    developmentNote: "Experimental F-16/Aeromatic-derived JSBSim flight model. F-35B performance and STOVL behavior are not validated.",
  },
];

/**
 * https://sketchfab.com/3d-models/cirrus-vision-sf50-d46dd06b4b5646acaed90993db34d639
 * CC Attribution, so it ships with the credit shown in the panel. Aligned to
 * the POH three view by
 * planes/Cirrus_Vision_Jet/agent_workspace/scripts/reorient_ref.py and put
 * into the export convention by prepare_third_party.py, which is why it lands
 * in the same place as ours; nothing about its geometry was touched.
 */
const HILOS_RUN: AircraftModelCredit = {
  artist: "hilos run",
  note: "Sketchfab model, textured. Higher detail, but modelled gear-up.",
  licence: "CC Attribution",
  sourceUrl:
    "https://sketchfab.com/3d-models/cirrus-vision-sf50-d46dd06b4b5646acaed90993db34d639",
};

const CIRRUS_LODS: readonly AircraftLodDefinition[] = [
  // Loaded only when chosen: 3.4 MB of textured mesh, and a licence to honour.
  { id: "hd", label: "HD — highest detail", triangles: 7294, path: "aircraft/cirrus-vision-jet/Cirrus_Vision_Jet_HilosRun.glb", autoFromMeters: 0, credit: HILOS_RUN, optIn: true },
  { id: "lod3", label: "LOD3 — near", triangles: 1654, path: "aircraft/cirrus-vision-jet/Cirrus_Vision_Jet_LOD3.glb", autoFromMeters: 0, credit: PROCEDURAL },
  { id: "lod2", label: "LOD2 — medium", triangles: 926, path: "aircraft/cirrus-vision-jet/Cirrus_Vision_Jet_LOD2.glb", autoFromMeters: 65, credit: PROCEDURAL },
  // The bottom of this ladder, and it runs all the way out: there is no
  // silhouette level under it. The one that used to be there was 98 triangles,
  // and the level above it was little better - both painted their glazing on
  // as one band down each side, so the aeroplane had no windscreen at all.
  // This one cuts the windscreen and the three cabin windows as real panes,
  // which is what makes it read as this aeroplane rather than a white dart.
  { id: "lod1", label: "LOD1 — far", triangles: 438, path: "aircraft/cirrus-vision-jet/Cirrus_Vision_Jet_LOD1.glb", autoFromMeters: 170, credit: PROCEDURAL },
];

const C172_LODS: readonly AircraftLodDefinition[] = [
  { id: "lod3", label: "LOD3 — near", triangles: 1016, path: "aircraft/cessna-172/Cessna_172_LOD3.glb", autoFromMeters: 0, credit: PROCEDURAL },
  { id: "lod2", label: "LOD2 — medium", triangles: 778, path: "aircraft/cessna-172/Cessna_172_LOD2.glb", autoFromMeters: 60, credit: PROCEDURAL },
  { id: "lod1", label: "LOD1 — far", triangles: 288, path: "aircraft/cessna-172/Cessna_172_LOD1.glb", autoFromMeters: 160, credit: PROCEDURAL },
  { id: "lod0", label: "LOD0 — silhouette", triangles: 130, path: "aircraft/cessna-172/Cessna_172_LOD0.glb", autoFromMeters: 320, credit: PROCEDURAL },
];

// This is the F-35B's only exterior mesh, so Auto must be able to select it.
const F35B_LODS: readonly AircraftLodDefinition[] = [
  { id: "hd", label: "HD — reconstructed engine", triangles: F135_ENGINE_GEOMETRY.assets[2].triangles + F135_ENGINE_GEOMETRY.assets[1].triangles,
    path: F135_ENGINE_GEOMETRY.assets[2].path, autoFromMeters: 0, credit: {
      ...F35B_CREDIT, note: "Airframe from the author's Blender source (CC BY 4.0); original 0sfs engine reconstruction (AGPL-3.0-only).",
    } },
];

const AIRCRAFT_CATALOG: readonly AircraftDefinition[] = [
  {
    id: "cessna-172",
    familyId: "cessna-172",
    label: "Cessna 172 Skyhawk",
    summary: "High-wing trainer. Flight model and visuals both available.",
    modelYawRad: Math.PI,
    modelOffset: { x: 0, y: modelOffsetY("cessna-172"), z: 0 },
    propellerBlades: 2,
    lods: C172_LODS,
  },
  ...SF50_VARIANTS.map((variant): AircraftDefinition => ({
    id: variant.aircraftId,
    familyId: "cirrus-vision-jet",
    label: variant.label,
    summary: variant.summary,
    modelYawRad: Math.PI,
    modelOffset: { x: 0, y: modelOffsetY(variant.aircraftId), z: 0 },
    propellerBlades: 0,
    lods: CIRRUS_LODS,
  })),
  {
    id: "f-35b",
    familyId: "f-35b",
    label: "Lockheed Martin F-35B Lightning II",
    summary: "STOVL fighter. Experimental flight model and AF267 exterior model.",
    modelYawRad: Math.PI,
    modelOffset: { x: 0, y: modelOffsetY("f-35b"), z: 0 },
    // Geometry fit inside AF267's canopy, behind its panel; not a published
    // pilot-eye datum. The exported mesh's coordinates are ground-relative.
    cockpitOffset: { x: 0, y: 3.18098 + modelOffsetY("f-35b"), z: 6.30018 },
    cockpitMesh: true,
    // AF267's canopy: dark gold, half opaque as authored.
    windowMaterialNames: ["window"],
    // The touchscreen across the instrument panel, 0.54 m by 0.23 m.
    screenMaterialNames: ["panel"],
    nozzlePositionEngineIndex: 0,
    engineTestNodeNames: ["F135_Engine"],
    engineAssets: {
      full: F135_ENGINE_GEOMETRY.assets[0], installed: F135_ENGINE_GEOMETRY.assets[1],
      rig: { bearingNames: ["F135_Bearing1", "F135_Bearing2", "F135_Bearing3"],
        bearingInclinationRad: F135_ENGINE_GEOMETRY.bearingTiltDegrees * Math.PI / 180,
        apertureMechanism: F135_ENGINE_GEOMETRY.aperture },
    },
    // Whole-engine framing; both exports have identical authored placement.
    engineTestFocusOffset: { x: 0, y: F135_ENGINE_GEOMETRY.attachment[1] + modelOffsetY("f-35b"), z: -1.66 },
    stowedGearNodeNames: [
      "leftGear", "leftPiston", "leftStrutT", "leftSuspension", "leftStrutB", "leftWheel",
      "rightGear", "rightPiston", "rightStrutT", "rightSuspension", "rightStrutB", "rightWheel",
      "noseGear", "nosePiston", "noseStrutT", "noseSuspension", "noseStrutB", "noseWheel",
    ],
    afterburner: {
      engineIndices: [0],
      accentColor: getEngineExhaustOpticalProfile("f135-visible-approximation-v1")!.hudAccentHex,
    },
    exhaustSources: [{
      id: "main-exhaust", engineIndex: 0, opticalProfileId: "f135-visible-approximation-v1",
      attachmentNode: "F135_Exhaust", exitPosition: [0, 0, 0], direction: [0, 0, 1],
      gasSupport: F135_ENGINE_GAS_SUPPORT,
      hotSurfaceAttachmentNode: "F135_Engine",
      hotSurfaceTemperature: { property: "propulsion/engine[0]/thermal/metal-temperature-k", unit: "K",
        availableWhen: ["propulsion/engine[0]/thermal/initialized", "propulsion/engine[0]/thermal/valid"] },
      hotSurfaceRegions: [
        { materialNames: ["F135_CoreHot"], temperature: {
          property: "propulsion/engine[0]/thermal/core/metal-temperature-k", unit: "K",
          availableWhen: ["propulsion/engine[0]/thermal/core/initialized", "propulsion/engine[0]/thermal/valid"],
        } },
        { materialNames: ["F135_LinerHot"], temperature: {
          property: "propulsion/engine[0]/thermal/metal-temperature-k", unit: "K",
          availableWhen: ["propulsion/engine[0]/thermal/initialized", "propulsion/engine[0]/thermal/valid"],
        } },
      ],
      gasTemperature: { property: "propulsion/engine[0]/thermal/nozzle-gas-temperature-k", unit: "K",
        availableWhen: ["propulsion/engine[0]/thermal/valid"] },
      upstreamGasTemperature: { property: "propulsion/engine[0]/egt-degc", unit: "degC",
        availableWhen: ["propulsion/engine[0]/thermal/valid"] },
      smokeProfileId: "faint-aircraft-aerosol-v1",
      // Exit A9 visual geometry, not the separately authored throat A8 or native FADEC area.
      closedRadiusMeters: F135_ENGINE_GEOMETRY.closedExitRadius, openRadiusMeters: F135_ENGINE_GEOMETRY.openExitRadius, lengthMeters: 6,
      powerProperty: "propulsion/engine[0]/n2", powerFullScale: 100,
      fuelFlowProperty: "propulsion/engine[0]/fuel-flow-rate-pps",
      afterburnerBurnedFuelFlowProperty: "propulsion/engine[0]/thermal/afterburner-burned-fuel-flow-kg-sec",
    }],
    propellerBlades: 0,
    lods: F35B_LODS,
  },
];

registerAircraftFleet(AIRCRAFT_FAMILIES, AIRCRAFT_CATALOG);
