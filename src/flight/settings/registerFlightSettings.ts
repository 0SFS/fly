import { AIRCRAFT_CATALOG, AIRCRAFT_FAMILIES, subscribeAircraftCatalog } from "@0sfs/aircraft/aircraftCatalog";
import { frameProfilingParameters } from "@foss-earth/renderer/settings";
import type { SettingsRegistry } from "foss-earth/settings";
import { OSFS_LEGACY_MIGRATIONS } from "./flightMigrations";
import { FLIGHT_PRESETS } from "./flightPresets";
import { groundProfilesMigration } from "@0sfs/ground-contact/groundInteractionSettings";
import {
  FLIGHT_SECTION_TITLES,
  flightParameterStore,
  OSFS_PARAMETERS,
  type FlightParameterStore,
} from "./flightParameters";

/** Where the 0SFS repositories are browsable. */
const OSFS_REPOSITORIES = "https://github.com/0SFS/";

/** Where fly's files that read osfs.* parameters are browsable. */
export const OSFS_SOURCE_BASE = `${OSFS_REPOSITORIES}fly/blob/main/`;

/** fly's top-level folders. A source under any other folder is in the 0SFS repository of that name. */
const FLY_FOLDERS = new Set(["src", "scripts", "public", "benchmarks", "docs", "validation"]);

/**
 * The repository and path of a parameter's source. A source names a fly file
 * from fly's folder (src/…) and another repository's file from the folder the
 * repositories share (controls/src/…).
 */
export function parameterSourceFile(source: string): { repository: string; path: string } {
  const [first, ...rest] = source.split("/");
  return rest.length === 0 || FLY_FOLDERS.has(first) ? { repository: "fly", path: source } : { repository: first, path: rest.join("/") };
}

/** The aircraft's id among FOSS Earth's focus points (`map.focus.point`). */
export const AIRCRAFT_FOCUS_POINT = "aircraft";

/**
 * The aircraft and generation lists the settings store will accept. Built from
 * the live catalogue, so an aircraft a mod adds can be saved. The lists written
 * into the parameter specs are only the built-in fleet at module load.
 */
export function syncAircraftSettingChoices(registry: SettingsRegistry): void {
  if (AIRCRAFT_CATALOG.length === 0 || !registry.has("osfs.aircraft.id")) return;
  const variants = AIRCRAFT_FAMILIES.flatMap(family => family.variants);
  registry.setChoices("osfs.aircraft.id", AIRCRAFT_CATALOG.map(definition => ({
    id: definition.id,
    label: variants.find(variant => variant.aircraftId === definition.id)?.label ?? definition.label,
  })));
  registry.setChoices("osfs.aircraft.generation", AIRCRAFT_FAMILIES.flatMap(family => family.variants.map(variant => ({
    id: variant.id,
    label: family.variants.length > 1 ? `${family.label} ${variant.label}` : variant.label,
  }))));
}

/**
 * Adds the flight's parameters and presets to the app's settings registry,
 * once, with their section titles, source links and the migration of the keys
 * they replace, and sets the FOSS Earth defaults the flight wants.
 */
export function registerFlightSettings(registry: SettingsRegistry): FlightParameterStore {
  if (!registry.has(OSFS_PARAMETERS[0].id)) {
    // The registry links a parameter to its base followed by its source, so
    // each parameter gets its repository's base and a path within it. Every
    // id has its own base: the longest matching prefix wins, and one id can
    // be the start of another's.
    registry.register(OSFS_PARAMETERS.map(spec => ({ ...spec, source: parameterSourceFile(spec.source).path })));
    // Debug → Frame budget is the frame profiling's one home in the flight.
    registry.register(frameProfilingParameters({ tab: "debug", section: "frame-budget" }));
    for (const [tab, section, title] of FLIGHT_SECTION_TITLES) registry.setSectionTitle(tab, section, title);
    registry.setSourceBase("osfs.", OSFS_SOURCE_BASE);
    for (const spec of OSFS_PARAMETERS) {
      registry.setSourceBase(spec.id, `${OSFS_REPOSITORIES}${parameterSourceFile(spec.source).repository}/blob/main/`);
    }
    // Google's mesh refines by distance from the aircraft, not the chase camera.
    registry.setHostDefault("map.focus.refineFrom", "focus", "0sfs: refine around the aircraft");
    // The flight registers the aircraft as a focus point once the renderer
    // exists; until then this default waits for its option.
    registry.setHostDefault("map.focus.point", AIRCRAFT_FOCUS_POINT, "0sfs: the aircraft");
    // The ground under the aircraft is its collision surface, and the cockpit
    // view does not look at it: load it in every direction, as well as the view.
    registry.setHostDefault("map.focus.mode", "both", "0sfs: the ground around the aircraft, as well as the view");
    // The toolbar's altitude stands in for the HUD's feet tape, beside knots and feet per minute.
    registry.setHostDefault("interface.position.altitudeUnit", "ft", "0sfs: the unit of the altitude tape it replaces");
    // The flight draws its canvas full screen and the windows float over it, as
    // they always did: FOSS Earth's split view moves only the globe's canvas.
    if (registry.has("interface.windows.presentation")) registry.setHostDefault("interface.windows.presentation", "overlay", "0sfs: the windows float over the flight");
    registry.registerPresets(FLIGHT_PRESETS);
    registry.migrateLegacy([...OSFS_LEGACY_MIGRATIONS, groundProfilesMigration(registry)]);
    syncAircraftSettingChoices(registry);
    subscribeAircraftCatalog(() => { syncAircraftSettingChoices(registry); });
  }
  return flightParameterStore(registry);
}
