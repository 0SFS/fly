import type { ParameterSpec } from "foss-earth/settings";

const number = <T extends string>(id: T, label: string, value: number, unit: "m" | "s" | "deg" | "none", min: number, max: number) => ({
  id, label, description: "Aircraft-local streaming requirement. This requests map detail without changing aircraft position.",
  kind: "number", unit, default: value, step: unit === "none" ? 1 : 0.1,
  bounds: () => ({ min, max, reason: "Supported aircraft streaming range" }),
  defaultReason: "Initial drone/plane tuning; not a measured collision-safety guarantee.",
  home: { tab: "map", section: "detail", level: "main" },
  appliesLive: true, source: "src/flight/flightRegion.ts",
} as const);

export const FLIGHT_REGION_PARAMETERS = [
  number("osfs.region.drone.radius", "Drone sphere radius", 15, "m", 1, 1000),
  number("osfs.region.drone.radiusCap", "Drone sphere radius limit", 100, "m", 1, 10000),
  number("osfs.region.drone.sizeMultiplier", "Drone body size multiplier", 4, "none", 1, 20),
  number("osfs.region.drone.horizon", "Drone sphere prediction", 1.5, "s", 0, 30),
  number("osfs.region.drone.minimumError", "Drone minimum geometry error", 8, "m", 0.1, 256),
  number("osfs.region.drone.finalError", "Drone final geometry error", 1, "m", 0.1, 256),
  number("osfs.region.drone.minimumZoom", "Drone minimum terrain zoom", 14, "none", 8, 20),
  number("osfs.region.drone.finalZoom", "Drone final terrain zoom", 16, "none", 8, 20),
  number("osfs.region.plane.radius", "Plane sphere radius", 200, "m", 1, 10000),
  number("osfs.region.plane.radiusCap", "Plane sphere radius limit", 1000, "m", 1, 10000),
  number("osfs.region.plane.sizeMultiplier", "Plane body size multiplier", 4, "none", 1, 20),
  number("osfs.region.plane.minimumError", "Plane minimum geometry error", 32, "m", 0.1, 256),
  number("osfs.region.plane.finalError", "Plane final geometry error", 8, "m", 0.1, 256),
  number("osfs.region.plane.minimumZoom", "Plane minimum terrain zoom", 12, "none", 8, 20),
  number("osfs.region.plane.finalZoom", "Plane final terrain zoom", 14, "none", 8, 20),
  number("osfs.region.plane.horizon", "Plane cone prediction", 5, "s", 0, 30),
  number("osfs.region.plane.coneLength", "Plane cone length limit", 10000, "m", 0, 50000),
  number("osfs.region.plane.coneAngle", "Plane cone half-angle", 15, "deg", 1, 60),
  {
    id: "osfs.region.show",
    label: "Show loading region",
    description: "Draws the aircraft's loading region in the world: its sphere and cone in cyan, the ground inside them in red, and an amber box around each map tile it still waits for.",
    unit: "none", kind: "choice",
    choices: [
      { id: "preparing", label: "While preparing", description: "While the loading card waits for map detail around the aircraft." },
      { id: "always", label: "Always", description: "During flight too, following the aircraft." },
      { id: "off", label: "Off" },
    ],
    default: "preparing",
    defaultReason: "Shows why a spawn waits, and goes once the aircraft is flying.",
    home: { tab: "map", section: "detail", level: "main" },
    appliesLive: true, source: "src/flight/flightRegionPreparation.ts",
  },
] as const satisfies readonly ParameterSpec[];
