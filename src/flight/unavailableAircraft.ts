import type { SettingsRegistry } from "foss-earth/settings";

/**
 * The aircraft this page's address or this browser asked for that nothing
 * installed supplies, such as a drone whose mod is off. The registry holds the
 * request until a mod adds it; meanwhile the setting reads as another aircraft,
 * which the pilot has not chosen. Null when the asked-for aircraft flies, or
 * when the app holds the choice, as a benchmark route does.
 */
export function unavailableAircraftRequest(settings: Pick<SettingsRegistry, "inspect">): string | null {
  const state = settings.inspect("osfs.aircraft.id");
  if (state.provenance === "host") return null;
  const asked = state.layers.url?.value ?? state.layers.saved?.value;
  return typeof asked === "string" && asked !== state.value ? asked : null;
}
