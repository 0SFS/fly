import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  bodyOffsetLocal, bodyToLocalRotation, C172_GROUND_CONTACTS, groundContactBodyPosition, metresPerDegree,
} from "@0sfs/ground-contact/collisionGeometry";
import { groundContactClearanceMeters } from "@0sfs/ground-contact/groundContactClearance";

describe("shared aircraft collision geometry", () => {
  it("matches every ground contact in the aircraft XML actually loaded by JSBSim", () => {
    const xml = readFileSync("public/jsbsim-data/aircraft/c172p/c172p.xml", "utf8");
    const contacts = [...xml.matchAll(/<contact\b([^>]*)>([\s\S]*?)<\/contact>/g)].map(([, attributes, body]) => {
      const location = body.match(/<location\s+unit="IN">([\s\S]*?)<\/location>/)?.[1];
      expect(location).toBeDefined();
      const coordinate = (axis: string) => Number(location!.match(new RegExp(`<${axis}>([^<]+)</${axis}>`))?.[1]);
      return {
        name: attributes.match(/name="([^"]+)"/)?.[1],
        kind: attributes.match(/type="([^"]+)"/)?.[1] === "BOGEY" ? "wheel" : "structure",
        xIn: coordinate("x"), yIn: coordinate("y"), zIn: coordinate("z"),
      };
    });
    expect(C172_GROUND_CONTACTS).toEqual(contacts);
  });

  it("places a contact ahead, left and below the CG in probe/renderer axes", () => {
    const position = groundContactBodyPosition({ xIn: 60, yIn: -6, zIn: -10 }, { xIn: 100, yIn: 4, zIn: 20 });
    expect(position.left).toBeCloseTo(0.254);
    expect(position.up).toBeCloseTo(-0.762);
    expect(position.forward).toBeCloseTo(1.016);
  });

  it("uses the current payload/fuel CG rather than anchoring contacts to the empty-aircraft CG", () => {
    const contact = C172_GROUND_CONTACTS[1];
    const initial = groundContactBodyPosition(contact, { xIn: 40, yIn: 0, zIn: 20 });
    const changed = groundContactBodyPosition(contact, { xIn: 44, yIn: 2, zIn: 17 });
    expect(changed.forward - initial.forward).toBeCloseTo(0.1016);
    expect(changed.left - initial.left).toBeCloseTo(0.0508);
    expect(changed.up - initial.up).toBeCloseTo(0.0762);
  });

  it.each([{ roll: 0, pitch: 0 }, { roll: Math.PI / 2, pitch: 0 }, { roll: 0, pitch: Math.PI / 2 }])(
    "uses the same contact positions for ground clearance at roll=$roll, pitch=$pitch", ({ roll, pitch }) => {
      const cg = { xIn: 44, yIn: 2, zIn: 17 };
      const values: Record<string, number> = { "inertia/cg-x-in": cg.xIn, "inertia/cg-y-in": cg.yIn, "inertia/cg-z-in": cg.zIn };
      values["gear/num-units"] = C172_GROUND_CONTACTS.length;
      values["gear/gear-pos-norm"] = 1;
      C172_GROUND_CONTACTS.forEach((contact, index) => {
        const prefix = (contact.kind === "wheel" ? "gear" : "contact") + "/unit[" + index + "]/";
        for (const axis of ["x", "y", "z"] as const) {
          values[prefix + axis + "-position"] = contact[(axis + "In") as "xIn" | "yIn" | "zIn"];
        }
      });
      const sdk = {
        getPropertyValue: vi.fn((name: string) => values[name]),
        queryPropertyCatalog: () => Object.keys(values).filter(name => name.endsWith("-position")).map(name => name + " (RW)").join("\n"),
      };
      const points = C172_GROUND_CONTACTS.map(contact => groundContactBodyPosition(contact, cg));
      // At level, knife-edge right bank, and vertical nose-up attitudes,
      // the downward extent is respectively -up, -left, and -forward.
      const extent = roll !== 0 ? Math.max(...points.map(point => -point.left))
        : pitch !== 0 ? Math.max(...points.map(point => -point.forward))
          : Math.max(...points.map(point => -point.up));
      expect(groundContactClearanceMeters(sdk as never, roll, pitch)).toBeCloseTo(extent, 12);
    },
  );

  it("rotates body axes into north, east and down like JSBSim's Euler angles", () => {
    const toLocal = (roll: number, pitch: number, heading: number, offset: { left: number; up: number; forward: number }) =>
      bodyOffsetLocal(offset, bodyToLocalRotation(roll, pitch, heading));
    const ahead = { left: 0, up: 0, forward: 1 }, right = { left: -1, up: 0, forward: 0 };
    // Heading east, the nose points east.
    const east = toLocal(0, 0, Math.PI / 2, ahead);
    expect(east.north).toBeCloseTo(0, 12);
    expect(east.east).toBeCloseTo(1, 12);
    expect(east.down).toBeCloseTo(0, 12);
    // Nose up: the nose rises.
    expect(toLocal(0, Math.PI / 6, 0, ahead).down).toBeCloseTo(-0.5, 12);
    // Right wing down.
    expect(toLocal(Math.PI / 6, 0, 0, right).down).toBeCloseTo(0.5, 12);
    // A rotation: orthonormal with a positive determinant, at any attitude.
    const m = bodyToLocalRotation(0.3, -0.7, 2.1);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        const dot = m[row * 3] * m[column * 3] + m[row * 3 + 1] * m[column * 3 + 1] + m[row * 3 + 2] * m[column * 3 + 2];
        expect(dot).toBeCloseTo(row === column ? 1 : 0, 12);
      }
    }
    const determinant = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(determinant).toBeCloseTo(1, 12);
  });

  it.each([{ roll: 0, pitch: 0.04, heading: 0 }, { roll: 0.3, pitch: -0.2, heading: 2.5 }, { roll: -1.2, pitch: 0.6, heading: -1 }])(
    "puts the lowest contact footprint as deep as the ground clearance at roll=$roll, pitch=$pitch, heading=$heading", ({ roll, pitch, heading }) => {
      const cg = { xIn: 41, yIn: 0.5, zIn: 36.5 };
      const values: Record<string, number> = { "inertia/cg-x-in": cg.xIn, "inertia/cg-y-in": cg.yIn, "inertia/cg-z-in": cg.zIn,
        "gear/num-units": C172_GROUND_CONTACTS.length, "gear/gear-pos-norm": 1 };
      C172_GROUND_CONTACTS.forEach((contact, index) => {
        const prefix = (contact.kind === "wheel" ? "gear" : "contact") + "/unit[" + index + "]/";
        values[prefix + "x-position"] = contact.xIn; values[prefix + "y-position"] = contact.yIn; values[prefix + "z-position"] = contact.zIn;
      });
      const sdk = {
        getPropertyValue: (name: string) => values[name],
        queryPropertyCatalog: () => Object.keys(values).filter(name => name.endsWith("-position")).map(name => name + " (RW)").join("\n"),
      };
      const rotation = bodyToLocalRotation(roll, pitch, heading);
      const deepest = Math.max(...C172_GROUND_CONTACTS.map(contact => bodyOffsetLocal(groundContactBodyPosition(contact, cg), rotation).down));
      expect(deepest).toBeCloseTo(groundContactClearanceMeters(sdk as never, roll, pitch), 12);
    },
  );

  it("measures metres per degree on the WGS84 ellipsoid", () => {
    // Published WGS84 lengths of a degree.
    expect(metresPerDegree(0).lat).toBeCloseTo(110574.3, 0);
    expect(metresPerDegree(0).lon).toBeCloseTo(111319.5, 0);
    expect(metresPerDegree(45).lat).toBeCloseTo(111132.0, 0);
    expect(metresPerDegree(45).lon).toBeCloseTo(78846.8, 0);
    expect(metresPerDegree(-45).lon).toBeCloseTo(78846.8, 0);
  });
});
