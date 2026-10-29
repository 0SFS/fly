import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { createAirframe, type AirframeSpec } from "@0sfs/multirotor/airframe";
import { PLANT } from "@0sfs/multirotor/layout";
import { createMultirotor, type AircraftSample, type FlightCommand, type MultirotorStatus } from "@0sfs/multirotor/multirotor";
import { loadMultirotor, type MultirotorCore } from "@0sfs/multirotor/wasm";
import { PHYSICS_DT, type DroneProfile } from "./droneTypes";

const METERS_PER_FOOT = 0.3048;
const KG_PER_SLUG = 14.5939029;
const KG_M3_PER_SLUG_FT3 = 515.3788184;
const N_PER_LBF = 4.4482216152605;
const NM_PER_FTLBF = N_PER_LBF * METERS_PER_FOOT;
const KG_M2_PER_SLUG_FT2 = NM_PER_FTLBF;
const RPM_PER_RAD_S = 30 / Math.PI;

export const DRONE_READ_PATHS = [
  "velocities/v-north-fps", "velocities/v-east-fps", "velocities/v-down-fps",
  "velocities/u-aero-fps", "velocities/v-aero-fps", "velocities/w-aero-fps",
  "velocities/p-rad_sec", "velocities/q-rad_sec", "velocities/r-rad_sec",
  "attitude/phi-rad", "attitude/theta-rad", "attitude/psi-rad",
  "inertia/mass-slugs", "inertia/ixx-slugs_ft2", "inertia/iyy-slugs_ft2", "inertia/izz-slugs_ft2",
  "atmosphere/rho-slugs_ft3",
  "contact/unit[0]/WOW", "contact/unit[1]/WOW", "contact/unit[2]/WOW", "contact/unit[3]/WOW",
  "simulation/sim-time-sec", "position/h-sl-ft", "position/lat-geod-deg", "position/long-gc-deg",
] as const;

export interface DroneFlightSample extends AircraftSample {
  latDeg: number;
  lonDeg: number;
  altM: number;
  onGround: boolean;
  simTimeS: number;
  /** A time discontinuity cleared the plant and controller state. */
  reset: boolean;
}

export interface DroneFlightTelemetry {
  /** Simulated speeds, in the airframe's rotor order. */
  rpm: readonly number[];
  hoverRpm: number;
  maxRpm: number;
  onGround: boolean;
  aglM: number | null;
  simTimeS: number;
}

export interface DroneFlightModel {
  /** Read once before step. Invalid samples write a zero wrench and return null. */
  read(terrainMeters: number | null): DroneFlightSample | null;
  step(command: FlightCommand, armed: boolean): DroneFlightTelemetry;
  telemetry(): DroneFlightTelemetry;
  status(): MultirotorStatus;
  reset(): void;
  dispose(): void;
}

