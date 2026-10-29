/**
 * Local bullets and missiles, and the hits a shooter claims.
 *
 * Every peer integrates the same burst or launch. The shooter tests those
 * paths against the target pose it is drawing and sends one hit. The target
 * applies that hit to its health bar and does not score the shot itself.
 */

import { distanceM, nedFrom, type Geodetic } from "@0sfs/multiplayer/geodetic";
import { showPose } from "@0sfs/multiplayer/posePlayout";
import type { AircraftPose, CombatMessage, WeaponHit } from "@0sfs/multiplayer/protocol";
import { createSessionWorld, type DrawnRound } from "@0sfs/multiplayer/sessionWorld";
import type { MissileState } from "@0sfs/multiplayer/protocol";
import { GUN_HIT_POINTS, MISSILE_HIT_POINTS } from "./fireControl";

export const GUN_HIT_RADIUS_M = 8;
/** Proximity fuse: a warhead does not have to strike the skin. */
export const MISSILE_HIT_RADIUS_M = 15;
/** The fuse stays safe until the missile is clear of the shooter. */
export const MISSILE_ARM_M = 30;
const HIT_BUDGET = 80;

export interface TrackedPose { pose: AircraftPose; held: boolean }

export interface CombatDraw {
  id: string;
  kind: "round" | "missile";
  latDeg: number;
  lonDeg: number;
  altMeters: number;
  northMps: number;
  eastMps: number;
  upMps: number;
}

export interface EngagementStep {
  draw: CombatDraw[];
  /** Hits this pilot scored. Publish them. */
  claims: WeaponHit[];
  /** Damage from the other pilot, to apply once. */
  damage: number[];
}

