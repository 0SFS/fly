import { AIRCRAFT_IDS } from "@0sfs/aircraft/aircraftIds";
import type { OsfsModManifest } from "@0sfs/mods/schema";
import { BUNDLED_MODS } from "./bundledMods";

const KNOWN_IDS = new Set<string>(AIRCRAFT_IDS);

/**
 * The default modpack's aircraft whose ids this build knows (`AIRCRAFT_IDS`), in
 * the pack's order. They join the fleet as the app loads, before anything reads
 * the catalog. Another aircraft in the pack, such as a drone, joins when the mods
 * session installs the pack, as an added mod does.
 */
export const BUILTIN_AIRCRAFT_MODS: readonly OsfsModManifest[] = BUNDLED_MODS
  .map(([, manifest]) => manifest)
  .filter(manifest => {
    const ids = Object.keys(manifest.aircraft?.fdmProfiles ?? {});
    return manifest.kind === "aircraft" && ids.length > 0 && ids.every(id => KNOWN_IDS.has(id));
  });
