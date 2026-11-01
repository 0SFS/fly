import { readFileSync } from "node:fs";
import { Mesh, NullEngine, Quaternion, Scene, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { applyAircraftRig, bindAircraftRig, NEUTRAL_CONTROL_SURFACES, readControlSurfaceState } from "@0sfs/aircraft/aircraftAnimation";
import { buildSkinTriangles, classifySkinEnvelope, hasEnvelopeViolation, worldVertices } from "@0sfs/f-35b/validation/gearGeometry";
import { createAircraftWheelDebugOverlay } from "@0sfs/ground-contact/createWheelSpinDebugOverlay";

interface GltfNode {
  name: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
}
interface Gltf {
  nodes: GltfNode[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

/** Use the distributed asset's actual transforms, pivots and wheel geometry. */
function f35bRig(placed = false) {
  const bytes = readFileSync(new URL("../../../public/aircraft/f-35b/F-35B_AF267.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as Gltf;
  const binary = bytes.subarray(28 + jsonLength);
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const nodes = gltf.nodes.map(definition => {
    const node = definition.mesh === undefined ? new TransformNode(definition.name, scene) : new Mesh(definition.name, scene);
    if (node instanceof Mesh && definition.mesh !== undefined) {
      const positions: number[] = [];
      const indices: number[] = [];
      for (const primitive of gltf.meshes[definition.mesh].primitives) {
        const vertexOffset = positions.length / 3;
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        expect(accessor.componentType).toBe(5126);
        expect(accessor.type).toBe("VEC3");
        const view = gltf.bufferViews[accessor.bufferView];
        const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        for (let index = 0; index < accessor.count; index += 1) {
          for (let axis = 0; axis < 3; axis += 1) {
            positions.push(binary.readFloatLE(offset + index * (view.byteStride ?? 12) + axis * 4));
          }
        }
        const indexAccessor = gltf.accessors[primitive.indices];
        const indexView = gltf.bufferViews[indexAccessor.bufferView];
        const indexOffset = (indexView.byteOffset ?? 0) + (indexAccessor.byteOffset ?? 0);
        const indexWidth = indexAccessor.componentType === 5123 ? 2 : 4;
        expect([5123, 5125]).toContain(indexAccessor.componentType);
        for (let index = 0; index < indexAccessor.count; index += 1) {
          const at = indexOffset + index * (indexView.byteStride ?? indexWidth);
          indices.push(vertexOffset + (indexWidth === 2 ? binary.readUInt16LE(at) : binary.readUInt32LE(at)));
        }
      }
      node.setVerticesData(VertexBuffer.PositionKind, positions);
      node.setIndices(indices);
    }
    if (definition.translation) node.position = new Vector3(...definition.translation);
    if (definition.scale) node.scaling = new Vector3(...definition.scale);
    node.rotationQuaternion = definition.rotation ? new Quaternion(...definition.rotation) : Quaternion.Identity();
    return node;
  });
  gltf.nodes.forEach((definition, index) => {
    for (const child of definition.children ?? []) nodes[child].parent = nodes[index];
  });
  let modelRoot: TransformNode | undefined;
  if (placed) {
    const aircraft = new TransformNode("placed-aircraft", scene);
    aircraft.position.set(500, -200, 1000);
    aircraft.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.4, -0.3, 0.2);
    modelRoot = new TransformNode("previous-model-placement", scene);
    modelRoot.parent = aircraft;
    modelRoot.position.set(0, -2.1, 0);
    modelRoot.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.9, 0, 0);
    for (const node of nodes) if (!node.parent) node.parent = modelRoot;
  }
  const byName = new Map(nodes.map(node => [node.name, node]));
  return {
    nodes, byName, modelRoot,
    rig: bindAircraftRig(nodes, { scene, aircraftId: "f-35b", propellerBlades: 0, modelOffsetY: -1.267, modelRoot }),
    dispose: () => { scene.dispose(); engine.dispose(); },
  };
}

function point(node: TransformNode, local = Vector3.Zero()): Vector3 {
  return Vector3.TransformCoordinates(local, node.computeWorldMatrix(true));
}

function nozzlePoint(nozzle: TransformNode, petal: TransformNode, local: Vector3): Vector3 {
  return Vector3.TransformCoordinates(point(petal, local), nozzle.computeWorldMatrix(true).clone().invert());
}

/** The inner free-edge vertex comes from the distributed mesh, not a fabricated probe. */
function nozzleTip(petal: TransformNode): Vector3 {
  const positions = (petal as Mesh).getVerticesData(VertexBuffer.PositionKind)!;
  let tip = Vector3.Zero();
  for (let index = 0; index < positions.length; index += 3) {
    if (positions[index + 2] > tip.z) tip = new Vector3(positions[index], positions[index + 1], positions[index + 2]);
  }
  return tip;
}

describe("AF267 F-35B authored rig", () => {
  it("binds the real moving assemblies and preserves every authored rest transform", () => {
    const t = f35bRig();
    try {
      expect(t.rig.parts).toHaveLength(6);
      expect(t.rig.gear).toHaveLength(10);
      expect(t.rig.stovl).toHaveLength(8);
      expect(t.rig.nozzleArea).toHaveLength(16);
      expect(new Set(t.rig.nozzleArea.map(petal => petal.node.name)).size).toBe(16);
      t.rig.nozzleArea.forEach(petal => expect(t.rig.getNode(petal.node.name)).toBe(petal.node));
      expect(t.rig.getNode("vtol")).toBe(t.byName.get("vtol"));
      expect(t.rig.getNode("missing-attachment")).toBeNull();
      expect(t.rig.wheels).toHaveLength(3);
      expect(t.rig.tyreTextures).toEqual([]);
      expect(t.rig.propeller).toBeNull();
      const rest = t.nodes.map(node => ({ position: node.position.clone(), rotation: node.rotationQuaternion!.clone() }));
      applyAircraftRig(t.rig, NEUTRAL_CONTROL_SURFACES, 0);
      t.nodes.forEach((node, index) => {
        expect(Vector3.Distance(node.position, rest[index].position)).toBeLessThan(1e-8);
        expect(node.rotationQuaternion!.subtract(rest[index].rotation).length()).toBeLessThan(1e-8);
      });
      // The conversion root scales source geometry to real metres.
      const mainWheel = t.rig.wheels.find(wheel => wheel.node.name === "leftWheel")!;
      expect(mainWheel.radius).toBeCloseTo(0.58847517 * 0.83305745, 6);
    } finally { t.dispose(); }
  });

  it("poses each lower suspension from native compression at the real tire tread", () => {
    const t = f35bRig();
    try {
      expect(t.rig.suspension).toHaveLength(3);
      const names = ["noseWheel", "leftWheel", "rightWheel"];
      const axles = names.map(name => point(t.byName.get(name)!));
      const upper = ["noseGear", "leftGear", "rightGear"].map(name => point(t.byName.get(name)!));
      const struts = ["noseStrutB", "leftStrutB", "rightStrutB"].map(name => point(t.byName.get(name)!));
      for (const compression of [0, 0.10, 0.20, 0.28]) {
        const sdk = { getPropertyValue: (key: string) => ({
          "gear/gear-pos-norm": 1, "inertia/cg-z-in": -15.36,
          "gear/unit[0]/WOW": 1, "gear/unit[1]/WOW": 1, "gear/unit[2]/WOW": 1,
          "gear/unit[0]/z-position": -73.70, "gear/unit[1]/z-position": -73.70, "gear/unit[2]/z-position": -73.70,
          "gear/unit[0]/compression-ft": compression / 0.3048,
          "gear/unit[1]/compression-ft": compression / 0.3048,
          "gear/unit[2]/compression-ft": compression / 0.3048,
        })[key] ?? 0 } as unknown as JSBSimSdk;
        const state = readControlSurfaceState(sdk, "f-35b");
        expect(state.wheelCompressionMeters).toEqual([compression, compression, compression]);
        applyAircraftRig(t.rig, state, 0);
        names.forEach((name, index) => {
          const wheel = t.byName.get(name)! as Mesh;
          const bottom = Math.min(...worldVertices(wheel).map(vertex => vertex.y)) - 1.267;
          expect(bottom).toBeCloseTo((-73.70 + 15.36) * 0.0254 + compression, 6);
          const axle = point(wheel);
          expect(axle.x).toBeCloseTo(axles[index].x, 6);
          expect(axle.z).toBeCloseTo(axles[index].z, 6);
          const strut = point(t.byName.get(["noseStrutB", "leftStrutB", "rightStrutB"][index])!);
          expect(strut.y - struts[index].y).toBeCloseTo(axle.y - axles[index].y, 6);
        });
        ["noseGear", "leftGear", "rightGear"].forEach((name, index) =>
          expect(Vector3.Distance(point(t.byName.get(name)!), upper[index])).toBeLessThan(1e-8));
        const before = names.map(name => point(t.byName.get(name)!));
        // Pausing is a repeated observation, not another suspension integration.
        applyAircraftRig(t.rig, state, 10, { simulationHeld: true });
        names.forEach((name, index) => expect(Vector3.Distance(point(t.byName.get(name)!), before[index])).toBeLessThan(1e-8));
      }
    } finally { t.dispose(); }
  });

  it("draws each collision wireframe on its tire, meeting the compressed contact dot", () => {
    const t = f35bRig();
    const overlay = createAircraftWheelDebugOverlay(t.rig.wheels[0].node.getScene(), () => t.rig.wheels);
    try {
      const compression = [0.14, 0.16, 0.17] as const;
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES,
        wheelCompressionMeters: compression, wheelContactUpMeters: [-1.481836, -1.481836, -1.481836] }, 0);
      overlay.setEnabled(true);
      // Tire sidewall half widths in the asset; the hubs reach 0.267 and 0.344.
      const sidewall = [0.1434, 0.1934, 0.1934];
      for (const wheel of t.rig.wheels) {
        const node = wheel.node as Mesh;
        const drawing = node.getChildMeshes(true).find(mesh => mesh.metadata?.collisionDebug?.kind === "wheel-spin")!;
        const local = drawing.getVerticesData(VertexBuffer.PositionKind)!;
        const xs = Array.from({ length: local.length / 3 }, (_, index) => local[index * 3]);
        const bounds = node.getBoundingInfo().boundingBox;
        expect(Math.max(-bounds.minimum.x, bounds.maximum.x)).toBeGreaterThan(sidewall[wheel.gearIndex] + 0.07);
        expect(Math.min(...xs)).toBeCloseTo(-sidewall[wheel.gearIndex], 3);
        expect(Math.max(...xs)).toBeCloseTo(sidewall[wheel.gearIndex], 3);
        const world = Array.from({ length: local.length / 3 }, (_, index) =>
          point(drawing, Vector3.FromArray(local, index * 3)));
        // The dot is drawn at the native contact plus compression, in metres below the CG.
        const dot = (-73.70 + 15.36) * 0.0254 + compression[wheel.gearIndex];
        // The ring is a 32-gon, and the raked nose leg turns its wheel 5 degrees
        // from a vertex: the lowest edge may sit up to one sagitta above the tread.
        const ringAboveDot = Math.min(...world.map(vertex => vertex.y)) - 1.267 - dot;
        expect(ringAboveDot).toBeGreaterThan(-1e-6);
        expect(ringAboveDot).toBeLessThan(wheel.radius * (1 - Math.cos(Math.PI / 32)) + 1e-6);
        expect(Math.min(...worldVertices(node).map(vertex => vertex.y)) - 1.267).toBeCloseTo(dot, 6);
        const axle = point(node);
        const centre = world.reduce((sum, vertex) => sum.addInPlace(vertex), Vector3.Zero()).scaleInPlace(1 / world.length);
        expect(Math.hypot(centre.x - axle.x, centre.z - axle.z)).toBeLessThan(0.01);
      }
    } finally { overlay.dispose(); t.dispose(); }
  });

  it("calibrates suspension independently of the previous model placement and aircraft frame", () => {
    const t = f35bRig(true);
    try {
      // Binding happened while the shared root still held another model's
      // placement. Reveal changes it to this aircraft's authored placement.
      t.modelRoot!.position.set(0, -1.267, 0);
      t.modelRoot!.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
      const compression = [0.13, 0.16, 0.18] as const;
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES,
        wheelCompressionMeters: compression, wheelContactUpMeters: [-1.481836, -1.481836, -1.481836] }, 0);
      const worldToModel = t.modelRoot!.computeWorldMatrix(true).clone().invert();
      for (const wheel of t.rig.wheels) {
        const bottom = Math.min(...worldVertices(wheel.node as Mesh)
          .map(vertex => Vector3.TransformCoordinates(vertex, worldToModel).y)) - 1.267;
        // This NullEngine fixture keeps Float32 world matrices; allow 0.1 mm
        // of roundoff after the kilometre-scale parent placement is cancelled.
        expect(Math.abs(bottom - (-1.481836 + compression[wheel.gearIndex]))).toBeLessThan(0.0001);
      }
    } finally { t.dispose(); }
  });

  it("restores authored lower-leg stow after observing physical compression", () => {
    const t = f35bRig(), authored = f35bRig();
    try {
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, wheelCompressionMeters: [0.1, 0.2, 0.2],
        wheelContactUpMeters: [-1.481836, -1.481836, -1.481836] }, 0);
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0,
        wheelCompressionMeters: [0, 0, 0], wheelContactUpMeters: [-1.481836, -1.481836, -1.481836] }, 0);
      applyAircraftRig(authored.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0);
      for (const name of ["noseSuspension", "leftSuspension", "rightSuspension", "noseWheel", "leftWheel", "rightWheel"]) {
        expect(Vector3.Distance(point(t.byName.get(name)!), point(authored.byName.get(name)!))).toBeLessThan(1e-8);
      }
      const missing = readControlSurfaceState({ getPropertyValue: () => 0 } as unknown as JSBSimSdk, "f-35b");
      expect(missing.wheelContactUpMeters).toBeUndefined();
      expect(missing.wheelCompressionMeters).toBeUndefined();
    } finally { t.dispose(); authored.dispose(); }
  });

  it("deflects swept flaperons and canted rudders about their own hinges", () => {
    const t = f35bRig();
    try {
      const trailingPoints = new Map(t.rig.parts.map(part => [part.node.name,
        point(part.node, part.key === "rudderRad" ? new Vector3(-0.6, 0, 0) : new Vector3(0, 0, 0.6)),
      ]));
      const hinges = t.rig.parts.map(part => point(part.node, part.axis));
      applyAircraftRig(t.rig, {
        ...NEUTRAL_CONTROL_SURFACES, elevatorRad: 0.2, flapRad: 0.2,
        aileronLeftRad: 0.1, aileronRightRad: -0.1, rudderRad: 0.2,
      }, 0);
      t.rig.parts.forEach((part, index) => {
        expect(Vector3.Distance(point(part.node, part.axis), hinges[index])).toBeLessThan(1e-6);
        const local = part.key === "rudderRad" ? new Vector3(-0.6, 0, 0) : new Vector3(0, 0, 0.6);
        const before = trailingPoints.get(part.node.name)!;
        const after = point(part.node, local);
        if (part.key === "rudderRad") expect(after.x).toBeLessThan(before.x);
        else expect(after.y).toBeLessThan(before.y);
      });
      const left = t.rig.parts.find(part => part.node.name === "leftFlaperon")!;
      const right = t.rig.parts.find(part => part.node.name === "rightFlaperon")!;
      const drop = (part: typeof left) => trailingPoints.get(part.node.name)!.y - point(part.node, new Vector3(0, 0, 0.6)).y;
      expect(drop(left)).toBeGreaterThan(drop(right));
    } finally { t.dispose(); }
  });

  it("retracts visible wheels forward/up with the source-author compound inward main pose", () => {
    const t = f35bRig();
    try {
      const names = ["leftWheel", "rightWheel", "noseWheel"];
      const down = names.map(name => point(t.byName.get(name)!));
      const mainHinges = ["leftGear", "rightGear"].map(name => point(t.byName.get(name)!));
      let previous = down;
      for (const gearDownNorm of [0.75, 0.5, 0.25, 0]) {
        applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm }, 0);
        const current = names.map(name => point(t.byName.get(name)!));
        for (let index = 0; index < 2; index += 1) {
          // Standard glTF aircraft forward is -Z. The author's compound
          // path turns slightly aft at its end, while remaining forward of
          // the deployed pose; it also moves inward as the axle cants.
          expect(current[index].z).toBeLessThan(down[index].z - 0.001);
          expect(current[index].y).toBeGreaterThan(previous[index].y);
          expect(Math.abs(current[index].x)).toBeLessThan(Math.abs(previous[index].x));
          expect(Vector3.Distance(point(t.byName.get(index === 0 ? "leftGear" : "rightGear")!), mainHinges[index])).toBeLessThan(1e-6);
        }
        previous = current;
      }
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0);
      const up = names.map(name => point(t.byName.get(name)!));
      for (let index = 0; index < 2; index += 1) {
        expect(up[index].z).toBeLessThan(down[index].z - 1);
        expect(Math.abs(up[index].x)).toBeLessThan(Math.abs(down[index].x) - 0.6);
        expect(up[index].y).toBeGreaterThan(down[index].y + 0.7);
        const axle = Vector3.TransformNormal(Vector3.Right(), t.byName.get(names[index])!.computeWorldMatrix(true)).normalize();
        expect(Math.abs(axle.y)).toBeGreaterThan(0.5);
      }
      expect(up[2].y).toBeGreaterThan(down[2].y + 0.7);
      expect(up[2].z).toBeLessThan(down[2].z);
      expect(up[0].x).toBeCloseTo(-1.467316, 5);
      expect(up[1].x).toBeCloseTo(1.467316, 5);
      expect(up[2].y).toBeCloseTo(1.979676, 5);
      // A camera frame cannot advance an independent visual gear timer.
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0.5 }, 0);
      const middle = names.map(name => point(t.byName.get(name)!));
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0.5 }, 10, { simulationHeld: true });
      names.forEach((name, index) => expect(Vector3.Distance(point(t.byName.get(name)!), middle[index])).toBeLessThan(1e-6));
      applyAircraftRig(t.rig, NEUTRAL_CONTROL_SURFACES, 0);
      names.forEach((name, index) => expect(Vector3.Distance(point(t.byName.get(name)!), down[index])).toBeLessThan(1e-6));
    } finally { t.dispose(); }
  });

  it("puts all actual tire vertices inside the selected exterior skin envelope with visibility on", () => {
    const t = f35bRig();
    try {
      for (const roll of [0, 0.73, Math.PI / 2]) {
        t.rig.wheels.forEach(wheel => { wheel.spin.angleRad = -roll; });
        applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0, { simulationHeld: true });
        const skin = buildSkinTriangles(t.byName);
        for (const name of ["leftWheel", "rightWheel", "noseWheel"]) {
          const wheel = t.byName.get(name)! as Mesh;
          wheel.isVisible = true;
          wheel.setEnabled(true);
          const vertices = worldVertices(wheel);
          expect(vertices.length).toBeGreaterThan(600);
          const envelope = classifySkinEnvelope(vertices, skin);
          expect(envelope.insufficientIntersections).toBe(0);
          expect(envelope.above + envelope.below).toBe(0);
        }
      }
      // Outer silhouette checks don't prove clearance from internal bays,
      // doors, structure or all triangle interiors. Those remain unqualified.
    } finally { t.dispose(); }
  });

  it("has usable exterior-ray intersections for every actual stowed gear vertex", () => {
    const t = f35bRig();
    try {
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0);
      const skin = buildSkinTriangles(t.byName);
      const gearMeshes = t.nodes.filter(node => /^(left|right|nose)(Gear|Suspension|Wheel|Piston|Strut[TB])$/.test(node.name));
      expect(gearMeshes).toHaveLength(18);
      for (const mesh of gearMeshes) {
        const points = worldVertices(mesh);
        expect(points.length).toBeGreaterThan(0);
        expect(classifySkinEnvelope(points, skin).insufficientIntersections).toBe(0);
      }
    } finally { t.dispose(); }
  });

  it.fails("fully stowed main-leg arms clear the selected skin (known remaining asset clearance defect)", () => {
    const t = f35bRig();
    try {
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0);
      const skin = buildSkinTriangles(t.byName);
      const violations = ["leftGear", "rightGear"].map(name => classifySkinEnvelope(worldVertices(t.byName.get(name)!), skin));
      // The desired geometry condition is zero protrusion. Expected failure
      // keeps the open arm issue visible and requires review if it is fixed.
      expect(violations.some(hasEnvelopeViolation)).toBe(false);
    } finally { t.dispose(); }
  });

  it("measures raw stow geometry independently of render visibility", () => {
    const t = f35bRig();
    try {
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0);
      const before = classifySkinEnvelope(worldVertices(t.byName.get("leftGear")!), buildSkinTriangles(t.byName));
      t.byName.get("leftGear")!.setEnabled(false);
      (t.byName.get("leftGear")! as Mesh).isVisible = false;
      (t.byName.get("leftDoor")! as Mesh).isVisible = false;
      const after = classifySkinEnvelope(worldVertices(t.byName.get("leftGear")!), buildSkinTriangles(t.byName));
      expect(after).toEqual(before);
    } finally { t.dispose(); }
  });

  it("folds retained piston children while keeping wheel roll independent of the gear pose", () => {
    const t = f35bRig();
    try {
      const pistonNames = ["leftPiston", "rightPiston", "nosePiston"];
      const pistonRest = pistonNames.map(name => ({ position: t.byName.get(name)!.position.clone(), rotation: t.byName.get(name)!.rotationQuaternion!.clone() }));
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 0);
      pistonNames.forEach((name, index) => {
        const node = t.byName.get(name)!;
        expect(Vector3.Distance(node.position, pistonRest[index].position)).toBeLessThan(1e-8);
        const localFold = pistonRest[index].rotation.conjugate().multiply(node.rotationQuaternion!);
        const angle = 2 * Math.atan2(Math.abs(localFold.x), Math.abs(localFold.w));
        expect(angle).toBeCloseTo((index < 2 ? 100 : 90) * Math.PI / 180, 6);
      });
      const centers = t.rig.wheels.map(wheel => point(wheel.node));
      t.rig.wheels.forEach(wheel => { wheel.spin.angleRad = -0.73; });
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, gearDownNorm: 0 }, 10, { simulationHeld: true });
      t.rig.wheels.forEach((wheel, index) => {
        expect(Vector3.Distance(point(wheel.node), centers[index])).toBeLessThan(1e-6);
        const roll = wheel.rest.conjugate().multiply(wheel.node.rotationQuaternion!);
        expect(2 * Math.atan2(roll.x, roll.w)).toBeCloseTo(0.73, 6);
      });
      applyAircraftRig(t.rig, NEUTRAL_CONTROL_SURFACES, 0);
      pistonNames.forEach((name, index) => expect(t.byName.get(name)!.rotationQuaternion!.subtract(pistonRest[index].rotation).length()).toBeLessThan(1e-8));
    } finally { t.dispose(); }
  });

  it("opens lift-system doors and points the actual nozzle outlet downward from physical conversion", () => {
    const t = f35bRig();
    try {
      const freeEdges = [
        { name: "topLiftDoor", point: new Vector3(0, 0, -1.9), up: true },
        { name: "leftLiftDoor", point: new Vector3(0.55, 0, 0), up: false },
        { name: "rightLiftDoor", point: new Vector3(-0.55, 0, 0), up: false },
        { name: "leftEngineDoor", point: new Vector3(0.78, 0, 0), up: false },
        { name: "rightEngineDoor", point: new Vector3(-0.78, 0, 0), up: false },
        { name: "leftExhaustDoor", point: new Vector3(0.65, 0, 0), up: true },
        { name: "rightExhaustDoor", point: new Vector3(-0.65, 0, 0), up: true },
      ];
      const closed = freeEdges.map(edge => point(t.byName.get(edge.name)!, edge.point));
      const hinges = t.rig.stovl.map(part => point(part.node, part.pivot?.local ?? part.axis));
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: 1 }, 0);
      freeEdges.forEach((edge, index) => {
        const open = point(t.byName.get(edge.name)!, edge.point);
        if (edge.up) expect(open.y).toBeGreaterThan(closed[index].y);
        else expect(open.y).toBeLessThan(closed[index].y);
      });
      t.rig.stovl.forEach((part, index) => expect(Vector3.Distance(point(part.node, part.pivot?.local ?? part.axis), hinges[index])).toBeLessThan(1e-6));
      const nozzle = t.byName.get("vtol")!;
      const outlet = point(nozzle, new Vector3(0, 0, 1)).subtract(point(nozzle)).normalize();
      expect(outlet.y).toBeLessThan(-0.999);
      expect(Math.abs(outlet.z)).toBeLessThan(1e-6);
      expect(t.byName.get("feather.001")?.parent).toBe(nozzle);
      applyAircraftRig(t.rig, {
        ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: 1,
        nozzlePitchRad: Math.PI / 2, nozzleYawRad: 0.1,
      }, 0);
      const yawedOutlet = point(nozzle, new Vector3(0, 0, 1)).subtract(point(nozzle)).normalize();
      expect(yawedOutlet.x).toBeCloseTo(-Math.sin(0.1), 6);
      expect(yawedOutlet.y).toBeCloseTo(-Math.cos(0.1), 6);
      expect(Math.abs(yawedOutlet.z)).toBeLessThan(1e-6);
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: 0.4 }, 0);
      const half = nozzle.rotationQuaternion!.clone();
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: 0.4 }, 10, { simulationHeld: true });
      expect(nozzle.rotationQuaternion!.subtract(half).length()).toBeLessThan(1e-8);
    } finally { t.dispose(); }
  });

  it("reads F-35B physical flap and conversion positions without substituting commands", () => {
    const values: Record<string, number> = {
      "fcs/left-aileron-pos-rad": 0.1, "fcs/tef-pos-rad": 0.2,
      "fcs/stovl-cmd-norm": 1, "fcs/stovl-pos-norm": 0.35,
      "fcs/nozzle-pitch-rad": 0.5, "fcs/nozzle-yaw-rad": -0.1,
      "gear/gear-cmd-norm": 1, "gear/gear-pos-norm": 0.6,
    };
    const sdk = { getPropertyValue: (name: string) => values[name] ?? NaN } as unknown as JSBSimSdk;
    expect(readControlSurfaceState(sdk, "f-35b")).toMatchObject({
      aileronLeftRad: 0.1, aileronRightRad: -0.1, flapRad: 0.2,
      stovlPositionNorm: 0.35, gearDownNorm: 0.6,
      nozzlePitchRad: 0.5, nozzleYawRad: -0.1,
    });
  });

  it("clears the engine bay doors early while the reconstructed nozzle follows independent native angles", () => {
    const t = f35bRig();
    try {
      const doors = ["leftEngineDoor", "rightEngineDoor"].map(name => t.byName.get(name)!);
      const closedPositions = doors.map(node => node.position.clone());
      const closedWorld = doors.map(node => point(node));
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: 1 }, 0);
      const full = doors.map(node => node.rotationQuaternion!.clone());
      const openPositions = doors.map(node => node.position.clone());
      // The offset is an actual fixed hinge: its original origin swings
      // outboard by 6 cm; a translated aircraft carries the same local fit.
      expect(point(doors[0]).x - closedWorld[0].x).toBeCloseTo(-.06, 6);
      expect(point(doors[1]).x - closedWorld[1].x).toBeCloseTo(.06, 6);
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: .25, nozzlePitchRad: .2, nozzleYawRad: 0 }, 0);
      doors.forEach((node, i) => {
        expect(node.rotationQuaternion!.subtract(full[i]).length()).toBeLessThan(1e-12);
        expect(Vector3.Distance(node.position, openPositions[i])).toBeLessThan(1e-12);
      });
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: 0 }, 0);
      doors.forEach((node, i) => {
        expect(Math.abs(Quaternion.Dot(node.rotationQuaternion!, full[i]))).toBeLessThan(.8);
        expect(Vector3.Distance(node.position, closedPositions[i])).toBeLessThan(1e-12);
      });
    } finally { t.dispose(); }
  });

  it.each([0, 0.4, 1])("opens and closes all sixteen actual petal tips under vectoring position %s without moving their hinges", conversion => {
    const t = f35bRig();
    try {
      const nozzle = t.byName.get("vtol")!;
      const petals = t.rig.nozzleArea;
      const center = petals.reduce((sum, petal) => sum.add(petal.node.position), Vector3.Zero()).scale(1 / petals.length);
      const tips = petals.map(petal => nozzleTip(petal.node));
      const hinges = petals.map(petal => nozzlePoint(nozzle, petal.node, petal.axis));
      const rest = petals.map(petal => ({ position: petal.node.position.clone(), scaling: petal.node.scaling.clone() }));
      const radius = (index: number) => {
        const tip = nozzlePoint(nozzle, petals[index].node, tips[index]);
        return Math.hypot(tip.x - center.x, tip.y - center.y);
      };
      const state = { ...NEUTRAL_CONTROL_SURFACES, stovlPositionNorm: conversion,
        nozzlePitchRad: conversion * Math.PI / 2, nozzleYawRad: conversion * 0.12 };
      applyAircraftRig(t.rig, { ...state, nozzlePositionNorm: 0 }, 0);
      const closed = petals.map((_, index) => radius(index));
      const parentRotation = nozzle.rotationQuaternion!.clone();
      let previous = closed;
      for (const nozzlePositionNorm of [0.25, 0.5, 0.75, 1]) {
        applyAircraftRig(t.rig, { ...state, nozzlePositionNorm }, 0);
        const current = petals.map((petal, index) => {
          expect(radius(index)).toBeGreaterThan(previous[index] + 0.02);
          expect(Vector3.Distance(nozzlePoint(nozzle, petal.node, petal.axis), hinges[index])).toBeLessThan(1e-6);
          expect(Vector3.Distance(petal.node.position, rest[index].position)).toBeLessThan(1e-8);
          expect(Vector3.Distance(petal.node.scaling, rest[index].scaling)).toBeLessThan(1e-8);
          expect(petal.node.parent).toBe(nozzle);
          return radius(index);
        });
        expect(nozzle.rotationQuaternion!.subtract(parentRotation).length()).toBeLessThan(1e-8);
        previous = current;
      }
      // Geometric display limits: the tapered inner tip moves from roughly
      // 0.4834 to the retained hinge radius 0.6984 source units, not a whole
      // nozzle scale or a claimed calibrated F135 exit area.
      closed.forEach(value => expect(value).toBeCloseTo(0.4834, 4));
      previous.forEach(value => expect(value).toBeCloseTo(0.698354, 5));
      applyAircraftRig(t.rig, { ...state, nozzlePositionNorm: 0.5 }, 0);
      const partial = petals.map((_, index) => radius(index));
      applyAircraftRig(t.rig, { ...state, nozzlePositionNorm: 0.5 }, 10, { simulationHeld: true });
      petals.forEach((_, index) => expect(radius(index)).toBeCloseTo(partial[index], 8));
      applyAircraftRig(t.rig, { ...state, nozzlePositionNorm: 0 }, 0);
      petals.forEach((petal, index) => {
        expect(radius(index)).toBeCloseTo(closed[index], 8);
        expect(petal.node.rotationQuaternion!.subtract(petal.rest).length()).toBeLessThan(1e-8);
      });
    } finally { t.dispose(); }
  });

  it("clamps aperture geometry and preserves the last observed pose when position is unavailable", () => {
    const t = f35bRig();
    try {
      const rotations = () => t.rig.nozzleArea.map(petal => petal.node.rotationQuaternion!.clone());
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, nozzlePositionNorm: 1 }, 0);
      const open = rotations();
      for (const nozzlePositionNorm of [2, Number.NaN, undefined]) {
        applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, nozzlePositionNorm }, 0);
        rotations().forEach((rotation, index) => expect(rotation.subtract(open[index]).length()).toBeLessThan(1e-8));
      }
      applyAircraftRig(t.rig, { ...NEUTRAL_CONTROL_SURFACES, nozzlePositionNorm: -1 }, 0);
      t.rig.nozzleArea.forEach(petal => expect(petal.node.rotationQuaternion!.subtract(petal.rest).length()).toBeLessThan(1e-8));
    } finally { t.dispose(); }
  });

  it("uses the model owner's finite nozzle observation without reading a missing property or substituting throttle", () => {
    const nozzlePath = "propulsion/engine[0]/nozzle-pos-norm";
    const read = vi.fn(() => 1);
    const sdk = { getPropertyValue: read } as unknown as JSBSimSdk;
    expect(readControlSurfaceState(sdk, "f-35b").nozzlePositionNorm).toBeUndefined();
    expect(read).not.toHaveBeenCalledWith(nozzlePath);
    expect(readControlSurfaceState(sdk, "f-35b", { nozzlePositionNorm: 0 }).nozzlePositionNorm).toBe(0);
    expect(readControlSurfaceState(sdk, "f-35b", { nozzlePositionNorm: 0.35 }).nozzlePositionNorm).toBe(0.35);
    expect(readControlSurfaceState(sdk, "f-35b", { nozzlePositionNorm: Number.NaN }).nozzlePositionNorm).toBeUndefined();
    expect(readControlSurfaceState(sdk, undefined, { nozzlePositionNorm: 0.35 }).nozzlePositionNorm).toBe(0.35);
    expect(read).not.toHaveBeenCalledWith(nozzlePath);
  });

  it("accepts another asset's aperture hinge data without an F-35-specific animation branch", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const node = new TransformNode("custom-nozzle-petal", scene);
      node.position = new Vector3(1, 2, 3);
      node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), 0.2);
      const rest = node.rotationQuaternion.clone();
      const rig = bindAircraftRig([node], { nozzleAreaBindings: [{ name: node.name, axis: Vector3.Right(),
        closedAngleRad: 0, openAngleRad: -0.3 }] });
      expect(rig.nozzleArea).toHaveLength(1);
      const hinge = point(node, Vector3.Right());
      const tip = point(node, Vector3.Forward());
      applyAircraftRig(rig, { ...NEUTRAL_CONTROL_SURFACES, nozzlePositionNorm: 0.5 }, 0);
      expect(Vector3.Distance(point(node, Vector3.Right()), hinge)).toBeLessThan(1e-6);
      expect(point(node, Vector3.Forward()).y).toBeGreaterThan(tip.y);
      applyAircraftRig(rig, { ...NEUTRAL_CONTROL_SURFACES, nozzlePositionNorm: 0 }, 0);
      expect(node.rotationQuaternion!.subtract(rest).length()).toBeLessThan(1e-8);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
