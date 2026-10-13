// Copied from FOSS Earth engine 1573d79, src/location/provider/searchDefaults.ts and
// searchTuning.ts. The flight reads FOSS Earth's own `search.*` parameters from the
// one app registry; it registers none.
import type { SettingsRegistry } from "foss-earth/settings";

/** Location and airport lookups: `search.cacheDuration`, `search.cacheEntries` and `search.timeout`'s defaults. */
export const SEARCH_DEFAULTS = Object.freeze({
  /** How long an answer is kept, hours. */
  cacheHours: 24,
  /** How many answers the shared device cache keeps across all lookup types. */
  cacheEntries: 64,
  /** How long one request may take, seconds. */
  timeoutSeconds: 20,
});

/** What the search reads: the app's `search.*` parameters. */
export interface SearchTuning {
  cacheMs: number;
  cacheEntries: number;
  timeoutMs: number;
}

function positive(settings: Pick<SettingsRegistry, "get" | "has">, id: string, fallback: number): number {
  const value = settings.has(id) ? settings.get(id) : undefined;
  return typeof value === "number" && value > 0 ? value : fallback;
}

/** The `search.*` parameters now, read at each lookup. */
export function readLocationSearchTuning(settings: Pick<SettingsRegistry, "get" | "has">): SearchTuning {
  return {
    cacheMs: positive(settings, "search.cacheDuration", SEARCH_DEFAULTS.cacheHours) * 3_600_000,
    cacheEntries: Math.max(1, Math.round(positive(settings, "search.cacheEntries", SEARCH_DEFAULTS.cacheEntries))),
    timeoutMs: positive(settings, "search.timeout", SEARCH_DEFAULTS.timeoutSeconds) * 1000,
  };
}
