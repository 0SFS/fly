import { readFileSync } from "node:fs";

/** Metres in the frame the app draws an aircraft model in: left, up, forward. */
export interface ModelPoint { left: number; up: number; forward: number }

/** The lowest vertex in each quarter of the model seen from above, as where it stands on flat ground. */
export interface ModelLowestPoints { frontLeft: ModelPoint; frontRight: ModelPoint; rearLeft: ModelPoint; rearRight: ModelPoint }

type Matrix = number[];
interface GltfNode { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number; children?: number[] }
interface Gltf {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  extensionsRequired?: string[];
}

const FLOAT = 5126;

/** Column-major 4x4 product, as glTF stores its matrices. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function localMatrix(node: GltfNode): Matrix {
  if (node.matrix) return [...node.matrix];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!, (2 * (x! * y! + z! * w!)) * sx!, (2 * (x! * z! - y! * w!)) * sx!, 0,
    (2 * (x! * y! - z! * w!)) * sy!, (1 - 2 * (x! * x! + z! * z!)) * sy!, (2 * (y! * z! + x! * w!)) * sy!, 0,
    (2 * (x! * z! + y! * w!)) * sz!, (2 * (y! * z! - x! * w!)) * sz!, (1 - 2 * (x! * x! + y! * y!)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

/**
 * Reads an uncompressed GLB and finds its lowest vertex in each quarter. The
 * model's frame is the one the app draws it in, with `modelYawRad` 0: glTF +X
 * left, +Y up, +Z forward.
 */
export function modelLowestPoints(path: string): ModelLowestPoints {
  const file = readFileSync(path);
  const bytes = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (bytes.getUint32(0, true) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLength = bytes.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength))) as Gltf;
  if (gltf.extensionsRequired?.length) throw new Error(`${path} needs ${gltf.extensionsRequired.join(", ")}, which this reader does not decode`);
  // The binary chunk follows the JSON chunk and its own 8-byte header.
  const binary = 20 + jsonLength + 8;
  const lowest = new Map<keyof ModelLowestPoints, ModelPoint>();
  const visit = (index: number, parent: Matrix): void => {
    const node = gltf.nodes[index]!;
    const world = multiply(parent, localMatrix(node));
    for (const primitive of node.mesh === undefined ? [] : gltf.meshes[node.mesh]!.primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION]!;
      if (accessor.componentType !== FLOAT || accessor.type !== "VEC3") throw new Error(`${path} has positions this reader does not decode`);
      const view = gltf.bufferViews[accessor.bufferView]!;
      const stride = view.byteStride ?? 12;
      const start = binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      for (let vertex = 0; vertex < accessor.count; vertex++) {
        const at = start + vertex * stride;
        const x = bytes.getFloat32(at, true), y = bytes.getFloat32(at + 4, true), z = bytes.getFloat32(at + 8, true);
        const point = {
          left: world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
          up: world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
          forward: world[2]! * x + world[6]! * y + world[10]! * z + world[14]!,
        };
        const key = `${point.forward > 0 ? "front" : "rear"}${point.left > 0 ? "Left" : "Right"}` as keyof ModelLowestPoints;
        const known = lowest.get(key);
        if (!known || point.up < known.up) lowest.set(key, point);
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const index of gltf.scenes[gltf.scene ?? 0]!.nodes) visit(index, identity);
  const quarter = (key: keyof ModelLowestPoints): ModelPoint => {
    const point = lowest.get(key);
    if (!point) throw new Error(`${path} has nothing in its ${key} quarter`);
    return point;
  };
  return { frontLeft: quarter("frontLeft"), frontRight: quarter("frontRight"), rearLeft: quarter("rearLeft"), rearRight: quarter("rearRight") };
}

const moved = (point: ModelPoint, offset: { x: number; y: number; z: number }): ModelPoint =>
  ({ left: point.left + offset.x, up: point.up + offset.y, forward: point.forward + offset.z });

/**
 * Where a mod's aircraft stands as the app draws it: the lowest points of its
 * detailed model, moved by its definition's model offset.
 */
export function drawnModelFeet(modDirectory: string): ModelLowestPoints {
  const manifest = JSON.parse(readFileSync(`${modDirectory}/public/0sfs-mod.json`, "utf8"));
  const definition = manifest.aircraft.definitions[0];
  if ((definition.modelYawRad ?? 0) !== 0) throw new Error(`${modDirectory} draws its model yawed, which these feet do not account for`);
  const detailed = (definition.lods as { path?: string }[]).find(lod => lod.path);
  if (!detailed) throw new Error(`${modDirectory} has no detailed model`);
  const points = modelLowestPoints(`${modDirectory}/public/${detailed.path}`);
  const offset = definition.modelOffset ?? { x: 0, y: 0, z: 0 };
  return { frontLeft: moved(points.frontLeft, offset), frontRight: moved(points.frontRight, offset),
    rearLeft: moved(points.rearLeft, offset), rearRight: moved(points.rearRight, offset) };
}

/** The nose-up pitch, in radians, at which all four feet stand on flat ground. */
export function standingPitchRad(feet: ModelLowestPoints): number {
  const frontUp = (feet.frontLeft.up + feet.frontRight.up) / 2, rearUp = (feet.rearLeft.up + feet.rearRight.up) / 2;
  const frontForward = (feet.frontLeft.forward + feet.frontRight.forward) / 2;
  const rearForward = (feet.rearLeft.forward + feet.rearRight.forward) / 2;
  return Math.atan2(rearUp - frontUp, frontForward - rearForward);
}
