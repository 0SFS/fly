import { describe, expect, it } from "vitest";
import {
  ATTITUDE_TICK_HALF_LENGTH,
  angleForRadius,
  attitudeArtScale,
  bodyToLocal,
  colourAtElevation,
  computeAttitudeScene,
  createAttitudeProjection,
  radiusForAngle,
  type AttitudeMarkerKind,
  type AttitudeProjection,
  type AttitudeScene,
  type AttitudeState,
  type AttitudeView,
} from "./attitudeIndicator";

const DEG = Math.PI / 180;
const projection = createAttitudeProjection(220, 96);
const CENTRE = 110;

function state(overrides: Partial<AttitudeState> = {}): AttitudeState {
  return {
    rollRad: 0, pitchRad: 0, headingRad: 0,
    northVelocityFps: 200, eastVelocityFps: 0, verticalSpeedFps: 0,
    ...overrides,
  };
}

function marker(kind: AttitudeMarkerKind, overrides: Partial<AttitudeState> = {}) {
  return computeAttitudeScene(state(overrides), projection).markers.find(item => item.kind === kind);
}

describe("attitude projection", () => {
  it("puts 90° from the nose at the edges and most of the way behind at the corners", () => {
    expect(radiusForAngle(projection, 90 * DEG)).toBeCloseTo(96, 6);
    expect(radiusForAngle(projection, 165 * DEG)).toBeCloseTo(96 * Math.SQRT2, 6);
  });

  it("spends more of the square near the nose than near the edges", () => {
    const inner = radiusForAngle(projection, 10 * DEG);
    const outer = radiusForAngle(projection, 90 * DEG) - radiusForAngle(projection, 80 * DEG);
    expect(inner).toBeGreaterThan(1.5 * outer);
  });

  it("inverts exactly, so each pixel's colour matches where the lines are drawn", () => {
    for (const deg of [0, 5, 45, 90, 140, 165]) {
      expect(angleForRadius(projection, radiusForAngle(projection, deg * DEG))).toBeCloseTo(deg * DEG, 9);
    }
  });
});

