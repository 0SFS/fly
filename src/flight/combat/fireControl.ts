/**
 * The F-35B trigger.
 *
 * Hold fires the selected GAU-22/A. A press launches one selected missile.
 * Internal missiles wait for the bay door. Automatically opened bays shut after launch.
 * Nothing leaves while the master arm is safe or the flight is paused.
 */

import { geodeticFrom, nedFrom, type Geodetic } from "@0sfs/multiplayer/geodetic";
import { showPose } from "@0sfs/multiplayer/posePlayout";
import type { AircraftPose, FireBurst, MissileLaunch } from "@0sfs/multiplayer/protocol";
import { isFireableWeapon, weaponStation } from "@0sfs/stores/armamentControls";
import { stationDefinition } from "@0sfs/stores/stationTable";
import { bodyAxes, type NedVector } from "./kinematics";

const FT_TO_M = 0.3048;
/** GAU-22/A, the rate that spends 220 rounds in 4.4 s. */
export const GUN_RATE_HZ = 50;
export const GUN_MUZZLE_MPS = 1085;
export const GUN_CAPACITY = 220;
/** 80% of rounds inside this cone, from the gun sheet. */
export const GUN_CONE_RAD = 0.0025;
/**
 * Development quadratic drag, 1/m. A 25 mm round at sea level is about this;
 * the sheet does not publish one, and the value stays under the protocol cap.
 */
export const GUN_DRAG_PER_M = 0.00035;
export const GUN_LIFE_S = 3;
/** Short enough that eight stored bursts still cover a typical gun range. */
const BURST_ROUNDS = 10;

export const GUN_HIT_POINTS = 4;
export const MISSILE_HIT_POINTS = 100;

export interface MissileCard {
  speedMps: number;
  navGain: number;
  maxTurnRadPerSec: number;
  lifeS: number;
  /** Half-angle of the launch cue. Outside it, the missile holds the rail heading. */
  seekerRad: number;
}

/**
 * Published speeds are classified. These are development figures inside the
 * 1,500 m/s envelope: AIM-9X near Mach 2.5, ASRAAM near Mach 3, AIM-120 under Mach 4.
 * Turn rates are lateral acceleration over that speed, about 60 g, 60 g and 40 g.
 */
export const MISSILE_CARDS: Record<string, MissileCard> = {
  "aim-9x": { speedMps: 850, navGain: 4, maxTurnRadPerSec: 0.69, lifeS: 20, seekerRad: 40 * Math.PI / 180 },
  asraam: { speedMps: 1020, navGain: 4, maxTurnRadPerSec: 0.58, lifeS: 25, seekerRad: 45 * Math.PI / 180 },
  "aim-120": { speedMps: 1300, navGain: 3, maxTurnRadPerSec: 0.3, lifeS: 40, seekerRad: 70 * Math.PI / 180 },
};

const MISSILE_KEYS = new Set(Object.keys(MISSILE_CARDS));
const DOOR_OPEN = 0.95;

export interface ShooterKinematics extends Geodetic {
  tMs: number;
  northMps: number;
  eastMps: number;
  upMps: number;
  rollRad: number;
  pitchRad: number;
  headingRad: number;
}

export interface FireTarget extends Geodetic {
  pilotId: string;
}

export interface FireControlInput {
  dt: number;
  /** Trigger held. A rising edge launches; the level fires the selected gun. */
  held: boolean;
  /** A complete UI tap between simulation steps. Combined with the held edge. */
  pressed?: boolean;
  armed: boolean;
  paused: boolean;
  rounds: number;
  gunPod: boolean;
  load: readonly (string | null)[];
  bayPos: readonly [number, number];
  selectedWeaponKey: string | null;
  shooterId: string;
  kinematics: ShooterKinematics | null;
  target: FireTarget | null;
  /** Development override. Zero uses the card speed. Clamped to 1,500 m/s. */
  missileSpeedMps: number;
}

export interface DoorCommand { bay: 0 | 1; open: boolean }

export interface FireControlOutput {
  rounds: number;
  firing: boolean;
  bursts: FireBurst[];
  launches: MissileLaunch[];
  door: DoorCommand | null;
  consumedStation: number | null;
  /** First loaded station of the selected type; never falls back to another type. */
  selectedStation: number | null;
  /** A queued internal missile, waiting for its door to open. */
  pendingStation: number | null;
}

interface OpenBurst {
  seq: number;
  tMs: number;
  latDeg: number;
  lonDeg: number;
  altMeters: number;
  northMps: number;
  eastMps: number;
  upMps: number;
  count: number;
}

