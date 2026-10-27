import { surfaceHeightDatum, type PositionSeaLevelPort } from "foss-earth/shell";
import type { BabylonRuntimeStatus } from "foss-earth/runtime";
import type { SettingsRegistry } from "foss-earth/settings";

/** FOSS Earth's Interface → Position readout → Sea level grid: which EGM2008 grid the geoid comes from. */
export const SEA_LEVEL_GRID_ID = "interface.position.seaLevelGrid";

/**
 * Sea level's height, in metres, in the heights the globe draws at a place:
 * 0 over raster terrain, whose heights are above sea level already, and the
 * EGM2008 geoid's over Google 3D Tiles, which are drawn at their heights above
 * the WGS84 ellipsoid. Null while the geoid's grid loads, or if it cannot.
 */
export function seaLevelMeters(
  seaLevel: PositionSeaLevelPort | null | undefined,
  settings: SettingsRegistry,
  mode: BabylonRuntimeStatus["mode"],
  latDeg: number,
  lonDeg: number,
): number | null {
  if (surfaceHeightDatum(mode) === "geoid") return 0;
  const grid = settings.has(SEA_LEVEL_GRID_ID) ? settings.get<string>(SEA_LEVEL_GRID_ID) : null;
  return seaLevel?.read({ latDeg, lonDeg, heightDatum: "ellipsoid" }, grid).baseMeters ?? null;
}
