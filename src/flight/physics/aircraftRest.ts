/**
 * Whether a parked aircraft has come to rest: on the ground, nothing turning,
 * nothing commanded and nothing moving for a while. At rest the flight stops
 * stepping physics and drawing frames, so a landed aircraft left alone costs
 * no power, until something can move it again: the pilot's input, another
 * player's hit, a changed setting. Waking is the caller's: it calls `wake`.
 */

export interface AircraftRestSample {
  /** Everything but motion allows rest: on the ground, engines stopped, no input held, no question pending. */
  eligible: boolean;
  /** Speed over the ground and vertically, m/s. */
  speedMetersPerSecond: number;
  /** Largest body rate, rad/s. */
  rateRadPerSecond: number;
  /** What the aircraft's model draws from the simulation: control surfaces, flaps, gear, nozzles. Compared with the previous sample's; NaN is a part it does not have. */
  pose: readonly number[];
}

export interface AircraftRestOptions {
  /** How long it must stay still before it rests, in seconds of flight. */
  holdSeconds?: number;
  maxSpeedMetersPerSecond?: number;
  maxRateRadPerSecond?: number;
  /** The fastest any pose value may change, per second, and still count as still. */
  maxPoseRatePerSecond?: number;
}

export interface AircraftRest {
  /**
   * One frame: `dtSeconds` of flight it advanced, zero when physics did not
   * step. Returns true on the frame the aircraft comes to rest.
   */
  observe(sample: AircraftRestSample, dtSeconds: number): boolean;
  isResting(): boolean;
  /** Something can move it: stop resting, and wait a whole still period again. Returns whether it was resting. */
  wake(): boolean;
}

/**
 * Measured with real JSBSim (`aircraftRest.integration.test.ts`): a parked
 * C172 and a landed, disarmed drone settle well under these within a second.
 * A centimetre a second is below what anyone sees of an aircraft on screen.
 */
export const AIRCRAFT_REST_DEFAULTS: Required<AircraftRestOptions> = {
  holdSeconds: 3,
  maxSpeedMetersPerSecond: 0.01,
  maxRateRadPerSecond: 0.005,
  maxPoseRatePerSecond: 0.005,
};

export function createAircraftRest(options: AircraftRestOptions = {}): AircraftRest {
  const limits = { ...AIRCRAFT_REST_DEFAULTS, ...options };
  let still = 0;
  let resting = false;
  let previousPose: readonly number[] | null = null;

  const poseStill = (pose: readonly number[], dt: number): boolean => {
    const previous = previousPose;
    previousPose = [...pose];
    if (!previous || previous.length !== pose.length) return false;
    for (let index = 0; index < pose.length; index++) {
      // A value it cannot read, both times, is a part it does not have.
      if (!Number.isFinite(pose[index]) && !Number.isFinite(previous[index])) continue;
      const change = Math.abs(pose[index] - previous[index]);
      if (!(change <= limits.maxPoseRatePerSecond * dt)) return false;
    }
    return true;
  };

  return {
    observe(sample, dt) {
      if (resting) return false;
      if (!sample.eligible) { still = 0; previousPose = null; return false; }
      // A frame without a step says nothing about motion.
      if (!(dt > 0)) return false;
      const moving = !(sample.speedMetersPerSecond <= limits.maxSpeedMetersPerSecond)
        || !(sample.rateRadPerSecond <= limits.maxRateRadPerSecond);
      const posed = poseStill(sample.pose, dt);
      if (moving || !posed) { still = 0; return false; }
      still += dt;
      if (still < limits.holdSeconds) return false;
      resting = true;
      return true;
    },
    isResting: () => resting,
    wake() {
      const was = resting;
      resting = false;
      still = 0;
      previousPose = null;
      return was;
    },
  };
}

/** The motion JSBSim reports, as a rest sample's speed and rate. */
export function readAircraftMotion(sdk: { getPropertyValue(name: string): number }):
  Pick<AircraftRestSample, "speedMetersPerSecond" | "rateRadPerSecond"> {
  const read = (name: string): number => {
    const value = sdk.getPropertyValue(name);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  return {
    speedMetersPerSecond: Math.hypot(read("velocities/vg-fps"), read("velocities/v-down-fps")) * 0.3048,
    rateRadPerSecond: Math.max(Math.abs(read("velocities/p-rad_sec")), Math.abs(read("velocities/q-rad_sec")),
      Math.abs(read("velocities/r-rad_sec"))),
  };
}

/**
 * Whether any of these JSBSim engines runs or still turns: a stopped engine
 * spools down for a while, and its propeller or sound shows it. Properties
 * an engine does not have, such as a piston's N1, count as still.
 */
export function enginesTurning(sdk: { getPropertyValue(name: string): number }, indices: readonly number[]): boolean {
  const read = (name: string): number => {
    const value = sdk.getPropertyValue(name);
    return Number.isFinite(value) ? value : 0;
  };
  if (read("propulsion/starter_cmd") > 0.5) return true;
  return indices.some(index => {
    const engine = index === 0 ? "propulsion/engine" : `propulsion/engine[${index}]`;
    return read(`${engine}/set-running`) > 0.5 || Math.abs(read(`${engine}/engine-rpm`)) >= 1
      || read(`${engine}/n1`) >= 0.5 || read(`${engine}/n2`) >= 0.5;
  });
}

/**
 * Whether anything the aircraft has carries weight: a wheel, or a structure
 * contact such as a drone's feet or a belly on the grass. `prefixes` are the
 * contact property prefixes, `gear/unit[1]/` or `contact/unit[4]/`.
 */
export function touchingGround(sdk: { getPropertyValue(name: string): number }, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => sdk.getPropertyValue(`${prefix}WOW`) > 0.5);
}
