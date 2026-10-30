// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NullEngine, Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { AIR_2S, AIR_2S_MASS, MINI_2, MINI_2_MASS } from "../../../../multirotor/tests/airframes";
import { mountDroneProceduralMesh } from "./buildDroneProceduralMesh";
import { resolveQuadPropeller } from "./quadRegistry";
import { droneMotorPosition } from "./droneMotorTelemetry";

const root = resolve(process.cwd(), "..") + "/";
const shared = JSON.parse(readFileSync(root + "Quadcopter/public/0sfs-mod.json", "utf8")).quadcopter;
const cases = [
  { directory: "DJI-Mini2", spec: MINI_2, mass: MINI_2_MASS, cdA: [0.005, 0.006, 0.013] },
  { directory: "DJI-Air-2S", spec: AIR_2S, mass: AIR_2S_MASS, cdA: [0.0085, 0.010, 0.022] },
];

function element(parent: ParentNode, selector: string): Element {
  const result = parent.querySelector(selector);
  expect(result, selector).not.toBeNull();
  return result!;
}
function scalar(parent: ParentNode, selector: string): number {
  const value = Number(element(parent, selector).textContent);
  expect(Number.isFinite(value), selector).toBe(true);
  return value;
}
function location(parent: ParentNode, selector = "location"): number[] {
  const node = element(parent, selector);
  expect(node.getAttribute("unit")).toBe("M");
  return ["x", "y", "z"].map(axis => scalar(node, axis));
}

