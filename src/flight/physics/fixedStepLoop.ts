import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import { interpolateFlightState, type FlightState } from "@0sfs/ground-contact/flightState";
import { flightLog } from "@0sfs/logging/flightLog";
import { readContactDiagnostics } from "@0sfs/ground-contact/contactDiagnostics";
import { groundContactClearanceMeters } from "@0sfs/ground-contact/groundContactClearance";
import {
  createSimulationRecorder, invalidFlightStateReasons, restoreSimulation,
} from "@0sfs/ground-contact/safeFlightState";

import { maxCatchUpSteps, physicsStepSeconds, type PhysicsHz } from "./physicsRate";

// Beyond normal suspension compression, this is a hard impact. Feeding deep
// penetration into an unbounded spring turns a cliff into a launch pad.
const MAX_GROUND_PENETRATION_METERS = 0.5;

export interface FixedStepPhysicsOptions {
  /**
   * Steps per simulated second. The native model must already step
   * `1 / physicsHz` (bootstrapAircraft sets it); the loop checks.
   */
  physicsHz: PhysicsHz;
  /** Deliberate arcade mode; numerical/absolute flight-state guards still apply. */
  getArcadeGroundLaunches?: () => boolean;
}

/**
 * Where the frame time the loop received while running went. Only accepted
 * steps reach consumers as simulated time; discarded time never does.
 * receivedSeconds = simulatedSeconds + discardedSeconds + pendingSeconds.
 */
export interface PhysicsTimeAccounting {
  physicsHz: PhysicsHz;
  dtSeconds: number;
  /** Most steps one update takes: the 50 ms catch-up horizon in whole steps. */
  maxStepsPerUpdate: number;
  /** Frame time offered to the loop while it was running (not paused or faulted). */
  receivedSeconds: number;
  /** Native steps the loop accepted and passed to onStep. */
  acceptedSteps: number;
  /** acceptedSteps × dtSeconds. */
  simulatedSeconds: number;
  /** Received time that will never be simulated, for any reason below. */
  discardedSeconds: number;
  /** Of that, the backlog beyond maxStepsPerUpdate steps: the simulation fell behind real time. */
  catchUpDiscardedSeconds: number;
  /** Received time not yet simulated, under one step; it shifts the display's interpolation. */
  pendingSeconds: number;
}

export interface FixedStepPhysicsLoop {
  readonly physicsHz: PhysicsHz;
  /** One accepted step, in seconds: 1 / physicsHz. */
  readonly dtSeconds: number;
  update(renderDt: number, applyInputs: () => void | boolean | "reset"): FlightState;
  setPaused(paused: boolean): void;
  reset(): void;
  getLatestState(): FlightState | null;
  getFault(): string | null;
  getTimeAccounting(): PhysicsTimeAccounting;
}

/** The native model's step must be the loop's: a 60 Hz label never hides a 120 Hz native loop. */
function assertNativeStep(sdk: JSBSimSdk, physicsHz: PhysicsHz, dtSeconds: number): void {
  const getDeltaT = (sdk as { getDeltaT?: () => number }).getDeltaT;
  if (typeof getDeltaT !== "function") return;
  const native = getDeltaT.call(sdk);
  if (Math.abs(native - dtSeconds) > 1e-12) {
    throw new Error(`The native model steps ${native} s, not the ${physicsHz} Hz loop's ${dtSeconds} s.`);
  }
}

