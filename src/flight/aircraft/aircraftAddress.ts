/** `?aircraft=<id>`, the short form of `?set.osfs.aircraft.id=<id>`, as in `/fly/?aircraft=dji-mini2`. */
export const AIRCRAFT_URL_NAME = "aircraft";

/**
 * Aircraft ids that changed, old to new. Saved settings, saved flights and
 * links from before a rename open the aircraft under its new id.
 */
export const RENAMED_AIRCRAFT_IDS: Readonly<Record<string, string>> = {
  "dji-mini-2": "dji-mini2",
  "dji-air-2s": "dji-air2s",
};

/** The id now in use for an aircraft id that may predate a rename; anything else as it is. */
export function currentAircraftId(id: unknown): unknown {
  return typeof id === "string" && Object.hasOwn(RENAMED_AIRCRAFT_IDS, id) ? RENAMED_AIRCRAFT_IDS[id] : id;
}
