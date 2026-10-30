import type { SettingsRegistry } from "foss-earth/settings";

/** A flight shares its process with physics and aircraft, so physical RAM is not its map allowance. */
export function applyFlightResourceDefaults(settings: Pick<SettingsRegistry, "setHostDefault" | "get">): Record<string, unknown> {
  const defaults = [
    ["map.source.elevation", "aws-terrarium", "Use the supported 256-pixel elevation tiles in flight, bounding each decoded grid to one quarter of a 512-pixel tile's storage; another provider remains selectable"],
    ["map.terrain.tileSegments", 32, "Bound per-tile position, picking and GPU buffers in flight; larger segment counts remain an explicit terrain-detail setting"],
    ["map.imagery.gpuBudget", 32, "Bound the flight imagery cache alongside physics, terrain and aircraft assets; reported device RAM does not establish the browser process limit"],
    ["map.imagery.pageTablePatches", 256, "Match the flight terrain working set, including transactional page-table storage"],
    ["map.terrain.maxTiles", 256, "Bound the flight terrain working set while leaving room for the aircraft's ground region; farther regions stay coarser at the limit"],
    ["map.terrain.cachedTiles", 32, "Bound historical terrain retention; live tiles and their required coarse ancestors remain protected"],
    ["wasm.core.terrain", "auto", "Use the terrain core's recorded Auto choice to avoid retaining worker copies of the flight's elevation grids"],
    ["wasm.workers", 6, "Bound preparation workers while leaving room for a background elevation decoder beside the dedicated preparation cores"],
    ["wasm.threads", 1, "Bound the sky coordinator and its helper storage alongside the flight's other preparation work"],
    ["map.loader.requests", 2, "Bound simultaneous terrain download and decode buffers during flight startup"],
    ["map.loader.cacheEntries", 32, "Retain a small elevation download cache; live terrain records retain their own full-resolution height grids"],
  ] as const;
  for (const [id, value, reason] of defaults) settings.setHostDefault(id, value, reason);
  return Object.fromEntries(defaults.map(([id]) => [id, settings.get(id)]));
}
