/**
 * Tracers and missile bodies. One mesh each, instanced, so a burst does not
 * allocate geometry. Positions share the aircraft's floating frame.
 */

import { Color3, CreateBox, Matrix, Quaternion, StandardMaterial, Vector3, type Scene } from "@babylonjs/core";
import { geodeticToEcef } from "foss-earth/cameraMath";
import { geodeticFrom } from "@0sfs/multiplayer/geodetic";
import type { CombatDraw } from "./engagement";

export interface ProjectileFrame { origin: { x: number; y: number; z: number }; m: ArrayLike<number> }

const MAX_ROUNDS = 320;
const MAX_MISSILES = 8;

export function createProjectileView(scene: Scene) {
  const tracer = mesh(scene, "gun-tracer", new Color3(1, 0.86, 0.35), 0.08, 0.08, 2.4);
  const missile = mesh(scene, "missile-body", new Color3(0.85, 0.88, 0.92), 0.18, 0.18, 2.8);
  const rounds = new Float32Array(MAX_ROUNDS * 16);
  const missiles = new Float32Array(MAX_MISSILES * 16);
  const point = new Vector3();
  const ahead = new Vector3();
  const direction = new Vector3();
  const rotation = new Quaternion();
  const matrix = Matrix.Identity();
  const scale = new Vector3(1, 1, 1);
  const forward = Vector3.Forward();
  let roundCount = 0;
  let missileCount = 0;

  function update(draw: readonly CombatDraw[], frame: ProjectileFrame | null): void {
    let roundsUsed = 0;
    let missilesUsed = 0;
    if (frame) {
      for (const item of draw) {
        if (item.kind === "round" && roundsUsed >= MAX_ROUNDS) continue;
        if (item.kind === "missile" && missilesUsed >= MAX_MISSILES) continue;
        if (!place(item.latDeg, item.lonDeg, item.altMeters, frame, point)) continue;
        const next = geodeticFrom(item, { northM: item.northMps * 0.02, eastM: item.eastMps * 0.02, downM: -item.upMps * 0.02 });
        if (!place(next.latDeg, next.lonDeg, next.altMeters, frame, ahead)) continue;
        direction.set(ahead.x - point.x, ahead.y - point.y, ahead.z - point.z);
        if (direction.lengthSquared() < 1e-8) direction.set(0, 0, 1);
        else direction.normalize();
        Quaternion.FromUnitVectorsToRef(forward, direction, rotation);
        Matrix.ComposeToRef(scale, rotation, point, matrix);
        const buffer = item.kind === "round" ? rounds : missiles;
        const index = item.kind === "round" ? roundsUsed++ : missilesUsed++;
        matrix.copyToArray(buffer, index * 16);
      }
    }
    if (roundsUsed !== roundCount || roundsUsed > 0) tracer.thinInstanceSetBuffer("matrix", rounds, 16, false);
    if (missilesUsed !== missileCount || missilesUsed > 0) missile.thinInstanceSetBuffer("matrix", missiles, 16, false);
    tracer.thinInstanceCount = roundCount = roundsUsed;
    missile.thinInstanceCount = missileCount = missilesUsed;
    tracer.setEnabled(roundsUsed > 0);
    missile.setEnabled(missilesUsed > 0);
  }

  return {
    update,
    dispose() { tracer.dispose(false, true); missile.dispose(false, true); },
  };
}

function mesh(scene: Scene, name: string, color: Color3, width: number, height: number, depth: number) {
  const box = CreateBox(name, { width, height, depth }, scene);
  const material = new StandardMaterial(`${name}-material`, scene);
  material.emissiveColor = color;
  material.disableLighting = true;
  material.specularColor = Color3.Black();
  box.material = material;
  box.isPickable = false;
  box.alwaysSelectAsActiveMesh = true;
  box.setEnabled(false);
  return box;
}

function place(latDeg: number, lonDeg: number, altMeters: number, frame: ProjectileFrame, out: Vector3): boolean {
  const radians = Math.PI / 180;
  const ecef = geodeticToEcef(latDeg * radians, lonDeg * radians, altMeters);
  const { m, origin } = frame;
  const dx = ecef.x - origin.x;
  const dy = ecef.y - origin.y;
  const dz = ecef.z - origin.z;
  out.set(
    m[0] * dx + m[4] * dy + m[8] * dz,
    m[1] * dx + m[5] * dy + m[9] * dz,
    m[2] * dx + m[6] * dy + m[10] * dz,
  );
  return Number.isFinite(out.x);
}
