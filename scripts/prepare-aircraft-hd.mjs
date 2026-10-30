import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { symmetricTriangles } from './rotorSymmetry.mjs';

// Keep the downloaded source intact. Reframe its scene in metres without
// changing vertex attributes, textures or materials.
const [input, output, scaleText, credit, rotorFile, gimbalFile] = process.argv.slice(2);
const scale = Number(scaleText);
if (!input || !output || !Number.isFinite(scale) || scale <= 0 || !credit?.trim()) {
  throw new Error('Usage: prepare-aircraft-hd.mjs input.glb output.glb metres-per-unit credit [rotors.json] [gimbal.json]');
}
const source = await readFile(input);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) throw new Error('Expected GLB 2');
const chunks = [];
for (let offset = 12; offset < source.length;) {
  const length = source.readUInt32LE(offset), type = source.readUInt32LE(offset + 4);
  chunks.push({ type, bytes: source.subarray(offset + 8, offset + 8 + length) });
  offset += 8 + length;
}
const gltf = JSON.parse(chunks.find(chunk => chunk.type === 0x4e4f534a).bytes.toString('utf8'));
const bounds = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
let triangles = 0, turnedTriangles = 0, movedTriangles = 0;
const worlds = new Map();
function visit(index, parent) {
  const node = gltf.nodes[index];
  const local = node.matrix ? Matrix.FromArray(node.matrix) : Matrix.Compose(
    Vector3.FromArray(node.scale ?? [1, 1, 1]), Quaternion.FromArray(node.rotation ?? [0, 0, 0, 1]),
    Vector3.FromArray(node.translation ?? [0, 0, 0]));
  const world = local.multiply(parent);
  worlds.set(index,world);
  if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    if (!accessor.min || !accessor.max) throw new Error('POSITION bounds are required');
    for (let corner = 0; corner < 8; corner++) {
      const point = Vector3.TransformCoordinates(new Vector3(...[0, 1, 2].map(axis =>
        (corner & (1 << axis) ? accessor.max : accessor.min)[axis])), world);
      bounds.min.minimizeInPlace(point); bounds.max.maximizeInPlace(point);
    }
    if ((primitive.mode ?? 4) === 4) triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
  for (const child of node.children ?? []) visit(child, world);
}
const scene = gltf.scenes[gltf.scene ?? 0];
for (const root of scene.nodes) visit(root, Matrix.Identity());
const center = bounds.min.add(bounds.max).scale(0.5);
const frame = gltf.nodes.length;
gltf.nodes.push({ name: '0sfs-hd-frame', children: scene.nodes,
  scale: [scale, scale, scale], translation: center.scale(-scale).asArray() });
scene.nodes = [frame];
// Author-supplied pivot mapping. Preserve each blade's full authored world
// transform. A rotor's optional `axis` is its motor's spin axis, which the
// pivot's +Y follows; its optional `motor` lists the parts that turn with it.
if (rotorFile) {
  const rotors = JSON.parse(await readFile(rotorFile, 'utf8'));
  for (const [index, rotor] of rotors.entries()) {
    const rotation = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), Vector3.FromArray(rotor.axis ?? [0, 1, 0]).normalize(), rotation);
    const toPivot = Matrix.Compose(Vector3.One(), rotation, Vector3.FromArray(rotor.center)).invert();
    const children = [];
    const attach = nodeIndex => {
      for (const node of gltf.nodes) if (node.children) node.children = node.children.filter(child => child !== nodeIndex);
      const node = gltf.nodes[nodeIndex];
      delete node.translation; delete node.rotation; delete node.scale;
      node.matrix = gltfMatrix(worlds.get(nodeIndex).multiply(toPivot));
      children.push(nodeIndex);
    };
    for (const name of rotor.blades) attach(meshNode(name, 'rotor blade'));
    for (const turning of splitMotor(rotor.motor ?? [], toPivot)) attach(turning);
    const pivot = gltf.nodes.length;
    gltf.nodes.push({ name: `drone-rotor-${index}`, translation: rotor.center, rotation: rotation.asArray(), children });
    gltf.nodes[frame].children.push(pivot);
  }
}
/** glTF wants a JSON array; a Matrix's own Float32Array would serialize as an object. */
function gltfMatrix(matrix) {
  return Array.from(matrix.asArray());
}
function meshNode(name, role) {
  const index = gltf.nodes.findIndex(node => node.mesh !== undefined && node.name === name);
  if (index < 0) throw new Error(`Missing ${role} ${name}`);
  return index;
}
/**
 * Splits the motor parts that turn with a rotor, each a node name or
 * { node, components } as in gimbal.json. Triangles that look different as
 * they turn move to a new `<node>-turning` node, returned for the pivot; at
 * propeller speed the rotor shows them only within its semi-transparent
 * sweep. Surfaces of revolution look the same turning or still, so they stay
 * on the original node, solid.
 */
