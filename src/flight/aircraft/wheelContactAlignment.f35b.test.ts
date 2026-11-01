import { readFileSync } from "node:fs";
import { Matrix, NullEngine, Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { groundContactBodyPosition } from "@0sfs/ground-contact/collisionGeometry";

interface GltfNode {
  name: string;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
}

function location(xml: string) {
  const number = (axis: string) => Number(new RegExp(`<${axis}>\\s*([^<]+)</${axis}>`).exec(xml)![1]);
  return { xIn: number("x"), yIn: number("y"), zIn: number("z") };
}

// Read the shipped mesh hierarchy rather than copying nominal wheel stations.
// The axle origin is also the centre of the lowest tire tread; asymmetric hubs
// mean the full wheel bounding box has a different lateral centre.
function assetAxles() {
  const asset = readFileSync(new URL("../../../public/aircraft/f-35b/F-35B_AF267-airframe.glb", import.meta.url));
  const gltf = JSON.parse(asset.subarray(20, 20 + asset.readUInt32LE(12)).toString()) as { nodes: GltfNode[] };
  const manifest = JSON.parse(readFileSync(new URL("../../../../F-35B/public/0sfs-mod.json", import.meta.url), "utf8"));
  const definition = manifest.aircraft.definitions[0] as { modelYawRad: number; modelOffset: { x: number; y: number; z: number } };
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const nodes = gltf.nodes.map(data => {
      const node = new TransformNode(data.name, scene);
      if (data.translation) node.position.set(...data.translation);
      if (data.scale) node.scaling.set(...data.scale);
      node.rotationQuaternion = data.rotation ? new Quaternion(...data.rotation) : Quaternion.Identity();
      return node;
    });
    gltf.nodes.forEach((data, index) => { for (const child of data.children ?? []) nodes[child].parent = nodes[index]; });
    const yaw = Matrix.RotationY(definition.modelYawRad);
    return Object.fromEntries(["noseWheel", "leftWheel", "rightWheel"].map(name => {
      const node = nodes.find(candidate => candidate.name === name)!;
      node.computeWorldMatrix(true);
      const point = Vector3.TransformCoordinates(node.getAbsolutePosition(), yaw);
      return [name, point.add(new Vector3(definition.modelOffset.x, definition.modelOffset.y, definition.modelOffset.z))];
    }));
  } finally { scene.dispose(); engine.dispose(); }
}

describe("F-35B wheel-contact geometry", () => {
  it.each(["F-35B-jsbsim", "F-35B-jsbsim-empirical"])("aligns %s bogeys under the distributed wheel axles", model => {
    const xml = readFileSync(new URL(`../../../public/jsbsim-data/aircraft/${model}/${model}.xml`, import.meta.url), "utf8");
    const cg = location(/<location name="CG"[^>]*>([\s\S]*?)<\/location>/.exec(xml)![1]);
    const axles = assetAxles();
    for (const [contact, node] of [["NOSE", "noseWheel"], ["LEFT_MAIN", "leftWheel"], ["RIGHT_MAIN", "rightWheel"]]) {
      const body = /<ground_reactions>([\s\S]*?)<\/ground_reactions>/.exec(xml)![1];
      const native = location(new RegExp(`<contact type="BOGEY" name="${contact}">([\\s\\S]*?)<\\/contact>`).exec(body)![1]);
      const actual = groundContactBodyPosition(native, cg);
      expect(actual.left, `${model} ${contact} lateral axle alignment`).toBeCloseTo(axles[node].x, 5);
      expect(actual.forward, `${model} ${contact} fore/aft axle alignment`).toBeCloseTo(axles[node].z, 5);
      // Vertical station remains the original uncompressed suspension reference.
      expect(native.zIn).toBe(-73.7);
    }
  });
});