describe("attitude scene", () => {
  it("has local up straight up the body when level", () => {
    const [x, y, z] = computeAttitudeScene(state(), projection).up;
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(-1, 9);
  });

  it("lowers the horizon by the pitch angle through the projection", () => {
    const scene = computeAttitudeScene(state({ pitchRad: 10 * DEG }), projection);
    const below = scene.horizon.flatMap(line => {
      const points: number[] = [];
      for (let index = 0; index < line.length; index += 2) {
        if (Math.abs(line[index] - CENTRE) < 1) points.push(line[index + 1]);
      }
      return points;
    });
    expect(below.length).toBeGreaterThan(0);
    expect(Math.min(...below.map(y => Math.abs(y - CENTRE - radiusForAngle(projection, 10 * DEG))))).toBeLessThan(0.5);
  });

  it("raises the horizon on the right in a right bank", () => {
    const scene = computeAttitudeScene(state({ rollRad: 30 * DEG }), projection);
    const line = scene.horizon.flat();
    const right: number[] = [];
    const left: number[] = [];
    for (let index = 0; index < line.length; index += 2) {
      const dx = line[index] - CENTRE;
      if (Math.abs(dx) > 20 && Math.abs(dx) < 40) (dx > 0 ? right : left).push(line[index + 1]);
    }
    expect(Math.max(...right)).toBeLessThan(CENTRE);
    expect(Math.min(...left)).toBeGreaterThan(CENTRE);
  });

  it("puts prograde on the nose when flying where it points, and hides retrograde behind", () => {
    const prograde = marker("prograde");
    expect(prograde?.x).toBeCloseTo(CENTRE, 6);
    expect(prograde?.y).toBeCloseTo(CENTRE, 6);
    expect(prograde?.pinned).toBe(false);
    expect(marker("retrograde")).toBeUndefined();
  });

  it("puts prograde below the nose by the angle of attack", () => {
    const prograde = marker("prograde", { pitchRad: 8 * DEG });
    expect(prograde?.x).toBeCloseTo(CENTRE, 6);
    expect(prograde!.y - CENTRE).toBeCloseTo(radiusForAngle(projection, 8 * DEG), 6);
  });

  it("puts prograde downwind of the nose when crabbing", () => {
    // Nose 12° left of the track: the aircraft goes to the right of where it points.
    const prograde = marker("prograde", { headingRad: -12 * DEG });
    expect(prograde!.x - CENTRE).toBeCloseTo(radiusForAngle(projection, 12 * DEG), 6);
    expect(prograde?.y).toBeCloseTo(CENTRE, 6);
  });

  it("puts normal left of the track and radial out above it, as in KSP", () => {
    const normal = marker("normal");
    const antiNormal = marker("anti-normal");
    const radialOut = marker("radial-out");
    const radialIn = marker("radial-in");
    expect(normal!.x).toBeLessThan(CENTRE - 80);
    expect(antiNormal!.x).toBeGreaterThan(CENTRE + 80);
    expect(radialOut!.y).toBeLessThan(CENTRE - 80);
    expect(radialIn!.y).toBeGreaterThan(CENTRE + 80);
    // Exactly 90° out lands on the edge; that is not "beyond" it.
    expect([normal, antiNormal, radialOut, radialIn].map(item => item?.pinned)).toEqual([false, false, false, false]);
  });

  it("pins prograde to the edge, dimmed, when the path is off the square", () => {
    // Falling almost straight down with the nose level: the path is ~80° below.
    const prograde = marker("prograde", {
      pitchRad: 0, northVelocityFps: 20, verticalSpeedFps: -200, rollRad: 0,
    });
    expect(prograde).toBeDefined();
    expect(Math.abs(prograde!.x - CENTRE)).toBeLessThan(96);
    expect(prograde!.y - CENTRE).toBeLessThanOrEqual(96);
    const falling = marker("prograde", { pitchRad: 60 * DEG, northVelocityFps: 5, verticalSpeedFps: -200 });
    expect(falling?.pinned).toBe(true);
    expect(Math.max(Math.abs(falling!.x - CENTRE), Math.abs(falling!.y - CENTRE))).toBeLessThan(96);
  });

  it("leaves the grid to the GPU when asked, keeping labels and markers", () => {
    const traced = computeAttitudeScene(state(), projection);
    const bare = computeAttitudeScene(state(), projection, { lines: false });
    expect(traced.horizon.length).toBeGreaterThan(0);
    expect([bare.horizon, bare.skyRings, bare.groundRings, bare.meridians, bare.cardinalMeridians].flat()).toEqual([]);
    expect(bare.ticks).toEqual([]);
    expect(bare.labels).toEqual(traced.labels);
    expect(bare.markers).toEqual(traced.markers);
  });

  it("draws no velocity markers when parked", () => {
    const scene = computeAttitudeScene(state({ northVelocityFps: 0.4, eastVelocityFps: -0.3 }), projection);
    expect(scene.markers).toEqual([]);
  });

  it("drops normal and radial flying straight up, where they have no direction", () => {
    const scene = computeAttitudeScene(state({ pitchRad: 89 * DEG, northVelocityFps: 0, verticalSpeedFps: 150 }), projection);
    expect(scene.markers.map(item => item.kind)).toEqual(["prograde"]);
  });

  it("labels headings in three digits and pitch in two, so they never read alike", () => {
    const labels = computeAttitudeScene(state({ headingRad: 45 * DEG }), projection).labels;
    const headings = labels.filter(label => label.kind === "heading").map(label => label.text);
    const pitches = labels.filter(label => label.kind === "pitch").map(label => label.text);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.every(text => /^\d{3}$/.test(text))).toBe(true);
    expect(pitches.length).toBeGreaterThan(0);
    expect(pitches.every(text => /^[1-8]0$/.test(text))).toBe(true);
    // Heading 045: north is to the left of the nose and east to the right.
    const north = labels.find(label => label.text === "N");
    const east = labels.find(label => label.text === "E");
    expect(north!.x).toBeLessThan(CENTRE);
    expect(east!.x).toBeGreaterThan(CENTRE);
  });

  it("keeps every label inside the frame", () => {
    for (const rollDeg of [0, 45, 120, 180]) {
      for (const label of computeAttitudeScene(state({ rollRad: rollDeg * DEG, pitchRad: 20 * DEG }), projection).labels) {
        expect(Math.abs(label.x - CENTRE)).toBeLessThan(96);
        expect(Math.abs(label.y - CENTRE)).toBeLessThan(96);
      }
    }
  });
});

describe("attitude colourmap", () => {
  it("shades sky blue and ground brown, deepening away from the horizon", () => {
    const [skyR, , skyB] = colourAtElevation(5);
    const [groundR, , groundB] = colourAtElevation(-5);
    expect(skyB).toBeGreaterThan(skyR);
    expect(groundR).toBeGreaterThan(groundB);
    const brightness = ([r, g, b]: number[]): number => r + g + b;
    expect(brightness(colourAtElevation(80))).toBeLessThan(brightness(colourAtElevation(10)));
    expect(brightness(colourAtElevation(-80))).toBeLessThan(brightness(colourAtElevation(-10)));
  });
});

/**
 * Drawn from the 3D camera, the ball turns with the view as the camera orbits,
 * and the aircraft symbol shows the nose and the wings against it: the
 * default since 2026-10-07 (Renderer → Instruments → Attitude indicator view).
 */
