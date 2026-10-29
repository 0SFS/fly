import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { slewGimbal } from "@0sfs/camera-gimbal";
import { CONTROL } from "@0sfs/multirotor/layout";
import type { FlightCommand } from "@0sfs/multirotor/multirotor";
import { groundContactClearanceMeters } from "@0sfs/ground-contact/groundContactClearance";
import type { DroneStickCommand } from "./droneGate";
import { createDroneFlightModel, type DroneFlightModel, type DroneFlightTelemetry } from "./droneFlightModel";
import { clamp, dead, PHYSICS_DT, wrap, type DroneProfile } from "./droneTypes";

export interface DroneHold {
  /** Horizontal coordinates stay null together until braking finishes. */
  lat: number | null;
  lon: number | null;
  alt: number | null;
}

export interface DroneCommandInput {
  profile: DroneProfile;
  command: DroneStickCommand;
  psi: number;
  latDeg: number;
  lonDeg: number;
  altM: number;
  vn: number;
  ve: number;
  vd: number;
  hold: DroneHold | null;
  aglM: number | null;
  touchdownAglM: number;
  onGround: boolean;
  armed: boolean;
  dt: number;
  gimbalDeg: number;
}

export interface DroneCommandPlan {
  flight: FlightCommand;
  hold: DroneHold | null;
  gimbalDeg: number;
}

const HOLD_SPEED_MPS = 0.1;

/** Sticks and independent hold anchors command velocity; the multirotor flies it. */
export function planDroneCommand(input: DroneCommandInput): DroneCommandPlan {
  const { profile, command, dt } = input;
  const pitch = dead(command.pitch, profile.deadzone);
  const roll = dead(command.roll, profile.deadzone);
  const vertical = dead(command.vertical, profile.deadzone);
  const yaw = dead(command.yaw, profile.deadzone);
  const mode = command.sport ? profile.modes.sport : profile.modes.normal;
  let hold = input.hold;
  const horizontalHeld = pitch === 0 && roll === 0;
  const verticalHeld = vertical === 0;
  if (horizontalHeld || verticalHeld) {
    // Release commands zero velocity first; position hold starts where braking ends.
    const horizontalStopped = Math.hypot(input.vn, input.ve) <= HOLD_SPEED_MPS;
    const verticalStopped = Math.abs(input.vd) <= HOLD_SPEED_MPS;
    const lat = horizontalHeld ? hold?.lat ?? (horizontalStopped ? input.latDeg : null) : null;
    const lon = horizontalHeld ? hold?.lon ?? (horizontalStopped ? input.lonDeg : null) : null;
    const alt = verticalHeld ? hold?.alt ?? (verticalStopped ? input.altM : null) : null;
    if (!hold || hold.lat !== lat || hold.lon !== lon || hold.alt !== alt) hold = { lat, lon, alt };
  } else hold = null;

  let vn = pitch * mode.speedMps * Math.cos(input.psi) - roll * mode.speedMps * Math.sin(input.psi);
  let ve = pitch * mode.speedMps * Math.sin(input.psi) + roll * mode.speedMps * Math.cos(input.psi);
  let vd = vertical >= 0 ? -vertical * mode.climbMps : -vertical * mode.descentMps;
  if (horizontalHeld && hold && hold.lat !== null && hold.lon !== null) {
    const northError = (input.latDeg - hold.lat) * 111320;
    const eastError = wrap((input.lonDeg - hold.lon) * Math.PI / 180) * 180 / Math.PI
      * Math.cos(hold.lat * Math.PI / 180) * 111320;
    vn = clamp(-profile.kPos * northError, -profile.positionHoldMps, profile.positionHoldMps);
    ve = clamp(-profile.kPos * eastError, -profile.positionHoldMps, profile.positionHoldMps);
  }
  if (verticalHeld && hold && hold.alt !== null) {
    vd = clamp(profile.kPos * (input.altM - hold.alt), -mode.climbMps, mode.descentMps);
  }
  if (vd > 0 && input.aglM !== null && Number.isFinite(input.aglM)) {
    vd = Math.min(vd, Math.max(0.1, (input.aglM - input.touchdownAglM) * 0.5));
  }
  const yawRateMaxRad = mode.yawRateDeg * Math.PI / 180;
  return {
    flight: {
      vn, ve, vd,
      yawMode: command.yawMode === "angle" ? CONTROL.YAW_HEADING : CONTROL.YAW_RATE,
      yaw: command.yawMode === "angle" ? (command.yawAngleDeg === null ? input.psi : command.yawAngleDeg * Math.PI / 180) : yaw * yawRateMaxRad,
      mode: !input.armed ? CONTROL.MODE_STOPPED : input.onGround && vertical <= 0 ? CONTROL.MODE_IDLE : CONTROL.MODE_FLYING,
      tanTiltMax: Math.tan(mode.tiltMaxDeg * Math.PI / 180),
      yawRateMaxRad,
    },
    hold,
    gimbalDeg: slewGimbal(input.gimbalDeg, command.gimbalPitchDeg, dt,
      profile.gimbalMinDeg, profile.gimbalMaxDeg, profile.gimbalSlewDeg),
  };
}

