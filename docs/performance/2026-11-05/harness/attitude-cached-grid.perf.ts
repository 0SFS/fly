// Evidence for prompts/03-attitude-indicator.md: a prototype of the attitude
// grid with its fixed sphere directions computed once and projected into one
// reused Float64Array. It re-states createView's local() and trace() from
// src/flight/hud/attitudeIndicator.ts with the same expressions in the same
// order, so every number must match the shipped computeAttitudeScene. It is
// kept as the audit's evidence; a shipped version needs its own tests.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  ATTITUDE_TICK_HALF_LENGTH, attitudeArtScale, bodyToLocal, computeAttitudeScene, createAttitudeProjection,
  type AttitudeProjection,
} from "../../../../src/flight/hud/attitudeIndicator";

const fly = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = path.join(fly, "build/perf-20261105");
mkdirSync(out, { recursive: true });

const DEG = Math.PI / 180;
const TRACE_LIMIT = 175 * DEG;
type Target = "horizon" | "skyRings" | "groundRings" | "meridians" | "cardinalMeridians";
interface Grid { directions: Float64Array; runs: { start: number; count: number; target: Target }[]; tickStart: number; tickCount: number }

/** The grid traceGrid() walks, as north/east/down unit directions, in its order. */
function buildGrid(projection: AttitudeProjection): Grid {
  const directions: number[] = [];
  const runs: Grid["runs"] = [];
  const push = (elevation: number, azimuth: number) => {
    const level = Math.cos(elevation);
    directions.push(level * Math.cos(azimuth), level * Math.sin(azimuth), -Math.sin(elevation));
  };
  let start = 0;
  for (let index = 0; index <= 180; index++) push(0, index * 2 * DEG);
  runs.push({ start, count: 181, target: "horizon" }); start += 181;
  for (let deg = -80; deg <= 80; deg += 10) {
    if (deg === 0) continue;
    for (let index = 0; index <= 90; index++) push(deg * DEG, index * 4 * DEG);
    runs.push({ start, count: 91, target: deg > 0 ? "skyRings" : "groundRings" }); start += 91;
  }
  for (let deg = 0; deg < 360; deg += 30) {
    for (let index = 0; index <= 60; index++) push((index * 3 - 90) * DEG, deg * DEG);
    runs.push({ start, count: 61, target: deg % 90 === 0 ? "cardinalMeridians" : "meridians" }); start += 61;
  }
  const tick = ATTITUDE_TICK_HALF_LENGTH * attitudeArtScale(projection) / projection.a;
  const tickStart = start;
  let tickCount = 0;
  for (let deg = 10; deg < 360; deg += 10) {
    if (deg % 30 === 0) continue;
    push(-tick, deg * DEG); push(tick, deg * DEG); tickCount++;
  }
  return { directions: Float64Array.from(directions), runs, tickStart, tickCount };
}