describe("attitude indicator drawn from the camera", () => {
  /** A level camera looking along `headingDeg`. */
  const camera = (headingDeg: number) => bodyToLocal(0, 0, headingDeg * DEG);

  it("is the aircraft's own instrument when drawn from the aircraft's frame", () => {
    const flying = state({ rollRad: 25 * DEG, pitchRad: 8 * DEG, headingRad: 40 * DEG });
    const own = computeAttitudeScene(flying, projection);
    expect(own.symbol).toEqual({ x: CENTRE, y: CENTRE, angle: 0, pinned: false });
    expect(own.view).toEqual(bodyToLocal(25 * DEG, 8 * DEG, 40 * DEG));
    const same = computeAttitudeScene(flying, projection, { view: own.view });
    expect(same.symbol!.x).toBeCloseTo(CENTRE, 6);
    expect(same.symbol!.y).toBeCloseTo(CENTRE, 6);
    expect(same.symbol!.angle).toBeCloseTo(0, 6);
    expect(same.horizon).toEqual(own.horizon);
  });

  it("keeps the camera's horizon level and turns the wings as the aircraft banks", () => {
    const banked = computeAttitudeScene(state({ rollRad: 30 * DEG }), projection, { view: camera(0) });
    // The horizon runs straight across, at the centre.
    for (const line of banked.horizon) for (let index = 1; index < line.length; index += 2) expect(line[index]).toBeCloseTo(CENTRE, 6);
    // The nose straight ahead; the right wing down, turned clockwise on screen.
    expect(banked.symbol!.x).toBeCloseTo(CENTRE, 6);
    expect(banked.symbol!.y).toBeCloseTo(CENTRE, 6);
    expect(banked.symbol!.angle / DEG).toBeCloseTo(30, 1);
    expect(banked.up[1]).toBeCloseTo(0, 6);
  });

  it("moves the symbol to where the nose points: left of a camera that looks east, as the aircraft heads north", () => {
    const aside = computeAttitudeScene(state(), projection, { view: camera(90) });
    expect(aside.symbol!.x).toBeLessThan(CENTRE - 80);
    expect(aside.symbol!.y).toBeCloseTo(CENTRE, 6);
    // Pitched up 20° under a level camera ahead, the nose is above the centre.
    const climbing = computeAttitudeScene(state({ pitchRad: 20 * DEG }), projection, { view: camera(0) });
    expect(climbing.symbol!.y).toBeLessThan(CENTRE - 20);
  });

  it("pins the symbol to the edge, dimmed, where the nose points out of the frame, and hides it straight behind", () => {
    const behindAside = computeAttitudeScene(state(), projection, { view: camera(130) });
    expect(behindAside.symbol!.pinned).toBe(true);
    expect(Math.max(Math.abs(behindAside.symbol!.x - CENTRE), Math.abs(behindAside.symbol!.y - CENTRE))).toBeLessThanOrEqual(96);
    expect(computeAttitudeScene(state(), projection, { view: camera(180) }).symbol).toBeNull();
  });

  it("draws the velocity markers against the camera's view too", () => {
    const prograde = computeAttitudeScene(state(), projection, { view: camera(90) }).markers.find(item => item.kind === "prograde")!;
    expect(prograde.x).toBeLessThan(CENTRE - 80);
  });
});

/**
 * The grid as the indicator traced it before its directions were cached
 * (as at fly c67157c): one sphere() call per point, each projecting a fresh
 * direction. The cached grid must give every number of it, bit for bit.
 */
