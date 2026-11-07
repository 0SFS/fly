import type { ControlArbiterFlight } from "@0sfs/autopilot/controlArbiter";

/**
 * What every physics step reads before it writes the controls, in two
 * batches. The first is read where the control arbiter reads the aircraft:
 * the first three contacts' weight on wheels, attitude, body rates and
 * calibrated airspeed, then the dynamic pressure and true airspeed the
 * auto-trims read after the arbiter. The second comes after the engine's
 * start and stop writes, for the auto-trims and automatic flaps.
 */
export const STEP_FLIGHT_PATHS = [
  "gear/unit[0]/WOW", "gear/unit[1]/WOW", "gear/unit[2]/WOW",
  "attitude/phi-deg", "velocities/p-rad_sec",
  "attitude/theta-deg", "velocities/q-rad_sec",
  "attitude/psi-deg", "velocities/r-rad_sec",
  "velocities/vc-kts", "aero/qbar-psf", "velocities/vt-fps",
] as const;

export const TRIM_FLIGHT_PATHS = [
  "accelerations/qdot-rad_sec2", "velocities/q-rad_sec",
  "accelerations/pdot-rad_sec2", "velocities/p-rad_sec",
  "velocities/vc-kts",
] as const;

export interface StepFlight extends ControlArbiterFlight {
  qbarPsf: number;
  vtFps: number;
}

export interface TrimFlight {
  pitchAccelRad: number;
  pitchRateRad: number;
  rollAccelRad: number;
  rollRateRad: number;
  airspeedKts: number;
}

const weightOnWheel = (wow: number): boolean => Number.isFinite(wow) && wow > 0.5;

/** The step's flight state from `STEP_FLIGHT_PATHS`' values, in their order. */
export function stepFlightFrom(value: ArrayLike<number>, dt: number): StepFlight {
  return {
    dt,
    onGround: weightOnWheel(value[0]!) || weightOnWheel(value[1]!) || weightOnWheel(value[2]!),
    rollRad: value[3]! * Math.PI / 180,
    rollRateRad: value[4]!,
    pitchRad: value[5]! * Math.PI / 180,
    pitchRateRad: value[6]!,
    headingRad: value[7]! * Math.PI / 180,
    yawRateRad: value[8]!,
    airspeedKts: value[9]!,
    qbarPsf: value[10]!,
    vtFps: value[11]!,
  };
}

/** The auto-trims' and automatic flaps' readings from `TRIM_FLIGHT_PATHS`' values, in their order. */
export function trimFlightFrom(value: ArrayLike<number>): TrimFlight {
  return {
    pitchAccelRad: value[0]!,
    pitchRateRad: value[1]!,
    rollAccelRad: value[2]!,
    rollRateRad: value[3]!,
    airspeedKts: value[4]!,
  };
}
