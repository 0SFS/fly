import { describe, expect, it } from "vitest";
import { symmetricTriangles } from "./rotorSymmetry.mjs";

/** A closed cup about +Y: a wall of `segments` quads and a flat top, as points and triangles. */
function cup(radius, height, segments) {
  const points = [[0, height, 0]], indices = [];
  for (let s = 0; s < segments; s++) {
    const angle = 2 * Math.PI * s / segments;
    points.push([radius * Math.cos(angle), 0, radius * Math.sin(angle)], [radius * Math.cos(angle), height, radius * Math.sin(angle)]);
  }
  for (let s = 0; s < segments; s++) {
    const bottom = 1 + 2 * s, top = bottom + 1, nextBottom = 1 + 2 * ((s + 1) % segments), nextTop = nextBottom + 1;
    indices.push(bottom, nextBottom, nextTop, bottom, nextTop, top, 0, top, nextTop);
  }
  return { points, indices };
}

/** A box from `min` to `max`, as twelve triangles appended to `shape`. */
function addBox(shape, min, max) {
  const base = shape.points.length;
  for (let corner = 0; corner < 8; corner++) shape.points.push([0, 1, 2].map(axis => corner & (1 << axis) ? max[axis] : min[axis]));
  for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
    shape.indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  }
  return shape;
}

describe("rotor symmetry", () => {
  it("keeps a turned bell's wall and top still and moves a screw and a spoke on top of it", () => {
    const shape = cup(1, .8, 48);
    const bell = shape.indices.length / 3;
    addBox(shape, [.5, .86, -.05], [.6, .96, .05]);
    addBox(shape, [-.7, .8, -.1], [.7, .85, .1]);
    const symmetric = symmetricTriangles(shape.points, shape.indices, { cell: 1 / 40 });
    expect(symmetric.slice(0, bell).every(Boolean)).toBe(true);
    // The screw moves. So does the spoke, but for its underside, which lies in the top's full turn.
    expect(symmetric.slice(bell, bell + 12).some(Boolean)).toBe(false);
    expect(symmetric.slice(bell + 12).filter(value => !value).length).toBeGreaterThan(6);
  });

  it("keeps a coarsely faceted bell still when its axis is half a cell off", () => {
    const shape = cup(1, .8, 24);
    const shifted = shape.points.map(([x, y, z]) => [x + .012, y, z - .004]);
    expect(symmetricTriangles(shifted, shape.indices, { cell: 1 / 40 }).every(Boolean)).toBe(true);
  });

  it("sees a ring split into two halves as one full turn, and a ring with a gap as moving", () => {
    const half = (from, to) => {
      const points = [], indices = [];
      for (let s = 0; s <= 24; s++) {
        const angle = from + (to - from) * s / 24;
        points.push([Math.cos(angle), 0, Math.sin(angle)], [Math.cos(angle), .2, Math.sin(angle)]);
        if (s) indices.push(2 * s - 2, 2 * s, 2 * s + 1, 2 * s - 2, 2 * s + 1, 2 * s - 1);
      }
      return { points, indices };
    };
    const join = (...shapes) => shapes.reduce((all, shape) => ({
      points: [...all.points, ...shape.points], indices: [...all.indices, ...shape.indices.map(i => i + all.points.length)] }), { points: [], indices: [] });
    const whole = join(half(0, Math.PI), half(Math.PI, 2 * Math.PI));
    expect(symmetricTriangles(whole.points, whole.indices, { cell: 1 / 40 }).every(Boolean)).toBe(true);
    const gap = join(half(0, Math.PI), half(Math.PI + .6, 2 * Math.PI));
    expect(symmetricTriangles(gap.points, gap.indices, { cell: 1 / 40 }).some(Boolean)).toBe(false);
  });
});