/** JSBSim owns rigid-body motion; the multirotor supplies a body-axis wrench at the CG. */
export function createDroneFlightModel(sdk: JSBSimSdk, profile: AirframeSpec & Pick<DroneProfile, "properties">): DroneFlightModel {
  const m = createMultirotor(createAirframe(profile, PHYSICS_DT));
  const reads = sdk.createPropertyBatch(DRONE_READ_PATHS);
  const properties = profile.properties;
  const writes = sdk.createPropertyBatch([
    properties.fx, properties.fy, properties.fz, properties.l, properties.m, properties.n, properties.armed,
  ], { create: true });
  const values = new Float64Array(DRONE_READ_PATHS.length);
  const wrench = new Float64Array(7);
  const rpm = profile.rotors.map(() => 0);
  const telemetry: DroneFlightTelemetry = {
    rpm, hoverRpm: 0, maxRpm: profile.propeller.maxRpm, onGround: false, aglM: null, simTimeS: 0,
  };
  const sample: DroneFlightSample = {
    vn: 0, ve: 0, vd: 0, u: 0, v: 0, w: 0, p: 0, q: 0, r: 0, phi: 0, theta: 0, psi: 0,
    massKg: 0, ixx: 0, iyy: 0, izz: 0, rho: 0, aglM: NaN,
    latDeg: 0, lonDeg: 0, altM: 0, onGround: false, simTimeS: 0, reset: false,
  };
  let disposed = false;
  let ready = false;
  let spawn = true;
  let lastTime: number | null = null;
  let lastArmed = false;
  let core: MultirotorCore | null = null;
  void loadMultirotor().then(loaded => {
    if (disposed) { loaded.dispose(); return; }
    core = loaded;
    m.useCore(loaded);
  }, error => { if (!disposed) m.refuseCore(String(error)); });

  function write() {
    try { writes.write(wrench); } catch { /* A disappearing SDK must not interrupt the frame loop. */ }
  }
  function zeroWrench() {
    wrench.fill(0);
    wrench[6] = lastArmed ? 1 : 0;
    write();
  }
  function reset() {
    m.reset();
    rpm.fill(0);
    ready = false;
    spawn = true;
    lastTime = null;
    lastArmed = false;
  }
  return {
    read(terrainMeters) {
      if (disposed) return null;
      ready = false;
      try { reads.read(values); } catch { zeroWrench(); return null; }
      if (!values.every(Number.isFinite) || (terrainMeters !== null && !Number.isFinite(terrainMeters))) {
        zeroWrench();
        return null;
      }
      const [vn, ve, vd, u, v, w, p, q, r, phi, theta, psi, mass, ixx, iyy, izz, rho,
        fl, fr, rl, rr, time, altitude, lat, lon] = values;
      if (!(mass > 0 && ixx > 0 && iyy > 0 && izz > 0 && rho > 0)) { zeroWrench(); return null; }
      const discontinuity = lastTime !== null && (time < lastTime || time - lastTime > 1.5 * PHYSICS_DT);
      if (discontinuity) reset();
      lastTime = time;
      sample.vn = vn * METERS_PER_FOOT; sample.ve = ve * METERS_PER_FOOT; sample.vd = vd * METERS_PER_FOOT;
      sample.u = u * METERS_PER_FOOT; sample.v = v * METERS_PER_FOOT; sample.w = w * METERS_PER_FOOT;
      sample.p = p; sample.q = q; sample.r = r;
      sample.phi = phi; sample.theta = theta; sample.psi = psi;
      sample.massKg = mass * KG_PER_SLUG;
      sample.ixx = ixx * KG_M2_PER_SLUG_FT2;
      sample.iyy = iyy * KG_M2_PER_SLUG_FT2;
      sample.izz = izz * KG_M2_PER_SLUG_FT2;
      sample.rho = rho * KG_M3_PER_SLUG_FT3;
      sample.altM = altitude * METERS_PER_FOOT;
      sample.aglM = terrainMeters === null ? NaN : sample.altM - terrainMeters;
      sample.latDeg = lat; sample.lonDeg = lon;
      sample.onGround = fl === 1 || fr === 1 || rl === 1 || rr === 1;
      sample.simTimeS = time;
      sample.reset = discontinuity;
      telemetry.hoverRpm = m.airframe.hoverOmega(sample.massKg, sample.rho) * RPM_PER_RAD_S;
      telemetry.onGround = sample.onGround;
      telemetry.aglM = terrainMeters === null ? null : sample.aglM;
      telemetry.simTimeS = time;
      ready = true;
      return sample;
    },
    step(command, armed) {
      if (disposed) return telemetry;
      lastArmed = armed;
      if (!ready || !Object.values(command).every(Number.isFinite)) { zeroWrench(); return telemetry; }
      ready = false;
      if (spawn) {
        spawn = false;
        if (!sample.onGround) {
          const omega = m.airframe.hoverOmega(sample.massKg, sample.rho);
          for (let i = 0; i < rpm.length; i++) m.plant.state[PLANT.state.globals + i * PLANT.state.stride + PLANT.state.OMEGA] = omega;
        }
      }
      try {
        m.step(sample, command);
        const output = m.plant.output;
        for (let i = 0; i < 6; i++) wrench[i] = output[i] / (i < 3 ? N_PER_LBF : NM_PER_FTLBF);
        if (!wrench.every(Number.isFinite)) throw new Error("The rotor wrench is not finite.");
        for (let i = 0; i < rpm.length; i++) rpm[i] = output[PLANT.output.globals + i * PLANT.output.stride + PLANT.output.OMEGA] * RPM_PER_RAD_S;
        wrench[6] = armed ? 1 : 0;
        write();
      } catch {
        reset();
        zeroWrench();
      }
      return telemetry;
    },
    telemetry: () => telemetry,
    status: () => m.status(),
    reset,
    dispose() {
      if (disposed) return;
      lastArmed = false;
      zeroWrench();
      disposed = true;
      reads.dispose();
      writes.dispose();
      m.dispose();
      core?.dispose();
      core = null;
    },
  };
}