function cachedGrid(m: readonly number[], projection: AttitudeProjection, grid: Grid, points: Float64Array) {
  const centre = projection.size / 2, a = projection.a, b = projection.b, d = grid.directions;
  for (let k = 0; k < d.length; k += 3) {
    const north = d[k], east = d[k + 1], down = d[k + 2];
    const y = m[1] * north + m[4] * east + m[7] * down;
    const z = m[2] * north + m[5] * east + m[8] * down;
    const x = m[0] * north + m[3] * east + m[6] * down;
    const lateral = Math.hypot(y, z);
    const angle = Math.atan2(lateral, x);
    if (lateral < 1e-12) { points[k] = centre; points[k + 1] = centre; points[k + 2] = angle; continue; }
    const scale = a * angle / (1 + b * angle) / lateral;
    points[k] = centre + y * scale; points[k + 1] = centre + z * scale; points[k + 2] = angle;
  }
  const scene: Record<Target, number[][]> & { ticks: number[] } = { horizon: [], skyRings: [], groundRings: [], meridians: [], cardinalMeridians: [], ticks: [] };
  const reach = projection.half + 1;
  for (const run of grid.runs) {
    const lines = scene[run.target];
    let line: number[] = [];
    let previous = -1, previousInside = false;
    for (let j = 0; j < run.count; j++) {
      const k = (run.start + j) * 3;
      if (!(points[k + 2] <= TRACE_LIMIT)) {
        if (line.length >= 4) lines.push(line);
        line = []; previous = -1; previousInside = false;
        continue;
      }
      const inside = Math.abs(points[k] - centre) <= reach && Math.abs(points[k + 1] - centre) <= reach;
      if (inside && line.length === 0 && previous >= 0) line.push(points[previous], points[previous + 1]);
      if (inside || previousInside) line.push(points[k], points[k + 1]);
      if (!inside && previousInside) { if (line.length >= 4) lines.push(line); line = []; }
      previous = k; previousInside = inside;
    }
    if (line.length >= 4) lines.push(line);
  }
  for (let t = 0; t < grid.tickCount; t++) {
    const below = (grid.tickStart + 2 * t) * 3, above = below + 3;
    if (points[below + 2] <= TRACE_LIMIT && points[above + 2] <= TRACE_LIMIT) scene.ticks.push(points[below], points[below + 1], points[above], points[above + 1]);
  }
  return scene;
}

it("Attitude grid with cached directions: identical numbers, time per frame", () => {
  const projection = createAttitudeProjection(220, 220 * 0.45);
  const grid = buildGrid(projection);
  const points = new Float64Array(grid.directions.length);
  let compared = 0, mismatches = 0;
  for (let i = 0; i < 4000; i++) {
    // Rolled, inverted, vertical and backwards attitudes.
    const roll = (i * 0.0137) % (2 * Math.PI) - Math.PI, pitch = Math.sin(i * 0.0031) * 1.5707, heading = (i * 0.0091) % (2 * Math.PI);
    const reference = computeAttitudeScene({ rollRad: roll, pitchRad: pitch, headingRad: heading, northVelocityFps: 150, eastVelocityFps: 20, verticalSpeedFps: 3 }, projection, { lines: true });
    const fast = cachedGrid(bodyToLocal(roll, pitch, heading), projection, grid, points);
    for (const key of ["horizon", "skyRings", "groundRings", "meridians", "cardinalMeridians", "ticks"] as const) {
      const expected = (reference[key] as unknown[]).flat() as number[], actual = (fast[key] as unknown[]).flat() as number[];
      if (expected.length !== actual.length) { mismatches++; continue; }
      for (let n = 0; n < expected.length; n++) { compared++; if (!Object.is(expected[n], actual[n])) mismatches++; }
    }
  }
  const frames = 5000;
  const time = (work: (i: number) => void) => Math.min(...[0, 1, 2].map(() => {
    const started = performance.now();
    for (let i = 0; i < frames; i++) work(i);
    return (performance.now() - started) * 1000 / frames;
  }));
  const state = (i: number) => ({ rollRad: 0.3 + i * 1e-4, pitchRad: 0.05, headingRad: 1.2, northVelocityFps: 150, eastVelocityFps: 20, verticalSpeedFps: 3 });
  const shipped = () => time(i => computeAttitudeScene(state(i), projection, { lines: true }));
  const withoutGrid = () => time(i => computeAttitudeScene(state(i), projection, { lines: false }));
  const gridOnly = () => time(i => cachedGrid(bodyToLocal(0.3 + i * 1e-4, 0.05, 1.2), projection, grid, points));
  shipped(); withoutGrid(); gridOnly();
  appendFileSync(path.join(out, "results.jsonl"), JSON.stringify({
    case: "attitude-cached-grid", compared, mismatches,
    usShippedScene: +shipped().toFixed(1), usSceneWithoutGrid: +withoutGrid().toFixed(1), usCachedGrid: +gridOnly().toFixed(1), node: process.version,
  }) + "\n");
  expect(mismatches).toBe(0);
});
