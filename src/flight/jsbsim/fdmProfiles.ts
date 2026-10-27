import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import type { EngineRotorBladeCounts } from "@0sfs/engines/engineRotorDefinitions";
import type { AutomaticFlaps } from "@0sfs/controls/autoFlaps";
import type { Sf50VariantId } from "@0sfs/sf-50/sf50Variants";
import { C172_BODY_COLLISION_PROBES, F35B_BODY_COLLISION_PROBES, SF50_BODY_COLLISION_PROBES, type BodyCollisionProbe } from "@0sfs/ground-contact/collisionGeometry";
import type { ControlSurfaceTerms, ExternalForceTerms } from "@0sfs/aircraft/aircraftForces";
import type { FlightControlLawMode } from "@0sfs/controls/applyFlightControls";
import c172Manifest from "@0sfs/c172/manifest" with { type: "json" };
import sf50Manifest from "@0sfs/sf-50/manifest" with { type: "json" };
import f35bManifest from "@0sfs/f-35b/manifest" with { type: "json" };

export { CONTROL_LAW_MODE_VALUES, type FlightControlLawMode } from "@0sfs/controls/applyFlightControls";

export interface RunwayConfiguration {
  airspeedKts: number;
  throttleNorm: number;
  flapsNorm: number;
  pitchDeg: number;
}

/** How an engine is simulated: JSBSim's coupled engine plant, or its empirical tables. */
export const ENGINE_MODEL_IDS = ["plant", "empirical"] as const;
export type EngineModelId = (typeof ENGINE_MODEL_IDS)[number];

/** One way an aircraft's engine can be simulated, and the profile fields that change with it. */
export interface FdmEngineModel {
  id: EngineModelId;
  label: string;
  /** What someone flying one model after the other should know about this one. */
  summary: string;
  profile?: Partial<Pick<FdmProfile,
    "model" | "dataPackage" | "forceEngineLabels" | "forceExternalForces" | "initialProperties">>;
}

export interface FdmProfile {
  sf50VariantId?: Sf50VariantId;
  /** Published operating envelope metadata, not an artificial physics clamp. */
  maxOperatingAltitudeFt?: number;
  /** JSBSim model name: `aircraft/<model>/<model>.xml` in MEMFS. */
  model: string;
  /** Its files in public/jsbsim-data/manifest.json. Default: the aircraft id. */
  dataPackage?: string;
  /**
   * Engine models the aircraft can fly with, chosen in Engine → Simulation. The
   * first is the one the rest of this profile describes. Absent: no choice.
   */
  engineModels?: readonly FdmEngineModel[];
  /** Model-local dependency directories, relative to the SDK data root. */
  dataPaths?: { enginePath: string; systemsPath: string };
  /** Optional pilot conversion command and the physical conversion position. */
  stovl?: { commandProperty: string; positionProperty: string };
  /** Native aircraft control law; absent aircraft keep their own direct controls. */
  controlLaw?: {
    commandProperty: string;
    enabledProperty: string;
    automaticMode: Exclude<FlightControlLawMode, "auto">;
  };
  /**
   * A fly-by-wire roll-rate command: the native property holding the rate full
   * stick asks for, deg/s, and the source model's own, which an autopilot flies.
   */
  fullStickRollRate?: { property: string; sourceDegPerSec: number };
  engine: "piston" | "turbine";
  /** Rated piston RPM for its instrument scale; turbine limits are read from the native engine. */
  maxEngineRpm?: number;
  /** Representative rotor-row marker counts, with explicit evidence status. */
  rotorBlades?: EngineRotorBladeCounts;
  /**
   * The shaft speed at which JSBSim calls a start finished, which the
   * throttle's start ring fills toward: a turbine runs once N2 reaches its
   * idle N2, and a piston with spark and fuel runs above 80% of its idle RPM.
   * Both come from the engine's definition file.
   */
  startSpeed: { property: string; runningAt: number };
  /** Optional diagnostic names; native engine indices and force data remain authoritative. */
  forceEngineLabels?: Readonly<Record<number, string>>;
  /**
   * Each control surface's own aerodynamic terms in the model, for Debug → Forces.
   * Only increments that vanish with the surface centred belong here, never a
   * whole-wing table or a derivative the surface schedules. fdmProfiles.test.ts
   * holds every term, and every surface-dependent term left out, to the model file.
   */
  forceControlSurfaces: readonly ControlSurfaceTerms[];
  /** External forces Debug → Forces draws, such as engine outlets the model applies outside the engine. */
  forceExternalForces?: readonly ExternalForceTerms[];
  /** Sign applied to the normalized yaw command at the physics boundary. */
  rudderSign: 1 | -1;
  stance: {
    staticMeters: number;
    staticPitchRad: number;
    pitchArmMeters: number;
    rollArmMeters: number;
  };
  /** Property spellings the HUD reads for this engine type. */
  gauges: {
    primary: string;
    secondary: string | null;
    label: string;
  };
  initialThrottleNorm: number;
  /** Development airborne start; not an aircraft operating limit. */
  initialAirspeedKts?: number;
  /** Initial attitude/trim for the aircraft's airborne development start. */
  initialPitchDeg?: number;
  /** Aircraft-specific controls restored before zero-time engine initialization. */
  initialProperties?: Readonly<Record<string, number>>;
  /** Native getter-only observations required to evaluate this aircraft model. */
  requiredReadOnlyModelProperties?: readonly string[];
  initialGearDown: boolean;
  flapPosition: { property: string; fullTravel: number; minNorm?: number };
  /** Native automation or an explicitly simulated pilot assist, never a shared aircraft law. */
  automaticFlaps: AutomaticFlaps;
  runwayPresets: Record<"departure" | "arrival", RunwayConfiguration>;
  bodyCollisionProbes: readonly BodyCollisionProbe[];
}

