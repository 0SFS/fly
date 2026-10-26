import { Color3, CreateBox, Matrix, Quaternion, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import { geodeticToEcef, type EcefCoord } from "foss-earth/cameraMath";
import { isAircraftId } from "@0sfs/aircraft/aircraftCatalog";
import { createAircraftModel } from "@0sfs/aircraft/createAircraftModel";
import { applyAircraftRig, NEUTRAL_CONTROL_SURFACES } from "@0sfs/aircraft/aircraftAnimation";
import { flightAttitudeToQuaternion } from "@0sfs/ground-contact/ecefBridge";
import { buildWorldShiftMatrix } from "../bridge/enuFrame";
import type { ShownPose } from "@0sfs/multiplayer/posePlayout";

export interface RemoteAircraftFrame { origin: EcefCoord; m: ArrayLike<number> }

/** Remote poses share the local aircraft's floating frame, without cameras or another FDM. */
export function createRemoteAircraft(scene: Scene, requestRender: () => void) {
  const root = new TransformNode("multiplayer-aircraft", scene);
  const body = CreateBox("multiplayer-fallback-body", { width: 1.4, height: 1.4, depth: 8 }, scene);
  const wing = CreateBox("multiplayer-fallback-wing", { width: 11, height: 0.18, depth: 1.8 }, scene);
  body.parent = wing.parent = root;
  const material = new StandardMaterial("multiplayer-fallback", scene);
  material.diffuseColor = new Color3(0.2, 0.7, 0.85);
  body.material = wing.material = material;
  body.isPickable = wing.isPickable = false;
  let model: ReturnType<typeof createAircraftModel> | null = null;
  let aircraftId = "";
  const worldRotation = new Quaternion();
  const remoteFrameRotation = new Quaternion();
  const localRotation = new Quaternion();
  const scale = new Vector3(), translation = new Vector3();
  const worldMatrix = Matrix.Identity();
  root.setEnabled(false);
  return {
    update(shown: ShownPose | undefined, frame: RemoteAircraftFrame | null, dt: number) {
      root.setEnabled(Boolean(shown && frame));
      if (!shown || !frame) return;
      const pose = shown.pose;
      if (pose.aircraftId !== aircraftId) {
        aircraftId = pose.aircraftId; model?.dispose(); model = null;
        body.setEnabled(true); wing.setEnabled(true);
        if (isAircraftId(aircraftId)) model = createAircraftModel(scene, root, {
          aircraftId, lodId: "lod0", requestRender,
          onStateChange: state => { const fallback = state.status !== "ready"; body.setEnabled(fallback); wing.setEnabled(fallback); },
        });
      }
      const radians = Math.PI / 180;
      const localFrame = Matrix.FromArray(frame.m);
      const ecef = geodeticToEcef(pose.latDeg * radians, pose.lonDeg * radians, pose.altMeters);
      const { m, origin } = frame;
      const dx = ecef.x - origin.x, dy = ecef.y - origin.y, dz = ecef.z - origin.z;
      // Subtract in double precision before Babylon stores metre-scale coordinates.
      root.position.set(m[0] * dx + m[4] * dy + m[8] * dz, m[1] * dx + m[5] * dy + m[9] * dz, m[2] * dx + m[6] * dy + m[10] * dz);
      // The attitude is in NED at the remote place. Rotate that tangent frame into ours.
      const remoteFrame = buildWorldShiftMatrix(pose.latDeg * radians, pose.lonDeg * radians, pose.altMeters);
      remoteFrame.decompose(scale, remoteFrameRotation, translation);
      localFrame.decompose(scale, localRotation, translation);
      const remoteToLocal = Matrix.FromQuaternionToRef(remoteFrameRotation.conjugate(), worldMatrix).multiply(Matrix.FromQuaternionToRef(localRotation, Matrix.Identity()));
      remoteToLocal.decompose(scale, worldRotation, translation);
      root.rotationQuaternion = worldRotation.multiply(flightAttitudeToQuaternion(pose.rollRad, pose.pitchRad, pose.headingRad));
      model?.updateGearVisibility(pose.gearDown ? 1 : 0, true);
      const rig = model?.getRig();
      if (rig) applyAircraftRig(rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: pose.gearDown ? 1 : 0,
        flapRad: pose.flapsNorm * Math.PI / 6, nozzlePositionNorm: pose.nozzleNorm }, dt, { simulationHeld: shown.held || shown.stale });
    },
    dispose() { model?.dispose(); root.dispose(); material.dispose(); },
  };
}