export interface PendingLaunch {
  station: number;
  key: string;
  bay: 0 | 1;
}

export function missileStations(load: readonly (string | null)[]): number[] {
  const stations: number[] = [];
  for (let station = 1; station <= 11; station++) {
    const key = load[station];
    if (key && MISSILE_KEYS.has(key)) stations.push(station);
  }
  return stations;
}

export function selectedMissileStation(load: readonly (string | null)[], selected: number | null): number | null {
  if (selected !== null && MISSILE_KEYS.has(load[selected] ?? "")) return selected;
  return missileStations(load)[0] ?? null;
}

export function createFireControl() {
  let held = false;
  let credit = 0;
  let nextSeq = 1;
  let open: OpenBurst | null = null;
  let pending: PendingLaunch | null = null;
  let flushBeforeNextStep = false;

  /** The caller also stops gun recoil immediately and waits for trigger release. */
  function cancel(): DoorCommand | null {
    const door = pending ? { bay: pending.bay, open: false } : null;
    pending = null;
    held = false;
    credit = 0;
    // Already spent rounds still need to reach the engagement and remote peers.
    flushBeforeNextStep = true;
    return door;
  }

  function flush(into: FireBurst[], shooterId: string): void {
    if (!open || open.count < 1) { open = null; return; }
    into.push({
      shooterId, seq: open.seq, tMs: open.tMs, count: open.count, rateHz: GUN_RATE_HZ,
      latDeg: open.latDeg, lonDeg: open.lonDeg, altMeters: open.altMeters,
      northMps: open.northMps, eastMps: open.eastMps, upMps: open.upMps,
      dragPerSec: GUN_DRAG_PER_M, lifeS: GUN_LIFE_S, coneRad: GUN_CONE_RAD, coneSeed: open.seq,
    });
    open = null;
  }

  function step(input: FireControlInput): FireControlOutput {
    const bursts: FireBurst[] = [];
    const launches: MissileLaunch[] = [];
    let door: DoorCommand | null = null;
    let consumedStation: number | null = null;
    let rounds = input.rounds;
    let firing = false;
    const selectedStation = isFireableWeapon(input.selectedWeaponKey)
      ? weaponStation(input.load, input.selectedWeaponKey) : null;
    const canShoot = input.armed && !input.paused && input.kinematics !== null && input.dt >= 0;
    const canceledPending = pending !== null && (!canShoot
      || pending.key !== input.selectedWeaponKey || input.load[pending.station] !== pending.key);
    if (canceledPending) door = cancel();
    if (flushBeforeNextStep) {
      flush(bursts, input.shooterId);
      flushBeforeNextStep = false;
    }
    const trigger = canShoot && input.held;
    const pressed = canShoot && !canceledPending && (input.pressed === true || (trigger && !held));
    held = trigger;

    if (!canShoot || input.selectedWeaponKey !== "gau-22-pod" || selectedStation === null || !input.gunPod || rounds <= 0) {
      flush(bursts, input.shooterId);
      credit = 0;
    } else if (trigger) {
      credit += input.dt * GUN_RATE_HZ;
      while (credit >= 1 && rounds > 0) {
        credit -= 1;
        rounds -= 1;
        if (!open) {
          const muzzle = muzzleVelocity(input.kinematics!);
          open = {
            seq: nextSeq++, tMs: input.kinematics!.tMs, count: 0,
            latDeg: input.kinematics!.latDeg, lonDeg: input.kinematics!.lonDeg, altMeters: input.kinematics!.altMeters,
            ...muzzle,
          };
        }
        open.count += 1;
        firing = true;
        if (open.count >= BURST_ROUNDS) flush(bursts, input.shooterId);
      }
    } else {
      flush(bursts, input.shooterId);
      credit = 0;
    }

    if (pending && input.kinematics) {
      const doorPos = input.bayPos[pending.bay] ?? 0;
      if (doorPos >= DOOR_OPEN) {
        const launched = launchMissile(input, pending.key, nextSeq++);
        if (launched) {
          launches.push(launched);
          consumedStation = pending.station;
          door = { bay: pending.bay, open: false };
        }
        pending = null;
      }
    } else if (pressed && selectedStation !== null && input.kinematics) {
      const key = input.load[selectedStation];
      const station = key ? stationDefinition(selectedStation) : undefined;
      if (key && station && MISSILE_KEYS.has(key)) {
        if (station.bay === null) {
          const launched = launchMissile(input, key, nextSeq++);
          if (launched) {
            launches.push(launched);
            consumedStation = selectedStation;
          }
        } else if ((input.bayPos[station.bay] ?? 0) >= DOOR_OPEN) {
          const launched = launchMissile(input, key, nextSeq++);
          if (launched) {
            launches.push(launched);
            consumedStation = selectedStation;
          }
        } else {
          pending = { station: selectedStation, key, bay: station.bay };
          door = { bay: station.bay, open: true };
        }
      }
    }

    return {
      rounds, firing, bursts, launches, door, consumedStation, selectedStation,
      pendingStation: pending?.station ?? null,
    };
  }

  return { step, cancel, getPending: (): PendingLaunch | null => pending ? { ...pending } : null };
}

