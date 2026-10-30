/**
 * Which triangles of a turning part look the same at every angle about its
 * axis. A turning surface of revolution, such as a motor bell's wall or its
 * shaft, looks still; spokes, screws and clamps visibly move, and at
 * propeller speeds they flicker.
 *
 * `points` are [x, y, z] in the rotor's frame, with the axis +Y through the
 * origin; `indices` are triangles. Each triangle's surface is sampled into
 * cells of radius and height `cell` wide. A cell is a full turn when the
 * surface in it and its neighbouring cells reaches at least `turn` of its
 * `sectors` angle sectors; the neighbours take in a round surface that
 * crosses a cell boundary, through its facets or a slightly measured axis.
 * Cells within two of the axis count as full turns, too small to show a turn.
 * A triangle is symmetric when all its samples lie in full turns.
 */
export function symmetricTriangles(points, indices, { cell, sectors = 72, turn = .95 }) {
  if (!(cell > 0)) throw new Error("symmetricTriangles needs a positive cell size");
  const reached = new Map();
  const cellKey = (r, y) => Math.floor(r / cell) + "," + Math.floor(y / cell);
  forEachSample(points, indices, cell, sectors, (_, r, y, angle) => {
    const key = cellKey(r, y);
    let hit = reached.get(key);
    if (!hit) reached.set(key, hit = new Uint8Array(sectors));
    hit[Math.min(sectors - 1, Math.floor((angle + Math.PI) / (2 * Math.PI) * sectors))] = 1;
  });
  const full = new Set();
  for (const key of reached.keys()) {
    const [r, y] = key.split(",").map(Number), around = new Uint8Array(sectors);
    for (let dr = -1; dr <= 1; dr++) for (let dy = -1; dy <= 1; dy++) {
      const hit = reached.get((r + dr) + "," + (y + dy));
      if (hit) for (let sector = 0; sector < sectors; sector++) around[sector] |= hit[sector];
    }
    if (r < 2 || around.reduce((sum, value) => sum + value, 0) >= turn * sectors) full.add(key);
  }
  const symmetric = new Array(indices.length / 3).fill(true);
  forEachSample(points, indices, cell, sectors, (triangle, r, y) => {
    if (!full.has(cellKey(r, y))) symmetric[triangle] = false;
  });
  return symmetric;
}

/** Samples every triangle finely enough to reach each cell and each angle sector it crosses. */
function forEachSample(points, indices, cell, sectors, visit) {
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = points[indices[t]], b = points[indices[t + 1]], c = points[indices[t + 2]];
    const edge = Math.max(distance(a, b), distance(b, c), distance(c, a));
    const nearest = Math.max(cell, Math.min(Math.hypot(a[0], a[2]), Math.hypot(b[0], b[2]), Math.hypot(c[0], c[2])));
    const spacing = Math.min(cell / 2, nearest * Math.PI / sectors);
    const n = Math.min(96, Math.max(1, Math.ceil(edge / spacing)));
    for (let u = 0; u <= n; u++) for (let v = 0; u + v <= n; v++) {
      const wb = u / n, wc = v / n, wa = 1 - wb - wc;
      const x = a[0] * wa + b[0] * wb + c[0] * wc, y = a[1] * wa + b[1] * wb + c[1] * wc, z = a[2] * wa + b[2] * wb + c[2] * wc;
      visit(t / 3, Math.hypot(x, z), y, Math.atan2(z, x));
    }
  }
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
