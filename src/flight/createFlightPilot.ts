import type { NumberRange } from "foss-earth/settings";
import { CurveResponse, curveProfile } from "@0sfs/g-forces/curveResponse";
import {
  EXPOSURE_PROTECTED, EXPOSURE_RELAXED, EXPOSURE_SUIT, ExposureResponse, type ExposureProfile,
} from "@0sfs/g-forces/exposureResponse";
import type { GVisionSettings, PassOutSettings } from "@0sfs/g-forces/gForce";
import {
  PERFUSION_PROTECTED, PERFUSION_RELAXED, PERFUSION_SUIT, PerfusionResponse, type PerfusionProfile,
} from "@0sfs/g-forces/perfusionResponse";
import { visionClosure, type PilotResponseKind, type PilotResponseModel } from "@0sfs/g-forces/pilotResponse";
import type { FlightParameterStore } from "./settings/flightParameters";

/**
 * The flight's pilot: one of the g-forces response models, advanced once per
 * accepted physics step with that step's load and simulated duration, read by
 * the frame for the vignettes and by the next step's controls. The model is
 * the flight's; a change of model applies to the next flight, because the
 * models' states do not translate. Edits within a model keep the pilot's
 * state: they never grant a recovery.
 *
 * Passing out is opt-in for every model. Curve passes out on its own timer
 * only when it is on; Exposure and Perfusion always follow consciousness, and
 * the pilot lets go of the controls only while passing out is on.
 */

export type { PilotResponseKind };
export type PilotProtection = "relaxed" | "suit" | "suit-strain";

export interface FlightPilotSettings {
  /** Curve's thresholds and times; its redout range is every model's. */
  curve: GVisionSettings;
  /** Off, or on; the time out is Curve's alone; the others decide it themselves. */
  passOut: PassOutSettings | null;
  exposure: PilotProtection;
  perfusion: PilotProtection;
}

/** The settings that change the flight's pilot without a new flight. */
export const PILOT_PARAMETER_IDS = [
  "osfs.gForce.blackoutRange", "osfs.gForce.redoutRange", "osfs.gForce.onsetTime", "osfs.gForce.recoveryTime",
  "osfs.gForce.passOut", "osfs.gForce.unconsciousTime", "osfs.gForce.unconsciousSpread",
  "osfs.gForce.exposure.pilot", "osfs.gForce.perfusion.pilot",
] as const;

export function readFlightPilotSettings(parameters: Pick<FlightParameterStore, "get">): FlightPilotSettings {
  return {
    curve: {
      blackout: parameters.get("osfs.gForce.blackoutRange"),
      redout: parameters.get("osfs.gForce.redoutRange"),
      onsetSeconds: parameters.get("osfs.gForce.onsetTime"),
      recoverySeconds: parameters.get("osfs.gForce.recoveryTime"),
    },
    passOut: parameters.get("osfs.gForce.passOut") ? {
      meanSeconds: parameters.get("osfs.gForce.unconsciousTime"),
      spreadSeconds: parameters.get("osfs.gForce.unconsciousSpread"),
    } : null,
    exposure: parameters.get("osfs.gForce.exposure.pilot"),
    perfusion: parameters.get("osfs.gForce.perfusion.pilot"),
  };
}

/** A change in whether the pilot holds the controls. */
export type PilotTransition = "passed-out" | "came-to" | null;

export interface FlightPilot {
  readonly kind: PilotResponseKind;
  /** The parameter set the model runs, versioned, for logs and recordings. */
  profileId(): string;
  /** One accepted physics step: the load at the pilot's seat, in g, held for `stepSeconds` of simulated time. */
  step(pilotG: number, stepSeconds: number): PilotTransition;
  /** Unconscious with passing out on: the pilot sees nothing and has let go of the stick, pedals and brakes. */
  isOut(): boolean;
  /** How far the black vignette closes, 0 to 1. */
  blackout(): number;
  /** How far the red vignette closes, 0 to 1. */
  redout(): number;
  /** New settings within the model. The pilot keeps their state; turning passing out off wakes them. */
  configure(settings: FlightPilotSettings): PilotTransition;
  /** Rested and conscious. */
  reset(): void;
  /** The model's state by name. Allocates: for logs on a transition, never per step. */
  diagnostics(): Record<string, number>;
}

export function exposureProfile(protection: PilotProtection, redout: NumberRange): ExposureProfile {
  const preset = protection === "relaxed" ? EXPOSURE_RELAXED : protection === "suit" ? EXPOSURE_SUIT : EXPOSURE_PROTECTED;
  return { ...preset, redout };
}

export function perfusionProfile(protection: PilotProtection, redout: NumberRange): PerfusionProfile {
  const preset = protection === "relaxed" ? PERFUSION_RELAXED : protection === "suit" ? PERFUSION_SUIT : PERFUSION_PROTECTED;
  return { ...preset, redout };
}

/** A response model built from the flight's settings, and how to apply new ones while keeping its state. */
export interface ConfiguredPilotModel {
  readonly model: PilotResponseModel;
  /** The parameter set it runs, versioned, for logs and recordings. */
  profileId(): string;
  configure(settings: FlightPilotSettings): void;
}

/** The model the flight's pilot runs, built the same way for the flight and for a preview. */
export function createPilotModel(
  kind: PilotResponseKind, settings: FlightPilotSettings, random: () => number = Math.random,
): ConfiguredPilotModel {
  if (kind === "curve") {
    const curve = new CurveResponse(curveProfile(settings.curve), settings.passOut, random);
    return { model: curve, profileId: () => "curve@1", configure: next => curve.configure(curveProfile(next.curve), next.passOut) };
  }
  if (kind === "exposure") {
    let profile = exposureProfile(settings.exposure, settings.curve.redout);
    const exposure = new ExposureResponse(profile);
    return {
      model: exposure,
      profileId: () => profile.id,
      configure: next => { profile = exposureProfile(next.exposure, next.curve.redout); exposure.configure(profile); },
    };
  }
  let profile = perfusionProfile(settings.perfusion, settings.curve.redout);
  const perfusion = new PerfusionResponse(profile);
  return {
    model: perfusion,
    profileId: () => profile.id,
    configure: next => { profile = perfusionProfile(next.perfusion, next.curve.redout); perfusion.configure(profile); },
  };
}

export function createFlightPilot(
  kind: PilotResponseKind, initial: FlightPilotSettings, random: () => number = Math.random,
): FlightPilot {
  let settings = initial;
  const configured = createPilotModel(kind, initial, random);
  const model = configured.model;
  const output = model.output;
  const isOut = (): boolean => settings.passOut !== null && !output.conscious;
  const transition = (wasOut: boolean): PilotTransition =>
    wasOut === isOut() ? null : wasOut ? "came-to" : "passed-out";

  return {
    kind,
    profileId: configured.profileId,
    step(pilotG, stepSeconds) {
      const wasOut = isOut();
      model.step(pilotG, stepSeconds);
      return transition(wasOut);
    },
    isOut,
    blackout: () => visionClosure(output.peripheralLoss, output.centralLoss),
    redout: () => output.redout,
    configure(next) {
      const wasOut = isOut();
      settings = next;
      configured.configure(next);
      return transition(wasOut);
    },
    reset: () => model.reset(),
    diagnostics: () => model.diagnostics(),
  };
}