export function createFixedStepPhysicsLoop(
  sdk: JSBSimSdk,
  /** Once per accepted native step, with that step's simulated duration. Faulted or refused steps never call it. */
  onStep: ((state: FlightState, dtSeconds: number) => void) | undefined,
  options: FixedStepPhysicsOptions,
): FixedStepPhysicsLoop {
  const physicsHz = options.physicsHz;
  const dt = physicsStepSeconds(physicsHz);
  const maxSteps = maxCatchUpSteps(physicsHz);
  // A whole number of steps, so the cap never leaves a sliver to interpolate.
  const maxBacklogSeconds = maxSteps * dt;
  assertNativeStep(sdk, physicsHz, dt);
  let accumulator = 0;
  let prevState: FlightState | null = null;
  let currState: FlightState | null = null;
  let paused = false;
  let fault: string | null = null;
  let receivedSeconds = 0;
  let acceptedSteps = 0;
  let discardedSeconds = 0;
  let catchUpDiscardedSeconds = 0;
  // The state before each step, for undoing one that faults. Normal steps only
  // copy numbers into an array; the snapshot is built when a guard trips.
  const recorder = createSimulationRecorder(sdk);
  // Pending time that will now never be simulated: a refused step, a fault, a pause or a reset.
  const discardBacklog = (): void => {
    discardedSeconds += accumulator;
    accumulator = 0;
  };

  return {
    physicsHz,
    dtSeconds: dt,
    update(renderDt: number, applyInputs: () => void | boolean | "reset"): FlightState {
      if (paused || fault) return currState ?? readFlightState(sdk);

      // The backlog cap (at most 66.7 ms) also bounds a long frame, such as
      // the first after a hidden tab: its excess is counted, not simulated.
      const frameDt = Number.isFinite(renderDt) ? Math.max(renderDt, 0) : 0;
      receivedSeconds += frameDt;
      const offered = accumulator + frameDt;
      accumulator = Math.min(offered, maxBacklogSeconds);
      if (offered > accumulator) {
        catchUpDiscardedSeconds += offered - accumulator;
        discardedSeconds += offered - accumulator;
      }

      while (accumulator >= dt) {
        const result = applyInputs();
        if (result === false) {
          discardBacklog();
          if (currState) prevState = currState;
          break;
        }
        const before = readFlightState(sdk);
        const beforeReasons = invalidFlightStateReasons(before);
        if (beforeReasons.length > 0) {
          fault = "Invalid flight state. Reposition the aircraft to reset the simulation.";
          flightLog.error("physics", "Faulted before stepping: state is outside the envelope", {
            failed: beforeReasons, state: before,
          });
          discardBacklog();
          break;
        }
        const terrainMeters = sdk.getPropertyValue("position/terrain-elevation-asl-ft") * 0.3048;
        const groundPenetration = terrainMeters + groundContactClearanceMeters(sdk, before.rollRad, before.pitchRad) - before.altMeters;
        if (!options.getArcadeGroundLaunches?.() && groundPenetration > MAX_GROUND_PENETRATION_METERS) {
          fault = "Hard ground impact. Reposition the aircraft to recover.";
          flightLog.error("physics", "Stopped a deep ground impact before loading the gear springs", {
            penetrationMeters: Number(groundPenetration.toFixed(3)),
            terrainMeters, state: before,
          });
          prevState = currState = before;
          discardBacklog();
          break;
        }
        currState ??= before;
        if (result === "reset") prevState = currState = before;
        const restorable = typeof sdk.resetToInitialConditions === "function";
        if (restorable) recorder.record();
        const success = sdk.run();
        const candidate = readFlightState(sdk);
        const deltaLon = ((candidate.lonDeg - before.lonDeg + 540) % 360) - 180;
        const distance = Math.hypot((candidate.latDeg - before.latDeg) * 111320,
          deltaLon * Math.cos(before.latDeg * Math.PI / 180) * 111320, candidate.altMeters - before.altMeters);
        const airspeedJump = Math.abs(candidate.airspeedKts - before.airspeedKts);
        const candidateReasons = invalidFlightStateReasons(candidate);
        // Report which guard tripped, not merely that one did: "moved 4 km in
        // one 60 Hz step" and "airspeed is NaN" call for different fixes.
        const tripped: string[] = [];
        if (!success) tripped.push("JSBSim run() returned false");
        if (candidateReasons.length > 0) tripped.push(...candidateReasons);
        if (distance > 100) tripped.push(`moved ${distance.toFixed(1)} m in one ${physicsHz} Hz step (limit 100)`);
        if (airspeedJump > 200) tripped.push(`airspeed jumped ${airspeedJump.toFixed(1)} kt in one step (limit 200)`);
        if (tripped.length > 0) {
          // Read the contact state before restoring: the restore rewinds the
          // terrain elevation and gear compression that explain the fault.
          const contact = readContactDiagnostics(sdk, before.altMeters, candidate.altMeters);
          // The on-screen notice shows these reasons, and this is the one line
          // that separates a gear-spring launch from an aerodynamic
          // divergence, so it belongs there and not only in the console.
          if (contact.aglBeforeMeters < -1) {
            tripped.push(`gear was ${(-contact.aglBeforeMeters).toFixed(0)} m under the terrain JSBSim was given (${contact.terrainElevationMeters.toFixed(0)} m)`);
          }
          let restored: string | null = null;
          if (restorable) {
            try { restoreSimulation(sdk, recorder.snapshot()); }
            catch (error) { restored = error instanceof Error ? error.message : String(error); }
          }
          prevState = currState = before;
          fault = "Physics stopped after an unstable contact. Reposition the aircraft to reset the simulation.";
          flightLog.error("physics", "Faulted after stepping", {
            failed: tripped,
            stepMeters: Number(distance.toFixed(2)),
            airspeedJumpKts: Number(airspeedJump.toFixed(2)),
            before, after: candidate, contact,
            ...(restored ? { restoreFailed: restored } : {}),
          });
          discardBacklog();
          break;
        }
        prevState = currState;
        currState = candidate;
        acceptedSteps += 1;
        onStep?.(currState, dt);
        accumulator -= dt;
      }

      const alpha = accumulator / dt;
      return currState ? prevState === currState ? currState : interpolateFlightState(prevState, currState, alpha) : readFlightState(sdk);
    },
    setPaused(value: boolean): void {
      if (value === paused) return;
      paused = value;
      if (paused) discardBacklog();
    },
    reset(): void {
      const state = readFlightState(sdk);
      const reasons = invalidFlightStateReasons(state);
      if (reasons.length > 0) {
        flightLog.error("physics", "Cannot reset: the simulation is still outside the envelope", {
          failed: reasons, state,
        });
        throw new Error(`Cannot reset physics to an invalid state: ${reasons.join("; ")}`);
      }
      assertNativeStep(sdk, physicsHz, dt);
      if (fault) flightLog.info("physics", "Fault cleared; physics resuming", { clearedFault: fault });
      fault = null;
      discardBacklog();
      currState = state;
      prevState = currState;
    },
    getLatestState(): FlightState | null {
      return currState;
    },
    getFault: () => fault,
    getTimeAccounting: () => ({
      physicsHz, dtSeconds: dt, maxStepsPerUpdate: maxSteps, receivedSeconds,
      acceptedSteps, simulatedSeconds: acceptedSteps * dt,
      discardedSeconds, catchUpDiscardedSeconds, pendingSeconds: accumulator,
    }),
  };
}