describe.each(cases)("$directory quad airframe data", ({ directory, spec, mass, cdA }) => {
  const manifest = JSON.parse(readFileSync(root + directory + "/public/0sfs-mod.json", "utf8"));
  const quad = { ...manifest.quad, propeller: resolveQuadPropeller(manifest.quad) };
  const definition = manifest.aircraft.definitions[0];
  const profile = manifest.aircraft.fdmProfiles[definition.id];
  const text = readFileSync(root + directory + "/public/jsbsim-data/aircraft/" + profile.model + "/" + profile.model + ".xml", "utf8");
  const xml = new DOMParser().parseFromString(text, "application/xml");

  it("parses and places the CG, aerodynamic reference and applied forces at the manifest CG", () => {
    expect(xml.querySelector("parsererror")).toBeNull();
    const cg = location(xml, 'mass_balance > location[name="CG"]');
    expect(cg).toEqual(quad.cgM);
    expect(location(xml, 'metrics > location[name="AERORP"]')).toEqual(cg);
    const forces = [...xml.querySelectorAll("external_reactions > force")];
    expect(forces).toHaveLength(3);
    for (const force of forces) expect(location(force)).toEqual(cg);
  });

  it("uses the shared body wrench properties and initializes all six", () => {
    const reactions = [...xml.querySelectorAll("external_reactions > force, external_reactions > moment")];
    const expected = ["fx", "fy", "fz", "l", "m", "n"].map(key => shared.properties[key]);
    expect(reactions.map(reaction => element(reaction, "function > property").textContent?.trim())).toEqual(expected);
    expect(reactions).toHaveLength(6);
    for (const [index, reaction] of reactions.entries()) {
      expect(reaction.getAttribute("frame")).toBe("BODY");
      expect(["x", "y", "z"].map(axis => scalar(reaction, "direction > " + axis)))
        .toEqual([0, 1, 2].map(axis => axis === index % 3 ? 1 : 0));
    }
    for (const property of expected) expect(profile.initialProperties).toHaveProperty(property, 0);
    expect(text).not.toMatch(/fcs\/drone-[fm]/);
  });

  it("has four named structure feet below every rotor hub", () => {
    const feet = [...xml.querySelectorAll("ground_reactions > contact")];
    expect(feet.map(foot => foot.getAttribute("name"))).toEqual(["FL_FOOT", "FR_FOOT", "RL_FOOT", "RR_FOOT"]);
    for (const [index, foot] of feet.entries()) {
      expect(foot.getAttribute("type")).toBe("STRUCTURE");
      const point = location(foot);
      expect(Math.sign(point[1])).toBe(index % 2 === 0 ? -1 : 1);
      for (const rotor of quad.rotors) expect(point[2]).toBeLessThan(rotor.hubM[2]);
      expect(scalar(foot, "static_friction")).toBe(0.8);
      expect(scalar(foot, "dynamic_friction")).toBe(0.6);
      expect(scalar(foot, "spring_coeff")).toBeGreaterThan(0);
      expect(scalar(foot, "damping_coeff")).toBeGreaterThan(0);
    }
  });

  it("loads physical propeller data from a separate electric engine mod", () => {
    const propulsion = JSON.parse(readFileSync(root + directory + "-propulsion/public/0sfs-mod.json", "utf8"));
    expect(manifest.dependencies).toContain("0SFS/" + directory + "-propulsion");
    expect(manifest.quad.propeller).toBeUndefined();
    expect(manifest.quad.propulsionId).toBe(propulsion.engine.id);
    expect(quad.propeller).toEqual(propulsion.engine.electric.propeller);
    expect(propulsion.dependencies).toContain("0SFS/electric-sound");
    expect(manifest.aircraft.audio).toEqual({ engineDefinitionId: propulsion.engine.acousticProfile.id, sourceKind: "rotor" });
  });
  it("keeps propellers, rotor layout, CG and controller equal to the multirotor reference specs", () => {
    for (const field of ["propeller", "rotors", "cgM", "control"] as const) expect(quad[field]).toEqual(spec[field]);
    for (const entry of manifest.aircraft.definitions) {
      expect(entry.rotors).toHaveLength(quad.rotors.length);
      for (const rotor of entry.rotors) expect(rotor.radiusMeters).toBe(quad.propeller.radiusM);
    }
  });

  it("maps every visual rotor direction to the physical clockwise spin", () => {
    const turn = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI / 2), turned = Vector3.Zero();
    new Vector3(0, 0, 1).rotateByQuaternionToRef(turn, turned);
    // In the declared visual frame, a positive +Y quaternion turn takes
    // forward (+Z) toward left (+X): counter-clockwise seen from above.
    expect(turned.x).toBeCloseTo(1, 12); expect(turned.z).toBeCloseTo(0, 12);
    const engine = new NullEngine(), scene = new Scene(engine), model = new TransformNode("quad-data", scene);
    scene.useRightHandedSystem = true;
    const unmount = mountDroneProceduralMesh(model, { rotors: quad.rotors, cgM: quad.cgM, propellerRadiusM: quad.propeller.radiusM });
    try {
      for (const entry of manifest.aircraft.definitions) for (const rotor of entry.rotors) {
        const pivot = scene.getTransformNodeByName(rotor.node)!;
        expect(pivot, rotor.node).not.toBeNull();
        const position = droneMotorPosition(pivot.position.x, pivot.position.z);
        const physical = quad.rotors.find((candidate: { position: string }) => candidate.position === position)!;
        expect(physical, position).toBeDefined();
        expect(rotor.axis).toEqual([0, 1, 0]);
        // The visual axis points up, and physics spin is about body +Z, down.
        expect.soft(rotor.direction, `${entry.id} ${rotor.node} (${position})`).toBe(-physical.spin);
      }
    } finally { unmount(); scene.dispose(); engine.dispose(); }
  });

  it("matches the reference mass and principal inertia within one part in a thousand", () => {
    expect(element(xml, "emptywt").getAttribute("unit")).toBe("LBS");
    expect(Math.abs(scalar(xml, "emptywt") * 0.45359237 / mass.massKg - 1)).toBeLessThan(0.001);
    for (const axis of ["ixx", "iyy", "izz"] as const) {
      expect(element(xml, axis).getAttribute("unit")).toBe("SLUG*FT2");
      expect(Math.abs(scalar(xml, axis) * 1.3558179483314003 / mass[axis] - 1)).toBeLessThan(0.001);
    }
  });

  it("uses signed body-axis drag with the specified drag areas and zero aerodynamic moments", () => {
    const axes = [...xml.querySelectorAll("aerodynamics > axis")];
    expect(axes.map(axis => axis.getAttribute("name"))).toEqual(["X", "Y", "Z", "ROLL", "PITCH", "YAW"]);
    for (const [index, axis] of axes.slice(0, 3).entries()) {
      expect([...axis.querySelectorAll("property")].map(property => property.textContent)).toEqual([
        "atmosphere/rho-slugs_ft3", "velocities/vt-fps", `velocities/${["u", "v", "w"][index]}-aero-fps`,
      ]);
      expect(scalar(axis, "value")).toBeCloseTo(-0.5 * cdA[index] * 10.7639, 12);
    }
    for (const axis of axes.slice(3)) expect(scalar(axis, "value")).toBe(0);
  });
});
