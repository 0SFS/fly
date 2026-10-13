import { createMapDetailController, type MapDetailController, type MapDetailControllerOptions, type MapDetailStorage } from "foss-earth/shell";
import { createEngineMigrations, MAP_DETAIL_PARAMETERS, MAP_DETAIL_STORAGE_KEY } from "foss-earth/runtime";
import { createSettingsRegistry } from "foss-earth/settings";

/**
 * For tests: a detail controller over a registry of its own on `storage`,
 * holding the map.detail.* parameters and migrating a saved MAP_DETAIL_STORAGE_KEY
 * record, as FOSS Earth's controller made one when given storage instead of settings.
 */
export function privateMapDetailController(
  storage: MapDetailStorage | null,
  options: Omit<MapDetailControllerOptions, "settings" | "storage" | "deviceHints"> & Partial<Pick<MapDetailControllerOptions, "deviceHints">> = {},
): MapDetailController {
  const settings = createSettingsRegistry({ storage });
  settings.register(MAP_DETAIL_PARAMETERS.filter(spec => spec.id.startsWith("map.detail.") && spec.kind !== "choice"));
  settings.migrateLegacy(createEngineMigrations(storage).filter(migration => migration.key === MAP_DETAIL_STORAGE_KEY));
  return createMapDetailController({ ...options, settings, deviceHints: options.deviceHints ?? (() => ({})) });
}