function referenceGrid(m: AttitudeView, projection: AttitudeProjection) {
  const TRACE_LIMIT = 175 * DEG;
  const centre = projection.size / 2;
  const local = (north: number, east: number, down: number) => {
    const y = m[1] * north + m[4] * east + m[7] * down;
    const z = m[2] * north + m[5] * east + m[8] * down;
    const x = m[0] * north + m[3] * east + m[6] * down;
    const lateral = Math.hypot(y, z);
    const angle = Math.atan2(lateral, x);
    if (lateral < 1e-12) return { x: centre, y: centre, angle };
    const scale = radiusForAngle(projection, angle) / lateral;
    return { x: centre + y * scale, y: centre + z * scale, angle };
  };
  const sphere = (elevation: number, azimuth: number) => {
    const level = Math.cos(elevation);
    return local(level * Math.cos(azimuth), level * Math.sin(azimuth), -Math.sin(elevation));
  };
  const trace = (count: number, point: (index: number) => { x: number; y: number; angle: number }, out: number[][]) => {
    const reach = projection.half + 1;
    let line: number[] = [];
    let previous: { x: number; y: number } | null = null;
    let previousInside = false;
    const finish = () => {
      if (line.length >= 4) out.push(line);
      line = [];
    };
    for (let index = 0; index <= count; index++) {
      const at = point(index);
      if (!(at.angle <= TRACE_LIMIT)) {
        finish();
        previous = null;
        previousInside = false;
        continue;
      }
      const inside = Math.abs(at.x - centre) <= reach && Math.abs(at.y - centre) <= reach;
      if (inside && line.length === 0 && previous) line.push(previous.x, previous.y);
      if (inside || previousInside) line.push(at.x, at.y);
      if (!inside && previousInside) finish();
      previous = at;
      previousInside = inside;
    }
    finish();
  };
  const grid: Pick<AttitudeScene, "horizon" | "skyRings" | "groundRings" | "meridians" | "cardinalMeridians" | "ticks"> = {
    horizon: [], skyRings: [], groundRings: [], meridians: [], cardinalMeridians: [], ticks: [],
  };
  trace(180, index => sphere(0, index * 2 * DEG), grid.horizon);
  for (let deg = -80; deg <= 80; deg += 10) {
    if (deg === 0) continue;
    trace(90, index => sphere(deg * DEG, index * 4 * DEG), deg > 0 ? grid.skyRings : grid.groundRings);
  }
  for (let deg = 0; deg < 360; deg += 30) {
    trace(60, index => sphere((index * 3 - 90) * DEG, deg * DEG), deg % 90 === 0 ? grid.cardinalMeridians : grid.meridians);
  }
  const tick = ATTITUDE_TICK_HALF_LENGTH * attitudeArtScale(projection) / projection.a;
  for (let deg = 10; deg < 360; deg += 10) {
    if (deg % 30 === 0) continue;
    const below = sphere(-tick, deg * DEG);
    const above = sphere(tick, deg * DEG);
    if (below.angle <= TRACE_LIMIT && above.angle <= TRACE_LIMIT) grid.ticks.push(below.x, below.y, above.x, above.y);
  }
  return grid;
}

describe("attitude grid", () => {
  it("traces every number of the grid as projecting each point afresh does, at every attitude, view and size", () => {
    const LINES = ["horizon", "skyRings", "groundRings", "meridians", "cardinalMeridians"] as const;
    // Sizes alternate call by call, so the ticks' length changes between frames,
    // and the smallest is below the size where the artwork stops shrinking.
    const projections = [projection, createAttitudeProjection(160, 72), createAttitudeProjection(96, 43.2), createAttitudeProjection(300, 135)];
    const angles = [0, 1e-9, 0.3, 45 * DEG, 89.999 * DEG, 90 * DEG, 135 * DEG, 180 * DEG, -30 * DEG, -90 * DEG, -179.9 * DEG];
    let compared = 0, frames = 0;
    const check = (flying: AttitudeState, view: AttitudeView | null, size: AttitudeProjection) => {
      const scene = computeAttitudeScene(flying, size, { view });
      const expected = referenceGrid(view ?? bodyToLocal(flying.rollRad, flying.pitchRad, flying.headingRad), size);
      for (const key of LINES) {
        expect(scene[key].length, key).toBe(expected[key].length);
        scene[key].forEach((line, index) => {
          const reference = expected[key][index]!;
          expect(line.length, `${key} ${index}`).toBe(reference.length);
          for (let n = 0; n < line.length; n++) {
            if (!Object.is(line[n], reference[n])) expect.fail(`${key} ${index}[${n}]: ${line[n]} vs ${reference[n]}`);
          }
          compared += line.length;
        });
      }
      expect(scene.ticks.length).toBe(expected.ticks.length);
      for (let n = 0; n < scene.ticks.length; n++) if (!Object.is(scene.ticks[n], expected.ticks[n])) expect.fail(`tick ${n}: ${scene.ticks[n]} vs ${expected.ticks[n]}`);
      compared += scene.ticks.length;
      frames++;
    };
    // Level, rolled, inverted, vertical and backwards, each drawn from the aircraft and from cameras around it.
    let call = 0;
    for (const roll of angles) for (const pitch of angles) for (const heading of [0, 0.3, 90 * DEG, 180 * DEG, -100 * DEG]) {
      const flying = state({ rollRad: roll, pitchRad: pitch, headingRad: heading });
      check(flying, null, projections[call++ % projections.length]!);
      check(flying, bodyToLocal(0, pitch * 0.5, heading + 180 * DEG), projections[call++ % projections.length]!);
    }
    // And a slow tumble through every attitude.
    for (let index = 0; index < 600; index++) {
      const flying = state({ rollRad: (index * 0.0137) % (2 * Math.PI) - Math.PI, pitchRad: Math.sin(index * 0.031) * 1.5707963, headingRad: (index * 0.0091) % (2 * Math.PI) });
      check(flying, index % 3 === 0 ? bodyToLocal(0.1, -0.2, index * 0.05) : null, projections[index % projections.length]!);
    }
    expect(frames).toBe(angles.length ** 2 * 10 + 600);
    expect(compared).toBeGreaterThan(1_000_000);
  });
});
