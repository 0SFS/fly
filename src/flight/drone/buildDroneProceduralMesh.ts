import { MeshBuilder, StandardMaterial, TransformNode, Vector3, type Mesh, type Scene } from "@babylonjs/core";

/** Body, arms and motors at the rotor model's hubs. */
export function mountDroneProceduralMesh(modelRoot: TransformNode, frame: {
  rotors: readonly { position: string; hubM: readonly [number, number, number]; spin: 1 | -1 }[];
  cgM: readonly [number, number, number];
  propellerRadiusM: number;
}): () => void {
  const scene = modelRoot.getScene() as Scene;
  const nodes: Mesh[] = [];
  const pivots: TransformNode[] = [];
  const keep = (node: Mesh): Mesh => {
    node.parent = modelRoot;
    nodes.push(node);
    return node;
  };
  const body = keep(MeshBuilder.CreateBox("drone-body", { width: 0.16, height: 0.05, depth: 0.12 }, scene));
  const material = new StandardMaterial("drone-body-material", scene);
  body.material = material;
  for (let arm = 0; arm < frame.rotors.length; arm++) {
    const [x, y, z] = frame.rotors[arm].hubM;
    // The flight transform places the model at the CG, rather than the VRP.
    const hub = new Vector3(frame.cgM[1] - y, z - frame.cgM[2], -(x - frame.cgM[0]));
    const box = keep(MeshBuilder.CreateBox(`drone-arm-${arm}`, { width: 0.02, height: 0.012, depth: hub.length() }, scene));
    box.rotation.set(-Math.atan2(hub.y, Math.hypot(hub.x, hub.z)), Math.atan2(hub.x, hub.z), 0);
    box.position.copyFrom(hub).scaleInPlace(0.5);
    const motor = keep(MeshBuilder.CreateBox(`drone-motor-${arm}`, { size: 0.02 }, scene));
    motor.position.copyFrom(hub);
    const pivot = new TransformNode(`drone-rotor-${arm}`, scene);
    pivot.parent = modelRoot;
    pivot.position.copyFrom(motor.position);
    pivots.push(pivot);
    const blades = MeshBuilder.CreateBox(`drone-blades-${arm}`, { width: .014, height: .002, depth: 2 * frame.propellerRadiusM }, scene);
    blades.parent = pivot;
    nodes.push(blades);
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const node of nodes) node.dispose();
    for (const pivot of pivots) pivot.dispose();
    material.dispose();
  };
}