function splitMotor(entries, toPivot) {
  const parts = [], named = new Set();
  for (const entry of entries.map(entry => typeof entry === 'string' ? { node: entry } : entry)) {
    if (named.has(entry.node)) throw new Error(`Motor part ${entry.node} is listed twice`);
    named.add(entry.node);
    const nodeIndex = meshNode(entry.node, 'motor part'), mesh = gltf.meshes[gltf.nodes[nodeIndex].mesh];
    if (entry.components && mesh.primitives.length !== 1) throw new Error(`Component mapping requires a single primitive in ${entry.node}`);
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4) throw new Error(`Motor part ${entry.node} must contain triangles`);
      const positions = readAccessor(primitive.attributes.POSITION);
      let turning = primitive.indices === undefined ? positions.map((_, i) => i) : readAccessor(primitive.indices).flat(), fixed = [];
      if (entry.components) {
        const pieces = meshComponents(nodeIndex, primitive, 1e-7);
        if (entry.components.some(component => !pieces[component])) throw new Error(`Invalid motor component in ${entry.node}`);
        turning = entry.components.flatMap(component => pieces[component]);
        fixed = pieces.flatMap((piece, component) => entry.components.includes(component) ? [] : piece);
      }
      const toRotor = worlds.get(nodeIndex).multiply(toPivot);
      const points = positions.map(point => Vector3.TransformCoordinates(Vector3.FromArray(point), toRotor).asArray());
      parts.push({ nodeIndex, mesh, primitive, points, turning, still: fixed, moving: [] });
    }
  }
  if (!parts.length) return [];
  // Classified together, so parts that close one turn between them read as round.
  const points = [], indices = [];
  let radius = 0;
  for (const part of parts) {
    part.first = indices.length / 3;
    for (const index of part.turning) {
      indices.push(points.length + index);
      radius = Math.max(radius, Math.hypot(part.points[index][0], part.points[index][2]));
    }
    for (const point of part.points) points.push(point);
  }
  const symmetric = symmetricTriangles(points, indices, { cell: radius / 20 });
  for (const part of parts) for (let i = 0; i < part.turning.length; i += 3) {
    (symmetric[part.first + i / 3] ? part.still : part.moving).push(part.turning[i], part.turning[i + 1], part.turning[i + 2]);
  }
  const created = [];
  for (const nodeIndex of new Set(parts.map(part => part.nodeIndex))) {
    const own = parts.filter(part => part.nodeIndex === nodeIndex), node = gltf.nodes[nodeIndex], mesh = own[0].mesh;
    const subset = (key, suffix) => ({ ...mesh, name: `${node.name}-${suffix}`,
      primitives: own.filter(part => part[key].length).map(part => ({ ...part.primitive, indices: writeIndices(part[key]) })) });
    if (!own.some(part => part.moving.length)) continue;
    gltf.meshes.push(subset('moving', 'turning'));
    gltf.nodes.push({ name: `${node.name}-turning`, mesh: gltf.meshes.length - 1 });
    worlds.set(gltf.nodes.length - 1, worlds.get(nodeIndex));
    created.push(gltf.nodes.length - 1);
    // Other instances of the original mesh must remain intact.
    if (own.some(part => part.still.length)) { gltf.meshes.push(subset('still', 'still')); node.mesh = gltf.meshes.length - 1; }
    else delete node.mesh;
  }
  turnedTriangles += indices.length / 3;
  movedTriangles += parts.reduce((sum, part) => sum + part.moving.length / 3, 0);
  return created;
}
// Split only disconnected authored shells, retaining the original attribute
// accessors/materials. This lets a merged camera/support mesh articulate at
// its physical joints without cutting triangles or modifying the source GLB.
function readAccessor(index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
  const binary = chunks.find(chunk => chunk.type === 0x004e4942).bytes;
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  const readers = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
  const size = sizes[accessor.componentType], read = readers[accessor.componentType];
  if (!size || !dimensions || accessor.sparse) throw new Error('Unsupported gimbal accessor');
  const stride = view.byteStride ?? dimensions * size, offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count }, (_, i) => Array.from({ length: dimensions }, (_, j) => binary[read](offset + i * stride + j * size)));
}
function writeIndices(indices) {
  const binary = chunks.find(chunk => chunk.type === 0x004e4942);
  const padding = Buffer.alloc((4 - binary.bytes.length % 4) % 4), offset = binary.bytes.length + padding.length;
  const bytes = Buffer.alloc(indices.length * 4);
  indices.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  binary.bytes = Buffer.concat([binary.bytes, padding, bytes]);
  gltf.buffers[0].byteLength = binary.bytes.length;
  const bufferView = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34963 });
  const accessor = gltf.accessors.length;
  gltf.accessors.push({ bufferView, componentType: 5125, count: indices.length, type: 'SCALAR', min: [Math.min(...indices)], max: [Math.max(...indices)] });
  return accessor;
}
function meshComponents(nodeIndex, primitive, tolerance) {
  if ((primitive.mode ?? 4) !== 4) throw new Error('Gimbal meshes must contain triangles');
  const positions = readAccessor(primitive.attributes.POSITION);
  const points = positions.map(point => Vector3.TransformCoordinates(Vector3.FromArray(point), worlds.get(nodeIndex)));
  const indices = primitive.indices === undefined ? positions.map((_, index) => index) : readAccessor(primitive.indices).flat();
  const parents = points.map((_, index) => index), coincident = new Map();
  const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const unite = (a, b) => { parents[find(a)] = find(b); };
  points.forEach((point, index) => {
    const key = point.asArray().map(value => Math.round(value / tolerance)).join(',');
    if (coincident.has(key)) unite(index, coincident.get(key)); else coincident.set(key, index);
  });
  for (let i = 0; i < indices.length; i += 3) { unite(indices[i], indices[i + 1]); unite(indices[i], indices[i + 2]); }
  const groups = new Map();
  points.forEach((_, index) => { const root = find(index); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(index); });
  const components = [...groups.values()].sort((a, b) => b.length - a.length);
  const byRoot = new Map(components.map((vertices, index) => [find(vertices[0]), index]));
  const parts = components.map(() => []);
  for (let i = 0; i < indices.length; i += 3) parts[byRoot.get(find(indices[i]))].push(...indices.slice(i, i + 3));
  return parts;
}
if (gimbalFile) {
  const gimbal = JSON.parse(await readFile(gimbalFile, 'utf8'));
  const stageCenters = new Map();
  const stageNodes = new Map();
  const base = gltf.nodes.length;
  const origin = gimbal.stages[0].center;
  gltf.nodes.push({ name: 'drone-model-gimbal-base', translation: origin, children: [] });
  gltf.nodes[frame].children.push(base);
  let parent = base, parentCenter = origin;
  for (const stage of gimbal.stages) {
    const index = gltf.nodes.length;
    gltf.nodes.push({ name: `drone-model-gimbal-${stage.axis}`, translation: stage.center.map((value, axis) => value - parentCenter[axis]), children: [] });
    gltf.nodes[parent].children.push(index); stageNodes.set(stage.axis, index); stageCenters.set(stage.axis, stage.center);
    parent = index; parentCenter = stage.center;
  }
  const selections = new Map();
  for (const stage of gimbal.stages) for (const part of stage.parts) {
    const entry = typeof part === 'string' ? { node: part } : part;
    if (!selections.has(entry.node)) selections.set(entry.node, []);
    selections.get(entry.node).push({ ...entry, axis: stage.axis });
  }
  const place = (index, stage) => {
    for (const node of gltf.nodes) if (node.children) node.children = node.children.filter(child => child !== index);
    const center = stageCenters.get(stage), relative = worlds.get(index).multiply(Matrix.Translation(-center[0], -center[1], -center[2]));
    const node = gltf.nodes[index];
    delete node.translation; delete node.rotation; delete node.scale;
    node.matrix = gltfMatrix(relative); gltf.nodes[stageNodes.get(stage)].children.push(index);
  };
  for (const [name, entries] of selections) {
    const index = gltf.nodes.findIndex(node => node.mesh !== undefined && node.name === name);
    if (index < 0) throw new Error(`Missing gimbal mesh ${name}`);
    if (entries.length === 1 && !entries[0].components) { place(index, entries[0].axis); continue; }
    if (entries.some(entry => !entry.components)) throw new Error(`Mixed whole/component gimbal mapping for ${name}`);
    const mesh = gltf.meshes[gltf.nodes[index].mesh];
    if (mesh.primitives.length !== 1) throw new Error(`Component mapping requires a single primitive in ${name}`);
    const primitive = mesh.primitives[0], parts = meshComponents(index, primitive, gimbal.componentTolerance);
    const expected = gimbal.componentTriangles?.[name];
    if (!expected || expected.length !== parts.length || expected.some((count, part) => count !== parts[part].length / 3)) throw new Error(`Authored gimbal components changed in ${name}`);
    const used = new Set();
    for (const entry of entries) {
      const indices = entry.components.flatMap(component => {
        if (!parts[component] || used.has(component)) throw new Error(`Invalid or repeated gimbal component ${name}:${component}`);
        used.add(component); return parts[component];
      });
      const splitMesh = gltf.meshes.length;
      gltf.meshes.push({ ...mesh, name: `${name}-${entry.axis}`, primitives: [{ ...primitive, indices: writeIndices(indices) }] });
      const splitNode = gltf.nodes.length;
      gltf.nodes.push({ name: `${name}-${entry.axis}`, mesh: splitMesh });
      worlds.set(splitNode, worlds.get(index)); place(splitNode, entry.axis);
    }
    const remaining = parts.flatMap((indices, component) => used.has(component) ? [] : indices);
    if (remaining.length) {
      // Other instances of the original mesh must remain intact.
      const fixedMesh = gltf.meshes.length;
      gltf.meshes.push({ ...mesh, name: `${name}-fixed`, primitives: [{ ...primitive, indices: writeIndices(remaining) }] });
      gltf.nodes[index].mesh = fixedMesh;
    } else delete gltf.nodes[index].mesh;
  }
}

// The credit is the model's whole attribution, as the aircraft manifest shows it.
gltf.asset.copyright = credit.trim();
gltf.asset.extras = { ...gltf.asset.extras,
  changes: 'Scene recentered, converted to metres, with declared motor pivots turned onto their motor axes, the motor parts that turn and are not round moved onto them, and disconnected gimbal shells assigned to separate yaw, roll and camera pitch joints.', metresPerSourceUnit: scale };
const json = Buffer.from(JSON.stringify(gltf));
chunks.find(chunk => chunk.type === 0x4e4f534a).bytes = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const header = Buffer.alloc(12);header.writeUInt32LE(0x46546c67, 0);header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0), 8);
const result = [header];
for (const chunk of chunks) { const h = Buffer.alloc(8);h.writeUInt32LE(chunk.bytes.length, 0);h.writeUInt32LE(chunk.type, 4);result.push(h, chunk.bytes); }
await mkdir(path.dirname(output), { recursive: true });await writeFile(output, Buffer.concat(result));
console.log(JSON.stringify({ output, triangles, motorTriangles: { turning: turnedTriangles, moved: movedTriangles }, sizeMeters: bounds.max.subtract(bounds.min).scale(scale).asArray(), centerSource: center.asArray() }));
