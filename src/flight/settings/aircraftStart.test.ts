import type { AircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import { createSettingsRegistry, type SettingsRegistry } from "foss-earth/settings";
import { describe, expect, it } from "vitest";
import { BUNDLED_MODS } from "../mods/bundledMods";
import { AIRCRAFT_START_PARAMETER_IDS, applyAircraftStartDefaults, DRONE_START_HEIGHT_METERS } from "./aircraftStart";
import { flightParameterSpec, OSFS_PARAMETERS } from "./flightParameters";

/** Mod aircraft ids are not among the built-in fleet's. */
type StartingAircraft = { id: string } & Pick<AircraftDefinition, "start" | "procedural">;

/** Northrop Mall, where the UMN-VR scene places it. */
const UMN_MALL = { "osfs.start.latitude": 44.97528376, "osfs.start.longitude": -93.2353732 };
const FLIGHT_START = Object.fromEntries(AIRCRAFT_START_PARAMETER_IDS.map(id => [id, flightParameterSpec(id).default]));
const BUNDLED_AIRCRAFT = BUNDLED_MODS.flatMap(([, manifest]) => (manifest.aircraft?.definitions ?? []) as unknown as StartingAircraft[]);

function flightSettings(): SettingsRegistry {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(OSFS_PARAMETERS);
  return settings;
}

const startOf = (settings: SettingsRegistry) => Object.fromEntries(AIRCRAFT_START_PARAMETER_IDS.map(id => [id, settings.get(id)]));

describe("an aircraft's own start", () => {
  it("starts the default modpack's drones low over the UMN mall, and its planes where every flight did", () => {
    const settings = flightSettings();
    expect(BUNDLED_AIRCRAFT.map(aircraft => aircraft.id)).toEqual(expect.arrayContaining(["cessna-172", "dji-mini2", "dji-air2s"]));
    for (const aircraft of BUNDLED_AIRCRAFT) {
      const drone = aircraft.procedural === "drone";
      expect(applyAircraftStartDefaults(settings, aircraft, drone)).toEqual([]);
      if (drone) expect(startOf(settings)).toEqual({ ...UMN_MALL, "osfs.start.heading": 0, "osfs.start.heightAboveGround": 30 });
      else expect(startOf(settings)).toEqual(FLIGHT_START);
    }
  });

  it("starts a drone without a start of its own just above the ground", () => {
    const settings = flightSettings();
    applyAircraftStartDefaults(settings, { id: "dji-mini2" }, true);
    expect(startOf(settings)).toEqual({ ...FLIGHT_START, "osfs.start.heightAboveGround": DRONE_START_HEIGHT_METERS });
  });

  it("leaves the pilot's own start in charge, and gives the next plane the flight's start back", () => {
    const settings = flightSettings();
    const mini2 = BUNDLED_AIRCRAFT.find(aircraft => aircraft.id === "dji-mini2")!;
    applyAircraftStartDefaults(settings, mini2, true);
    expect(settings.inspect("osfs.start.latitude")).toMatchObject({ value: UMN_MALL["osfs.start.latitude"], provenance: "host-default" });
    expect(settings.inspect("osfs.start.latitude").layers.hostDefault?.derivedFrom).toBe("the dji-mini2 start");
    settings.set("osfs.start.heading", 90);
    applyAircraftStartDefaults(settings, mini2, true);
    expect(settings.get("osfs.start.heading")).toBe(90);
    applyAircraftStartDefaults(settings, { id: "cessna-172" }, false);
    expect(startOf(settings)).toEqual({ ...FLIGHT_START, "osfs.start.heading": 90 });
  });

  it("refuses the parts of a start the flight cannot use, which keep the flight's own", () => {
    const settings = flightSettings();
    // A latitude past the pole refuses its place; a heading past north refuses only itself.
    const problems = applyAircraftStartDefaults(settings, { id: "test-drone", start: { latDeg: 95, lonDeg: -93.2353732, headingDeg: 400, heightAboveGroundMeters: 30 } }, true);
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain("osfs.start.latitude");
    expect(problems.join(" ")).toContain("osfs.start.heading");
    expect(startOf(settings)).toEqual({ ...FLIGHT_START, "osfs.start.heightAboveGround": 30 });
    // A manifest is not type-checked: a latitude alone is not filled in from the flight's longitude.
    const halfPlace = { latDeg: 44.97528376 } as AircraftDefinition["start"];
    expect(applyAircraftStartDefaults(settings, { id: "test-drone", start: halfPlace }, false)).toHaveLength(1);
    expect(startOf(settings)).toEqual(FLIGHT_START);
  });
});