/** Ground-contact probes stay on the flight profile. The rest of each profile comes from its aircraft mod. */
const BODY_COLLISION_PROBES: Partial<Record<AircraftId, readonly BodyCollisionProbe[]>> = {
  "cessna-172": C172_BODY_COLLISION_PROBES,
  "cirrus-vision-jet": SF50_BODY_COLLISION_PROBES,
  "cirrus-vision-jet-g2": SF50_BODY_COLLISION_PROBES,
  "cirrus-vision-jet-g3": SF50_BODY_COLLISION_PROBES,
  "f-35b": F35B_BODY_COLLISION_PROBES,
};

interface AircraftModFile {
  aircraft?: { fdmProfiles?: Record<string, Omit<FdmProfile, "bodyCollisionProbes">> };
}

export const FDM_PROFILES = {} as Record<AircraftId, FdmProfile>;

/** Adds an aircraft mod's flight profiles, attaching the probes this build already has for that id. */
export function registerFdmProfile(id: AircraftId, profile: Omit<FdmProfile, "bodyCollisionProbes"> & { bodyCollisionProbes?: readonly BodyCollisionProbe[] }): void {
  FDM_PROFILES[id] = { ...profile, bodyCollisionProbes: profile.bodyCollisionProbes ?? BODY_COLLISION_PROBES[id] ?? [] };
}

function installManifestProfiles(manifest: AircraftModFile): void {
  for (const [id, profile] of Object.entries(manifest.aircraft?.fdmProfiles ?? {})) {
    registerFdmProfile(id as AircraftId, profile);
  }
}

installManifestProfiles(c172Manifest as unknown as AircraftModFile);
installManifestProfiles(sf50Manifest as unknown as AircraftModFile);
installManifestProfiles(f35bManifest as unknown as AircraftModFile);

export function resolveEngineModel(aircraftId: AircraftId, requested?: EngineModelId): FdmEngineModel | null {
  const offered = FDM_PROFILES[aircraftId].engineModels;
  return offered?.find(model => model.id === requested) ?? offered?.[0] ?? null;
}

const engineModelProfiles = new Map<string, FdmProfile>();

/** The aircraft's profile, with the fields its engine model changes. */
export function getFdmProfile(aircraftId: AircraftId, engineModel?: EngineModelId): FdmProfile {
  const base = FDM_PROFILES[aircraftId];
  const chosen = resolveEngineModel(aircraftId, engineModel);
  if (!chosen?.profile) return base;
  const key = aircraftId + "|" + chosen.id;
  let profile = engineModelProfiles.get(key);
  if (!profile) engineModelProfiles.set(key, profile = { ...base, ...chosen.profile });
  return profile;
}
