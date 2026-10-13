import type { AirportFlightPreset, AirportMode, AirportPoint, AirportRunway } from "./airportTypes";

const RAD = Math.PI / 180;
const EARTH_RADIUS = 6371008.8;
/** The arrival preset starts this far before the threshold: 5 NM. */
const APPROACH_METERS = 5 * 1852;
/** Threshold crossing height on the nominal 3° descent: 50 ft. */
const THRESHOLD_CROSSING_METERS = 15.24;

// `bearing` and `distance` are FOSS Earth's airport geometry, which no compat
// route exports. The flight's runway lookup and spawn need the same formulas.
export function bearing(from: AirportPoint, to: AirportPoint): number {
  const delta = (to.lonDeg - from.lonDeg) * RAD;
  const a = from.latDeg * RAD, b = to.latDeg * RAD;
  return (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b)
    - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / RAD + 360) % 360;
}
export function distance(from: AirportPoint, to: AirportPoint): number {
  const a = Math.sin((to.latDeg - from.latDeg) * RAD / 2) ** 2
    + Math.cos(from.latDeg * RAD) * Math.cos(to.latDeg * RAD) * Math.sin((to.lonDeg - from.lonDeg) * RAD / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function destination(from: AirportPoint, headingDeg: number, meters: number): AirportPoint {
  const d = meters / EARTH_RADIUS, h = headingDeg * RAD, lat = from.latDeg * RAD;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(h));
  const nextLon = from.lonDeg * RAD + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(nextLat));
  return { latDeg: nextLat / RAD, lonDeg: ((nextLon / RAD + 540) % 360) - 180 };
}

/**
 * Departure: 50 m along the runway (less on a short one), on the ground.
 * Arrival: 5 NM before the threshold on a 3° descent, 50 ft over the threshold.
 * A basic straight-in preset, not a published procedure or terrain clearance.
 */
export function airportSpawn(runway: AirportRunway, mode: AirportMode): AirportPoint & { altMeters: number; flightPreset: AirportFlightPreset } {
  if (runway.elevationMeters === undefined || !Number.isFinite(runway.elevationMeters)) {
    throw new Error("Runway elevation is unavailable. Enter coordinates manually instead.");
  }
  const point = mode === "departure"
    ? destination(runway.start, runway.headingDeg, Math.min(50, runway.lengthMeters * 0.1))
    : destination(runway.start, runway.headingDeg + 180, APPROACH_METERS);
  return {
    ...point,
    // Departure height is adjusted to the aircraft's gear clearance by the host.
    altMeters: runway.elevationMeters + (mode === "arrival" ? Math.tan(3 * RAD) * APPROACH_METERS + THRESHOLD_CROSSING_METERS : 0),
    flightPreset: { mode, headingDeg: runway.headingDeg, groundElevationMeters: runway.elevationMeters, flightPathDeg: mode === "arrival" ? -3 : 0 },
  };
}