function muzzleVelocity(kinematics: ShooterKinematics): { northMps: number; eastMps: number; upMps: number } {
  const forward = bodyAxes(kinematics.rollRad, kinematics.pitchRad, kinematics.headingRad).forward;
  return {
    northMps: kinematics.northMps + forward.north * GUN_MUZZLE_MPS,
    eastMps: kinematics.eastMps + forward.east * GUN_MUZZLE_MPS,
    upMps: kinematics.upMps - forward.down * GUN_MUZZLE_MPS,
  };
}

function launchMissile(input: FireControlInput, key: string, seq: number): MissileLaunch | null {
  const card = MISSILE_CARDS[key];
  const kinematics = input.kinematics;
  if (!card || !kinematics) return null;
  const speed = input.missileSpeedMps > 0 ? Math.min(1500, input.missileSpeedMps) : card.speedMps;
  const forward = bodyAxes(kinematics.rollRad, kinematics.pitchRad, kinematics.headingRad).forward;
  const origin = geodeticFrom(kinematics, {
    northM: forward.north * 4, eastM: forward.east * 4, downM: forward.down * 4,
  });
  const guided = input.target !== null && seekerSees(forward, kinematics, input.target, card.seekerRad);
  return {
    missileId: `m${seq}`,
    shooterId: input.shooterId,
    seq,
    tMs: kinematics.tMs,
    ...(guided && input.target ? { targetId: input.target.pilotId } : {}),
    ...origin,
    northMps: forward.north * speed,
    eastMps: forward.east * speed,
    upMps: -forward.down * speed,
    navGain: card.navGain,
    maxTurnRadPerSec: card.maxTurnRadPerSec,
    speedMps: speed,
    lifeS: card.lifeS,
  };
}

function seekerSees(forward: NedVector, from: Geodetic, target: Geodetic, seekerRad: number): boolean {
  const relative = nedFrom(from, target);
  const range = Math.hypot(relative.northM, relative.eastM, relative.downM);
  if (range < 1) return false;
  const dot = (forward.north * relative.northM + forward.east * relative.eastM + forward.down * relative.downM) / range;
  return dot >= Math.cos(seekerRad);
}

/** The remote aircraft closest to the nose. The seeker still decides whether the missile guides. */
export function bestTarget(
  kinematics: ShooterKinematics,
  remotes: readonly { pose: AircraftPose; held: boolean }[],
): FireTarget | null {
  const forward = bodyAxes(kinematics.rollRad, kinematics.pitchRad, kinematics.headingRad).forward;
  let bestDot = -2;
  let best: FireTarget | null = null;
  for (const remote of remotes) {
    const shown = showPose(remote.pose, kinematics.tMs, remote.held);
    const relative = nedFrom(kinematics, shown.pose);
    const range = Math.hypot(relative.northM, relative.eastM, relative.downM);
    if (!(range > 1)) continue;
    const dot = (forward.north * relative.northM + forward.east * relative.eastM + forward.down * relative.downM) / range;
    if (dot <= bestDot) continue;
    bestDot = dot;
    best = { pilotId: remote.pose.pilotId, latDeg: shown.pose.latDeg, lonDeg: shown.pose.lonDeg, altMeters: shown.pose.altMeters };
  }
  return best;
}

export function kinematicsFromState(state: {
  latDeg: number; lonDeg: number; altMeters: number;
  rollRad: number; pitchRad: number; headingRad: number;
  northVelocityFps: number; eastVelocityFps: number; verticalSpeedFps: number;
}, tMs: number): ShooterKinematics {
  return {
    latDeg: state.latDeg, lonDeg: state.lonDeg, altMeters: state.altMeters, tMs,
    rollRad: state.rollRad, pitchRad: state.pitchRad, headingRad: state.headingRad,
    northMps: state.northVelocityFps * FT_TO_M,
    eastMps: state.eastVelocityFps * FT_TO_M,
    upMps: state.verticalSpeedFps * FT_TO_M,
  };
}
