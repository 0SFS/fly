import type { FlightState } from "@0sfs/ground-contact/flightState";
import type { OverviewMapOverlay } from "foss-earth/shell";

const EARTH_RADIUS_M = 6378137;
const METERS_PER_DEG_LAT = EARTH_RADIUS_M * Math.PI / 180;
const FOOT_M = 0.3048;
/** How far ahead the line looks, at the speed the aircraft has now. */
const HORIZON_S = 60;
const STEP_S = 5;
/** Below this ground speed the line would sit on the aircraft. */
const MIN_SPEED_MPS = 1;

/**
 * Where constant ground velocity puts the aircraft. This is a flight mark:
 * other apps do not load it.
 */
export function predictFlightPath(state: FlightState, horizonS = HORIZON_S, stepS = STEP_S): { latDeg: number; lonDeg: number }[] {
  const north = state.northVelocityFps * FOOT_M;
  const east = state.eastVelocityFps * FOOT_M;
  if (north * north + east * east < MIN_SPEED_MPS * MIN_SPEED_MPS) return [];
  const lat0 = state.latDeg * Math.PI / 180;
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(lat0);
  if (Math.abs(metersPerDegLon) < 1) return [];
  const points: { latDeg: number; lonDeg: number }[] = [];
  for (let t = 0; t <= horizonS + 1e-6; t += stepS) {
    const latDeg = Math.max(-85, Math.min(85, state.latDeg + (north * t) / METERS_PER_DEG_LAT));
    let lonDeg = state.lonDeg + (east * t) / metersPerDegLon;
    lonDeg = ((lonDeg + 180) % 360 + 360) % 360 - 180;
    points.push({ latDeg, lonDeg });
  }
  return points;
}

/** The predicted path, drawn by the map and owned here. */
export function createFlightPathOverlay(read: () => FlightState | null): OverviewMapOverlay {
  return {
    revision(): string {
      const state = read();
      if (!state) return "";
      return `${state.latDeg.toFixed(4)},${state.lonDeg.toFixed(4)},${state.northVelocityFps.toFixed(0)},${state.eastVelocityFps.toFixed(0)}`;
    },
    paint(frame): void {
      const state = read();
      if (!state) return;
      const points = predictFlightPath(state);
      if (points.length < 2) return;
      const { context } = frame;
      context.save();
      context.beginPath();
      let drawing = false;
      for (const point of points) {
        const at = frame.project(point.latDeg, point.lonDeg);
        if (!at) { drawing = false; continue; }
        if (!drawing) context.moveTo(at.x, at.y);
        else context.lineTo(at.x, at.y);
        drawing = true;
      }
      context.lineJoin = "round";
      context.lineCap = "round";
      context.lineWidth = 3.5;
      context.strokeStyle = "rgba(15, 23, 42, 0.85)";
      context.stroke();
      context.lineWidth = 1.75;
      context.strokeStyle = "#38bdf8";
      context.stroke();
      context.restore();
    },
  };
}
