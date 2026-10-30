import type { TerrainRegionOptions } from "foss-earth/runtime";
import type { FlightState } from "@0sfs/ground-contact/flightState";
import type { FlightParameters } from "./settings/flightParameters";

/** World-relative velocity, not the aircraft's nose or indicated airspeed. */
export function flightRegion(state: FlightState, drone: boolean, bodyRadius: number, parameters: FlightParameters): Omit<TerrainRegionOptions, "onProgress" | "signal"> {
  const type = drone ? "drone" : "plane";
  const n = state.northVelocityFps * 0.3048;
  const e = state.eastVelocityFps * 0.3048;
  const u = state.verticalSpeedFps * 0.3048;
  const speed = Math.hypot(n, e, u);
  const aircraftRadius = Number.isFinite(bodyRadius) ? Math.max(0, bodyRadius) : 0;
  const radius = Math.max(parameters.get(`osfs.region.${type}.radius`),
    parameters.get(`osfs.region.${type}.sizeMultiplier`) * aircraftRadius + (drone ? parameters.get("osfs.region.drone.horizon") * speed : 0));
  const latitude = state.latDeg * Math.PI / 180;
  const longitude = state.lonDeg * Math.PI / 180;
  const cone = !drone && speed >= 0.5 ? {
    directionEcef: {
      x: (-n * Math.sin(latitude) * Math.cos(longitude) - e * Math.sin(longitude) + u * Math.cos(latitude) * Math.cos(longitude)) / speed,
      y: (-n * Math.sin(latitude) * Math.sin(longitude) + e * Math.cos(longitude) + u * Math.cos(latitude) * Math.sin(longitude)) / speed,
      z: (n * Math.cos(latitude) + u * Math.sin(latitude)) / speed,
    },
    lengthMeters: Math.min(parameters.get("osfs.region.plane.coneLength"), speed * parameters.get("osfs.region.plane.horizon")),
    halfAngleDeg: parameters.get("osfs.region.plane.coneAngle"),
  } : undefined;
  const finalError = parameters.get(`osfs.region.${type}.finalError`);
  const finalZoom = Math.round(parameters.get(`osfs.region.${type}.finalZoom`));
  return {
    region: {
      center: { latDeg: state.latDeg, lonDeg: state.lonDeg, altitudeMeters: state.altMeters },
      radiusMeters: Math.min(parameters.get(`osfs.region.${type}.radiusCap`), radius),
      ...(cone && cone.lengthMeters > 0 ? { cone } : {}),
    },
    minimum: {
      googleErrorMeters: Math.max(finalError, parameters.get(`osfs.region.${type}.minimumError`)),
      rasterZoom: Math.min(finalZoom, Math.round(parameters.get(`osfs.region.${type}.minimumZoom`))),
    },
    final: { googleErrorMeters: finalError, rasterZoom: finalZoom },
  };
}