export interface DroneControllerStep extends DroneFlightTelemetry {
  psi: number;
  gimbalDeg: number;
  armed: boolean;
}

export interface DroneController {
  step(sdk: JSBSimSdk, command: DroneStickCommand, dt: number, terrainMeters: number | null): DroneControllerStep;
  gimbalDeg(): number;
  reset(): void;
  dispose(): void;
}

export function createDroneController(profile: DroneProfile): DroneController {
  let hold: DroneHold | null = null;
  let gimbal = 0;
  let psi = 0;
  let armed: boolean | null = null;
  let disarmSeconds = 0;
  let complained = false;
  let model: DroneFlightModel | null = null;
  let boundSdk: JSBSimSdk | null = null;
  let touchdownAglM = 0;
  const stopped: DroneFlightTelemetry = {
    rpm: profile.rotors.map(() => 0), hoverRpm: 0, maxRpm: profile.propeller.maxRpm, onGround: false, aglM: null, simTimeS: 0,
  };
  function clear() { hold = null; gimbal = 0; psi = 0; armed = null; disarmSeconds = 0; }
  function result(): DroneControllerStep { return { ...(model?.telemetry() ?? stopped), psi, gimbalDeg: gimbal, armed: armed ?? false }; }
  return {
    gimbalDeg: () => gimbal,
    reset() { clear(); complained = false; model?.reset(); },
    step(sdk, command, dt, terrainMeters) {
      if (!Number.isFinite(dt) || Math.abs(dt - PHYSICS_DT) > 1e-9) {
        if (!complained) {
          complained = true;
          throw new Error("The drone controller steps at 120 Hz.");
        }
        return result();
      }
      if (!model || boundSdk !== sdk) {
        model?.dispose();
        model = null;
        boundSdk = null;
        clear();
        touchdownAglM = groundContactClearanceMeters(sdk, 0, 0);
        model = createDroneFlightModel(sdk, profile);
        boundSdk = sdk;
      }
      const sample = model.read(terrainMeters);
      if (!sample) return result();
      if (sample.reset) clear();
      psi = sample.psi;
      armed ??= !sample.onGround;
      const vertical = dead(command.vertical, profile.deadzone);
      if (sample.onGround && vertical > 0.5) armed = true;
      if (sample.onGround && vertical < -0.5) {
        disarmSeconds += dt;
        if (disarmSeconds >= 1 - 1e-9) armed = false;
      } else disarmSeconds = 0;
      const plan = planDroneCommand({
        profile, command, dt, psi, latDeg: sample.latDeg, lonDeg: sample.lonDeg, altM: sample.altM,
        vn: sample.vn, ve: sample.ve, vd: sample.vd,
        hold, aglM: model.telemetry().aglM, touchdownAglM, onGround: sample.onGround, armed, gimbalDeg: gimbal,
      });
      if (Object.values(plan.flight).every(Number.isFinite)) {
        hold = plan.hold;
        if (Number.isFinite(plan.gimbalDeg)) gimbal = plan.gimbalDeg;
      }
      model.step(plan.flight, armed);
      return result();
    },
    dispose() { model?.dispose(); model = null; boundSdk = null; clear(); },
  };
}