export function createEngagement() {
  let world = createSessionWorld();
  const previous = new Map<string, Geodetic>();
  const origin = new Map<string, Geodetic>();
  const seenHits = new Set<string>();
  const hitOrder: string[] = [];
  let queued: WeaponHit[] = [];
  let lastNow: number | null = null;
  let hitWindow = 0;
  let hitCount = 0;
  let targets: { pilotId: string; place: Geodetic }[] = [];
  const guided = new Map<string, number>();

  function ingest(message: CombatMessage | { type: "pose"; pose: AircraftPose }): void {
    if (message.type === "hit") {
      queued.push(message.hit);
      return;
    }
    if (message.type === "fire") {
      world.ingest(message);
      const place = { latDeg: message.burst.latDeg, lonDeg: message.burst.lonDeg, altMeters: message.burst.altMeters };
      for (let index = 0; index < message.burst.count; index++) origin.set(`${message.burst.shooterId}:${message.burst.seq}:${index}`, place);
      return;
    }
    if (message.type === "launch") {
      world.ingest(message);
      origin.set(message.launch.missileId, {
        latDeg: message.launch.latDeg, lonDeg: message.launch.lonDeg, altMeters: message.launch.altMeters,
      });
      return;
    }
    world.ingest(message);
  }

  function track(remotes: readonly TrackedPose[], nowMs: number): void {
    const next = [];
    for (const remote of remotes) {
      const shown = showPose(remote.pose, nowMs, remote.held);
      next.push({
        pilotId: remote.pose.pilotId,
        place: { latDeg: shown.pose.latDeg, lonDeg: shown.pose.lonDeg, altMeters: shown.pose.altMeters },
      });
      if ((guided.get(remote.pose.pilotId) ?? -1) < remote.pose.seq) {
        guided.set(remote.pose.pilotId, remote.pose.seq);
        world.ingest({ type: "pose", pose: { ...remote.pose } });
      }
    }
    targets = next;
  }

  function step(nowMs: number, selfId: string, damageEnabled: boolean): EngagementStep {
    if (lastNow !== null && Math.abs(nowMs - lastNow) > 2_000) {
      world.clearShots();
      previous.clear();
      origin.clear();
      queued = [];
    }
    lastNow = nowMs;
    const view = world.render(nowMs);
    const claims: WeaponHit[] = [];
    const damage: number[] = [];
    if (damageEnabled) acceptHits(selfId, nowMs, damage);
    const live = new Set<string>();
    for (const round of view.rounds) {
      live.add(round.id);
      const from = previous.get(round.id) ?? origin.get(round.id) ?? round;
      if (damageEnabled && round.shooterId === selfId) {
        const hit = sweep(gunHitId(round.id), round.shooterId, round.seq, from, round, GUN_HIT_RADIUS_M, GUN_HIT_POINTS, selfId, nowMs, 0);
        if (hit) {
          claims.push(hit);
          world.dismiss(round.id);
          live.delete(round.id);
          continue;
        }
      }
      previous.set(round.id, { latDeg: round.latDeg, lonDeg: round.lonDeg, altMeters: round.altMeters });
    }
    for (const missile of view.missiles) {
      const id = missile.launch.missileId;
      live.add(id);
      const from = previous.get(id) ?? origin.get(id) ?? missile;
      const traveled = origin.has(id) ? distanceM(origin.get(id)!, missile) : 0;
      if (damageEnabled && missile.launch.shooterId === selfId) {
        const hit = sweep(id, missile.launch.shooterId, missile.launch.seq, from, missile, MISSILE_HIT_RADIUS_M, MISSILE_HIT_POINTS, selfId, nowMs, MISSILE_ARM_M - traveled);
        if (hit) {
          claims.push(hit);
          world.dismiss(id);
          live.delete(id);
          continue;
        }
      }
      previous.set(id, { latDeg: missile.latDeg, lonDeg: missile.lonDeg, altMeters: missile.altMeters });
    }
    for (const id of previous.keys()) if (!live.has(id)) previous.delete(id);
    return { draw: drawList(view.rounds, view.missiles, live), claims, damage };
  }

  function acceptHits(selfId: string, nowMs: number, damage: number[]): void {
    if (nowMs - hitWindow > 1000) { hitWindow = nowMs; hitCount = 0; }
    const pending = queued;
    queued = [];
    for (const hit of pending) {
      if (hit.targetId !== selfId || hit.shooterId === selfId) continue;
      if (seenHits.has(hit.hitId) || hitCount >= HIT_BUDGET) continue;
      seenHits.add(hit.hitId);
      hitOrder.push(hit.hitId);
      if (hitOrder.length > 256) {
        const old = hitOrder.shift();
        if (old) seenHits.delete(old);
      }
      hitCount += 1;
      damage.push(hit.points);
      dismissHit(hit);
    }
  }

  function dismissHit(hit: WeaponHit): void {
    if (hit.hitId.startsWith("m")) { world.dismiss(hit.hitId); return; }
    const match = /^g(\d+)i(\d+)$/.exec(hit.hitId);
    if (match) world.dismiss(`${hit.shooterId}:${match[1]}:${match[2]}`);
  }

  function sweep(
    id: string, shooterId: string, seq: number, from: Geodetic, to: Geodetic,
    radius: number, points: number, selfId: string, nowMs: number, armRemaining: number,
  ): WeaponHit | null {
    if (armRemaining > 0) return null;
    for (const target of targets) {
      if (target.pilotId === selfId || target.pilotId === shooterId) continue;
      if (!segmentHits(from, to, target.place, radius)) continue;
      return { hitId: id, shooterId, targetId: target.pilotId, seq, tMs: nowMs, points };
    }
    return null;
  }

  return { ingest, track, step, reset() {
    world = createSessionWorld(); previous.clear(); origin.clear(); queued = []; guided.clear(); lastNow = null;
  } };
}

function drawList(rounds: DrawnRound[], missiles: MissileState[], live: Set<string>): CombatDraw[] {
  const draw: CombatDraw[] = [];
  for (const round of rounds) {
    if (!live.has(round.id)) continue;
    draw.push({ id: round.id, kind: "round", latDeg: round.latDeg, lonDeg: round.lonDeg, altMeters: round.altMeters,
      northMps: round.northMps, eastMps: round.eastMps, upMps: round.upMps });
  }
  for (const missile of missiles) {
    if (!live.has(missile.launch.missileId)) continue;
    draw.push({
      id: missile.launch.missileId, kind: "missile",
      latDeg: missile.latDeg, lonDeg: missile.lonDeg, altMeters: missile.altMeters,
      northMps: missile.northMps, eastMps: missile.eastMps, upMps: missile.upMps,
    });
  }
  return draw;
}

function gunHitId(id: string): string {
  const match = /:(\d+):(\d+)$/.exec(id);
  return match ? `g${match[1]}i${match[2]}`.slice(0, 32) : "g0i0";
}

function segmentHits(from: Geodetic, to: Geodetic, center: Geodetic, radius: number): boolean {
  const a = nedFrom(center, from);
  const b = nedFrom(center, to);
  const ax = a.northM;
  const ay = a.eastM;
  const az = -a.downM;
  const bx = b.northM;
  const by = b.eastM;
  const bz = -b.downM;
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (ab2 > 1e-8) t = Math.min(1, Math.max(0, -(ax * abx + ay * aby + az * abz) / ab2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const cz = az + abz * t;
  return cx * cx + cy * cy + cz * cz <= radius * radius;
}
