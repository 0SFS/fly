import { getAppSettings, type SettingsRegistry } from "foss-earth/settings";
import { registerFlightSettings } from "./registerFlightSettings";

/**
 * The pilot's "Rearm on the ground only" setting, shown in the Fuel and
 * Armament tabs. Off by default: single-player flight changes the weapon load
 * and the fuel in the air. On, both wait for weight on the wheels. Jettison
 * and the bay doors never wait.
 */
export const REARM_GROUND_ONLY = "osfs.rearm.groundOnly";

/** "pilot" leaves the setting to the pilot; "ground-only" holds it on. */
export type RearmRule = "pilot" | "ground-only";

const DEFAULT_REASON = "This session rearms on the ground only.";
const held = new WeakMap<SettingsRegistry, () => void>();

/**
 * The one call a session host makes. There is no session protocol for rearm
 * yet; a later server or multiplayer host calls this with "ground-only" when
 * its rule applies, and with "pilot" (the default) when it no longer does.
 * The setting then shows as held, with the reason, and both tabs follow it.
 * The held value is never saved over the pilot's own.
 */
export function setRearmRule(
  rule: RearmRule = "pilot",
  { settings = getAppSettings(), reason = DEFAULT_REASON }: { settings?: SettingsRegistry; reason?: string } = {},
): void {
  registerFlightSettings(settings);
  held.get(settings)?.();
  held.delete(settings);
  if (rule === "ground-only") held.set(settings, settings.force(REARM_GROUND_ONLY, true, reason));
}
