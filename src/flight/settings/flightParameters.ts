import { GOOGLE_ERROR_TARGET_BOUNDS } from "foss-earth/mapDetailPolicy";
import type { ParameterSpec } from "foss-earth/settings";
import { FLIGHT_REGION_PARAMETERS } from "./flightRegionSettings";
import "../aircraft/fleet";
import { AIRCRAFT_FAMILIES } from "@0sfs/aircraft/aircraftCatalog";
import { AIRCRAFT_IDS } from "@0sfs/aircraft/aircraftIds";
import { AIRCRAFT_URL_NAME, RENAMED_AIRCRAFT_IDS } from "../aircraft/aircraftAddress";
import { DEFAULT_ENGINE_GAS_AXIAL_SAMPLES, DEFAULT_ENGINE_GAS_RADIAL_SAMPLES } from "@0sfs/exhaust/engineGasOptics";
import {
  AIRCRAFT_PARAMETERS_1,
  AIRCRAFT_PARAMETERS_2,
  AIRCRAFT_PARAMETERS_3,
  AIRCRAFT_PARAMETERS_4,
  AIRCRAFT_PARAMETERS_5,
  AIRCRAFT_PARAMETERS_6,
  AIRCRAFT_SECTION_TITLES_1,
  AIRCRAFT_SECTION_TITLES_2,
} from "@0sfs/aircraft/settings";
import { SOUND_PARAMETERS, SOUND_SECTION_TITLES_1, SOUND_SECTION_TITLES_2 } from "@0sfs/sound/settings";
import { AUTOPILOT_PARAMETERS, AUTOPILOT_SECTION_TITLES } from "@0sfs/autopilot/settings";
import { ENGINE_PARAMETERS_1, ENGINE_PARAMETERS_2, ENGINE_PARAMETERS_3, ENGINE_SECTION_TITLES } from "@0sfs/engines/settings";
import {
  CONTROLS_PARAMETERS_1,
  CONTROLS_PARAMETERS_2,
  CONTROLS_PARAMETERS_3,
  CONTROLS_SECTION_TITLES_1,
  CONTROLS_SECTION_TITLES_2,
} from "@0sfs/controls/settings";
import { REMOTE_CONTROL_PARAMETERS, REMOTE_CONTROL_SECTION_TITLES } from "@0sfs/rc/settings";
import { GROUND_CONTACT_PARAMETERS } from "@0sfs/ground-contact/settings";
import {
  catalogueDefaults,
  catalogueSpec,
  catalogueStore,
  type CatalogueParameters,
  type CatalogueRegistry,
  type CatalogueStore,
  type CatalogueValues,
} from "@0sfs/engines/parameterCatalogue";

/**
 * Every flight parameter: the values 0sfs adds to FOSS Earth's settings
 * registry, each with its unit, bounds, default and the reason for it. This is
 * the only place a flight default is written; code reads the effective value
 * through the registry. Spec: docs/proposals/flight-settings.md.
 */

const KNOTS = { id: "kt", text: "kt" } as const;
const G_UNIT = { id: "g", text: "g" } as const;

const MAP_DETAIL = { tab: "map", section: "detail" } as const;
const MODEL = { tab: "aircraft", section: "model" } as const;
const MESH_INSPECTOR = { tab: "aircraft", section: "mesh-inspector" } as const;
const INSTRUMENTS = { tab: "renderer", section: "instruments" } as const;
const UI_SCALE = { tab: "interface", section: "scale" } as const;
const HUD = { tab: "interface", section: "hud" } as const;
const EXHAUST = { tab: "exhaust", section: "gas" } as const;
const EXHAUST_SMOKE = { tab: "exhaust", section: "smoke" } as const;
const EXTERNAL_TANKS = { tab: "renderer", section: "external-tanks" } as const;
const RELEASED_STORES = { tab: "renderer", section: "released-stores" } as const;
const REARM = { tab: "fuel", section: "rearm" } as const;
const FORCES = { tab: "debug", section: "forces" } as const;
const CAMERA = { tab: "aircraft", section: "camera" } as const;
const COCKPIT_SCREEN = { tab: "aircraft", section: "cockpit-screen" } as const;
const START = { tab: "aircraft", section: "start" } as const;
const ENGINE_TEST = { tab: "engine", section: "test" } as const;
const ENGINE_SIMULATION = { tab: "engine", section: "simulation" } as const;
const GROUND = { tab: "aircraft", section: "ground" } as const;
const G_INDICATOR = { tab: "gforces", section: "indicator" } as const;
const G_PILOT = { tab: "gforces", section: "pilot" } as const;
const G_VISION = { tab: "gforces", section: "vision" } as const;
const G_PASS_OUT = { tab: "gforces", section: "pass-out" } as const;

/** Section titles for the sections 0sfs adds, by tab and section id. */
export const FLIGHT_SECTION_TITLES: readonly (readonly [tab: string, section: string, title: string])[] = [
  ["renderer", "instruments", "Instruments"],
  ["interface", "scale", "Scale"],
  ["interface", "hud", "Flight instruments"],
  ["exhaust", "gas", "Gas and luminance"],
  ["exhaust", "smoke", "Smoke"],
  ...SOUND_SECTION_TITLES_1,
  ["renderer", "external-tanks", "Released fuel tanks"],
  ["renderer", "released-stores", "Released weapons"],
  ["fuel", "rearm", "Rearm"],
  ["aircraft", "model", "Aircraft"],
  ["aircraft", "mesh-inspector", "Mesh inspector"],
  ["aircraft", "camera", "Camera"],
  ["aircraft", "cockpit-screen", "Cockpit screen"],
  ["aircraft", "start", "Start"],
  ...REMOTE_CONTROL_SECTION_TITLES,
  ...SOUND_SECTION_TITLES_2,
  ...ENGINE_SECTION_TITLES,
  ["engine", "test", "Test stand conditions"],
  ["engine", "simulation", "Simulation"],
  ...CONTROLS_SECTION_TITLES_1,
  ["aircraft", "ground", "Ground handling"],
  ...AIRCRAFT_SECTION_TITLES_1,
  ["gforces", "indicator", "Indicator"],
  ["gforces", "pilot", "Pilot"],
  ["gforces", "vision", "Vision"],
  ["gforces", "pass-out", "Passing out"],
  ...AUTOPILOT_SECTION_TITLES,
  ...CONTROLS_SECTION_TITLES_2,
  ["debug", "frame-budget", "Frame budget"],
  ["debug", "forces", "Forces"],
  ...AIRCRAFT_SECTION_TITLES_2,
];

const FAMILY_VARIANTS = AIRCRAFT_FAMILIES.flatMap(family => family.variants);
const AIRCRAFT_CHOICES = AIRCRAFT_IDS.map(id => ({
  id,
  label: FAMILY_VARIANTS.find(variant => variant.aircraftId === id)?.label ?? id,
}));
const GENERATION_CHOICES = AIRCRAFT_FAMILIES.flatMap(family => family.variants.map(variant => ({
  id: variant.id,
  label: family.variants.length > 1 ? `${family.label} ${variant.label}` : variant.label,
})));
// A drone's aircraft and generation share its id, so one list renames both.
const RENAMED_AIRCRAFT_CHOICES = Object.entries(RENAMED_AIRCRAFT_IDS).map(([value, replacement]) => ({ value, replacement }));

const main = <T extends { tab: string; section: string }>(home: T) => ({ ...home, level: "main" as const });
const all = <T extends { tab: string; section: string }>(home: T) => ({ ...home, level: "all" as const });
const within = (min: number, max: number) => () => ({ min, max });

export const OSFS_PARAMETERS = [
  {
    id: "osfs.aircraft.wireframe", label: "Show polygon edges",
    description: "Draw orange triangle edges over selected parts of the loaded aircraft. Select parts in the mesh tree; deselecting leaves their surfaces visible. Turning this off releases the edge drawing resources.",
    unit: "none", kind: "boolean", default: false,
    defaultReason: "Inspecting model geometry is optional; normal flight needs no extra edge draws.",
    home: main(MESH_INSPECTOR), appliesLive: true, source: "src/flight/createFlightSimApp.ts",
  },
  ...AIRCRAFT_PARAMETERS_1,
  {
    id: "osfs.forces.enabled", label: "Show aircraft forces",
    description: "Draw native force vectors at their observed application points. Off releases the overlay and stops its native reads.",
    unit: "none", kind: "boolean", default: false,
    defaultReason: "Force arrows are an optional flight-model diagnostic.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.newtonsPerMeter", label: "Arrow force scale",
    description: "Force represented by one metre of arrow length. Smaller values magnify forces without changing the simulation.",
    unit: { id: "N/m", text: "N/m" }, kind: "number", step: 100, bounds: within(100, 200000), default: 20000,
    defaultReason: "A 200 kN force is ten metres long; lower this for smaller aircraft.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.maxArrowMeters", label: "Maximum arrow length",
    description: "Caps displayed arrows at this length. Labels retain the actual force and mark capped arrows.",
    unit: "m", kind: "number", step: 1, bounds: within(1, 100), default: 20,
    defaultReason: "Keeps diagnostic arrows near the aircraft when a force spikes.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.labels", label: "Force labels",
    description: "Show each native force's name and magnitude in kilonewtons beside its arrow.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "Names distinguish the lift fan, roll posts and aerodynamic components.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.labelRefreshHz", label: "Force label refresh",
    description: "Maximum label texture updates per simulation second. Arrows still follow the latest accepted native forces each frame.",
    unit: "Hz", kind: "number", step: 1, bounds: within(1, 20), default: 5,
    defaultReason: "Readable numbers with bounded text and texture upload work; paused native time holds their values.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.controlSurfaces", label: "Control surfaces",
    description: "Draw each control surface's own native aerodynamic terms: their force at the aerodynamic reference point, where JSBSim applies them, and their moment as an arc. JSBSim has no surface positions, so nothing is drawn at the surfaces themselves.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "What the pilot's controls are doing is what a forces view is most often opened to see.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.newtonMetersPerDegree", label: "Arc moment scale",
    description: "Moment represented by one degree of arc. Each arc turns about its moment's axis by the right-hand rule. Smaller values magnify moments without changing the simulation.",
    unit: { id: "N·m/deg", text: "N·m/°" }, kind: "number", step: 10, bounds: within(10, 100000), default: 2000,
    defaultReason: "An F-35B elevator moment of 200 kN·m, seen at 300 knots, sweeps 100°; lower this for smaller aircraft.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.arcRadiusMeters", label: "Moment arc radius",
    description: "Radius of every moment arc around the point its moment is taken about.",
    unit: "m", kind: "number", step: 0.5, bounds: within(0.5, 20), default: 3,
    defaultReason: "Clear of the arrows that start at the same reference point and CG.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  {
    id: "osfs.forces.maxArcDegrees", label: "Maximum arc sweep",
    description: "Caps displayed arcs at this sweep. Labels retain the actual moment and mark capped arcs.",
    unit: "deg", kind: "number", step: 5, bounds: within(30, 330), default: 300,
    defaultReason: "Short of a full turn, so the arrowhead's sense stays readable when a moment spikes.",
    home: main(FORCES), appliesLive: true, source: "src/flight/diagnostics/createForcesDebugOverlay.ts",
  },
  // Aircraft: which aircraft flies, and which of its models is drawn.
  {
    id: "osfs.aircraft.id",
    label: "Aircraft",
    description: "The flight model, contact geometry, gauges and visuals that load together.",
    unit: "none",
    kind: "choice",
    choices: AIRCRAFT_CHOICES,
    dynamicChoices: true,
    urlNames: [AIRCRAFT_URL_NAME],
    legacyValues: RENAMED_AIRCRAFT_CHOICES,
    default: "cessna-172",
    defaultReason: "The original default aircraft.",
    home: all(MODEL),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },
  {
    id: "osfs.aircraft.generation",
    label: "Generation",
    description: "Which package of the aircraft's family flies, such as the Vision Jet's G2+.",
    unit: "none",
    kind: "choice",
    choices: GENERATION_CHOICES,
    dynamicChoices: true,
    legacyValues: RENAMED_AIRCRAFT_CHOICES,
    default: "cessna-172",
    defaultReason: "The default aircraft's only generation; another aircraft uses its own first generation.",
    home: all(MODEL),
    appliesLive: true,
    source: "aircraft/src/aircraftCatalog.ts",
  },
  ...AIRCRAFT_PARAMETERS_2,

  ...FLIGHT_REGION_PARAMETERS,
  // Retained for saved settings compatibility. Region profiles replace this hold.
  {
    id: "osfs.flight.minimum",
    label: "Flight minimum",
    description: "The coarsest Google 3D Tiles detail a spawn near the ground accepts; the hold keeps detail at least this fine until departure.",
    unit: "px",
    kind: "number",
    scale: "log2",
    step: 0.05,
    bounds: () => ({ min: GOOGLE_ERROR_TARGET_BOUNDS.finest, max: GOOGLE_ERROR_TARGET_BOUNDS.coarsest, reason: "The range of Google 3D Tiles error targets" }),
    default: 4_096,
    defaultReason: "2^12 px, the value the low-spawn hold has used since it was added; it has not been tuned against a measurement.",
    home: all(MAP_DETAIL),
    appliesLive: true,
    source: "src/flight/worldDetail.ts",
  },
  {
    id: "osfs.flight.holdBelow",
    label: "Hold detail below",
    description: "A spawn closer than this to the sampled surface holds Google 3D Tiles at the Flight minimum until departure.",
    unit: "m",
    kind: "number",
    step: 5,
    bounds: within(0, 2_000),
    default: 100,
    defaultReason: "The value the low-spawn hold has used since it was added; it has not been tuned against a measurement.",
    home: all(MAP_DETAIL),
    appliesLive: true,
    source: "src/flight/worldDetail.ts",
  },
  {
    id: "osfs.flight.holdReleaseAfter",
    label: "Release the hold after",
    description: "How long the aircraft must fly above the hold height before the hold ends, in simulated seconds.",
    unit: "s",
    kind: "number",
    step: 0.25,
    bounds: within(0, 60),
    default: 1,
    defaultReason: "The original value: one simulated second clear of the hold height counts as a departure.",
    home: all(MAP_DETAIL),
    appliesLive: true,
    source: "src/flight/worldDetail.ts",
  },
  {
    id: "osfs.flight.allowCoarserThisSession",
    label: "Allow coarser terrain for this session",
    description: "Suspends the Flight minimum: a spawn may start below it, and a held requirement ends. Resets when the game reloads.",
    unit: "none",
    kind: "boolean",
    default: false,
    defaultReason: "The Flight minimum is a safety requirement; waiving it is a deliberate, temporary choice.",
    home: all(MAP_DETAIL),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
    session: true,
  },

  {
    id: "osfs.externalTanks.debrisLifetimeSeconds",
    label: "Released tank lifetime",
    description: "How long a jettisoned fuel tank remains visible, in simulated seconds. Zero hides it as soon as it is released.",
    unit: "s", kind: "number", step: 0.1, bounds: within(0, 120), default: 15,
    defaultReason: "Fifteen seconds shows the separation while bounding the time spent updating falling tanks.",
    home: main(EXTERNAL_TANKS), appliesLive: true, source: "fuel/src/createExternalTankVisuals.ts",
  },
  {
    id: "osfs.externalTanks.maxDetachedTanks",
    label: "Released tank limit",
    description: "Maximum released fuel tanks kept visible at once. Zero hides released tanks; installed tanks still appear on the aircraft.",
    unit: { id: "tanks", text: "tanks" }, kind: "number", step: 1, bounds: within(0, 2), default: 2,
    defaultReason: "One released tank per station shows both separations and bounds retained geometry and update work.",
    home: main(EXTERNAL_TANKS), appliesLive: true, source: "fuel/src/createExternalTankVisuals.ts",
  },
  {
    id: "osfs.stores.debrisLifetimeSeconds",
    label: "Released weapon lifetime",
    description: "How long a jettisoned weapon or pod remains visible, in simulated seconds. Zero hides it as soon as it is released.",
    unit: "s", kind: "number", step: 0.1, bounds: within(0, 120), default: 15,
    defaultReason: "The released tank lifetime: it shows the separation while bounding the time spent updating falling stores.",
    home: main(RELEASED_STORES), appliesLive: true, source: "stores/src/createStoreVisuals.ts",
  },
  {
    id: "osfs.stores.maxDetachedStores",
    label: "Released weapon limit",
    description: "Maximum jettisoned weapons and pods kept visible at once, at most one per station. Zero hides them; hung stores still appear on the aircraft.",
    unit: { id: "stores", text: "stores" }, kind: "number", step: 1, bounds: within(0, 11), default: 2,
    defaultReason: "The released tank limit: it shows a pair separating and bounds retained geometry and update work.",
    home: main(RELEASED_STORES), appliesLive: true, source: "stores/src/createStoreVisuals.ts",
  },
  {
    id: "osfs.rearm.groundOnly",
    label: "Rearm on the ground only",
    description: "Weapon load changes, fuel quantity edits and tank respawn wait for weight on the wheels. Off, they work in the air. Jettison and the bay doors always work.",
    unit: "none", kind: "boolean", default: false,
    defaultReason: "Single-player flight changes the load in the air; a session that requires the ground sets it.",
    home: main(REARM), appliesLive: true, source: "src/flight/settings/rearmRule.ts",
  },

  // Aircraft → Lights: navigation, anti-collision, landing and taxi lights.
  ...AIRCRAFT_PARAMETERS_3,

  // G-forces: the load on the pilot, and what it does to their sight.
  {
    id: "osfs.gForce.indicator",
    label: "G indicator",
    description: "Show the load at the pilot's seat in the instrument row, in g: 1 in level flight, more in a pull, negative in a push. It is read at the aircraft's eyepoint, where the pilot sits, not at the centre of gravity. Click it to show or hide this tab.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "The load is what the wings and the pilot are being asked to bear, and nothing else on the HUD shows it.",
    home: main(G_INDICATOR), appliesLive: true, source: "g-forces/src/gMeter.ts",
  },
  // "Response [Curve / Exposure / Perfusion] ?". The model is the flight's:
  // the three keep different states, so a change waits for the next flight.
  {
    id: "osfs.gForce.response",
    label: "Response",
    description: "How the pilot's sight and consciousness follow the load. Curve follows the load alone, after a lag; Exposure and Perfusion also remember the loads before it, so a pull soon after another costs more, and they set when a pilot who passes out comes to. A change applies to the next flight (New flight, Apply & reload or a change of aircraft), never mid-flight. The fit and the comparison: g-forces/docs/g-response-comparison.md.",
    unit: "none", kind: "choice",
    choices: [
      { id: "curve", label: "Curve", description: "The vignettes follow the load between the blackout and redout ranges, over the onset and recovery times below; a pilot who passes out stays out for a time drawn around the mean. Not fitted: 3.6 standard deviations from the held-out measurements, and no pilot passes out below the top of the blackout range." },
      { id: "exposure", label: "Exposure", description: "Two buffers, the eyes' and the brain's, that a load drains and rest refills: sight goes first, consciousness after, and a pilot comes to only once the brain's has refilled and the load is off. Fitted to published onset, recovery and threshold measurements: 0.5 standard deviations from those held out. About twice Curve's work a step." },
      { id: "perfusion", label: "Perfusion", description: "Blood pressure at the eyes and the brain: the heart's pressure less the column of blood the load pulls down, with the heart and vessel reflexes, the suit and straining; sight and consciousness fade as the tissue's reserve runs out. Fitted to the same measurements, and as close to those held out as Exposure, for about three times Curve's work a step." },
    ],
    default: "curve",
    defaultReason: "Curve keeps every flight as it was, with the settings people already tuned. Exposure fits the measurements far better at a cost that does not matter, and is the proposed default; it waits for that choice to be made.",
    home: main(G_PILOT), appliesLive: false, source: "src/flight/createFlightPilot.ts",
  },
  {
    id: "osfs.gForce.exposure.pilot",
    label: "Pilot",
    description: "What protects the pilot from a pull. The suit squeezes the legs and belly so less blood pools there; straining is the tensing and breathing a fighter pilot does through a pull. Edits keep what the pilot has already used up.",
    unit: "none", kind: "choice",
    choices: [
      { id: "relaxed", label: "Relaxed", description: "No suit, no straining: sight starts to go at 4.2 g held for 15 s, and consciousness at 5.4 g." },
      { id: "suit", label: "G-suit", shortLabel: "Suit", description: "A suit worth about 2.9 g: sight starts to go at 7.1 g held for 15 s, and consciousness at 8.3 g." },
      { id: "suit-strain", label: "G-suit and straining", shortLabel: "Suit + strain", description: "Sight starts to go at 9 g held for 15 s, and consciousness at 10.2 g. Straining is measured only up to 9 g and never tires here, so loads beyond that are a guess." },
    ],
    default: "suit-strain",
    defaultReason: "The pilot of a fighter that can pull 9 g wears a suit and strains; Curve's default ranges stand for the same pilot.",
    home: main(G_PILOT), appliesLive: true, source: "g-forces/src/exposureResponse.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "exposure" },
  },
  {
    id: "osfs.gForce.perfusion.pilot",
    label: "Pilot",
    description: "What protects the pilot from a pull. The suit squeezes the legs and belly so less blood pools there; straining is the tensing and breathing a fighter pilot does through a pull. Edits keep the pilot's pressures and reserves.",
    unit: "none", kind: "choice",
    choices: [
      { id: "relaxed", label: "Relaxed", description: "No suit, no straining: sight starts to go at 4.1 g held for 15 s, and consciousness at 5.3 g." },
      { id: "suit", label: "G-suit", shortLabel: "Suit", description: "Sight starts to go at 7.0 g held for 15 s, and consciousness at 8.2 g, before sight has gone completely." },
      { id: "suit-strain", label: "G-suit and straining", shortLabel: "Suit + strain", description: "Sight starts to go at 9 g held for 15 s, and consciousness at 9.3 g. Straining is measured only up to 9 g and never tires here, so loads beyond that are a guess." },
    ],
    default: "suit-strain",
    defaultReason: "The pilot of a fighter that can pull 9 g wears a suit and strains; Curve's default ranges stand for the same pilot.",
    home: main(G_PILOT), appliesLive: true, source: "g-forces/src/perfusionResponse.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "perfusion" },
  },
  {
    id: "osfs.gForce.vision",
    label: "Dim vision under load",
    description: "Close a black vignette over the view while a positive load stays on, and a red one under a negative load. Off draws nothing; a pilot who passes out still sees black.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "A load the aircraft can hold and the pilot cannot is otherwise only a number.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gVisionOverlay.ts",
  },
  {
    id: "osfs.gForce.blackoutRange",
    label: "Blackout",
    description: "The loads between which sight is lost to a pull, in the Curve response: the black vignette starts at the lower one and covers the view at the higher, once the load has stayed on for the onset time.",
    unit: G_UNIT, kind: "range", step: 0.1, bounds: within(1.5, 15), default: { min: 5, max: 9 },
    defaultReason: "Chosen, not measured: it spreads the vignette over the loads a fighter holds, for a pilot in a G-suit who is straining. A relaxed pilot without one loses sight at lower loads; lower both ends to fly as one.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gForce.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "curve" },
  },
  {
    id: "osfs.gForce.redoutRange",
    label: "Redout",
    description: "The negative loads between which sight is lost to a push: the red vignette starts at the one nearer zero and covers the view at the other. Every response uses it: none is fitted to a push.",
    unit: G_UNIT, kind: "range", step: 0.1, bounds: within(-10, -0.5), default: { min: -3, max: -2 },
    defaultReason: "Chosen, not measured: people bear far less negative load than positive, and no G-suit helps with it.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gForce.ts",
  },
  {
    id: "osfs.gForce.onsetTime",
    label: "Onset time",
    description: "How long sight takes to follow a load that stays on, to within 5% of where it settles, in simulated seconds. Zero follows the load at once.",
    unit: "s", kind: "number", step: 0.1, bounds: within(0, 20), default: 5,
    defaultReason: "Chosen, not measured: the eyes keep working for a few seconds after their blood supply falls, so a brief pull costs nothing and a touchdown's jolt is not seen.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gForce.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "curve" },
  },
  {
    id: "osfs.gForce.recoveryTime",
    label: "Recovery time",
    description: "How long sight takes to come back once the load is off, to within 5%, in simulated seconds. Zero clears it at once.",
    unit: "s", kind: "number", step: 0.1, bounds: within(0, 20), default: 2,
    defaultReason: "Chosen, not measured: sight returns faster than it goes once the load is off.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gForce.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "curve" },
  },
  {
    id: "osfs.gForce.visionStrength",
    label: "Vignette strength",
    description: "How far a vignette may close: at 100% the whole view goes black or red, and at 50% it stops half way, with the middle of the view left clear.",
    unit: "fraction", kind: "number", step: 0.05, bounds: within(0, 1), default: 1,
    defaultReason: "Sight lost to a load is lost entirely.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gVisionOverlay.ts",
  },
  {
    id: "osfs.gForce.visionViews",
    label: "Dim vision in",
    description: "Which camera views the vignettes are drawn over. The load is the pilot's in both; the chase view only shows it.",
    unit: "none", kind: "choice",
    choices: [
      { id: "all", label: "Every view", description: "The cockpit and the chase view alike." },
      { id: "cockpit", label: "Cockpit only", description: "The chase view stays clear, as a camera outside the aircraft would see it." },
    ],
    default: "all",
    defaultReason: "A flight starts in the chase view, where the vignette is the only sign of what the pilot can bear.",
    home: main(G_VISION), appliesLive: true, source: "src/flight/createFlightSimApp.ts",
  },
  {
    id: "osfs.gForce.visionLayer",
    label: "Vignette covers",
    description: "What the vignettes are drawn over: everything on the screen, or the 3D view alone, with the instruments, panels and toolbar left readable above it. A dialog that asks a question stays above it either way.",
    unit: "none", kind: "choice",
    choices: [
      { id: "everything", label: "Everything", description: "The 3D view, the instruments, the panels and the toolbar." },
      { id: "view", label: "3D view only", description: "The instruments, panels and toolbar stay clear." },
    ],
    default: "everything",
    defaultReason: "A pilot whose sight has gone has lost the instruments with it.",
    home: main(G_VISION), appliesLive: true, source: "g-forces/src/gVisionOverlay.ts",
  },
  {
    id: "osfs.gForce.passOut",
    label: "Pass out",
    description: "Lose consciousness when the response says so: the screen goes black and the pilot lets go of the stick, pedals and brakes until they come to. The throttle, trim and flaps stay where they were, and an engaged autopilot flies on. Curve passes out when the black vignette closes completely, for a time drawn at random around the mean time out; Exposure and Perfusion pass out when the brain's reserve runs out and come to once it has refilled with the load off. Off, the pilot keeps the controls whatever the response says.",
    unit: "none", kind: "boolean", default: false,
    defaultReason: "Opt in: it takes the aircraft out of the person's hands.",
    home: main(G_PASS_OUT), appliesLive: true, source: "g-forces/src/gForce.ts",
  },
  {
    id: "osfs.gForce.unconsciousTime",
    label: "Mean time out",
    description: "The average time the pilot stays unconscious, in simulated seconds. Each time is drawn from a bell curve around it, never below zero.",
    unit: "s", kind: "number", step: 0.1, bounds: within(1, 120), default: 11.9,
    defaultReason: "Measured: 11.9 s of unconsciousness on average over 501 losses of consciousness on a centrifuge (Whinnery and Whinnery, Arch Neurol 1990;47:764–76). A further 16 s of confusion followed, which is not modelled; add it to fly that long without the pilot.",
    home: main(G_PASS_OUT), appliesLive: true, source: "g-forces/src/gForce.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "curve" },
  },
  {
    id: "osfs.gForce.unconsciousSpread",
    label: "Time out spread",
    description: "The standard deviation of the time out, in seconds: about two times in three fall within this much of the mean. Zero makes every time the mean.",
    unit: "s", kind: "number", step: 0.1, bounds: within(0, 60), default: 4,
    defaultReason: "Chosen, not measured: the study's spread was not read. Four seconds keeps most times between 4 and 20 s.",
    home: main(G_PASS_OUT), appliesLive: true, source: "g-forces/src/gForce.ts",
    visibleWhen: { id: "osfs.gForce.response", value: "curve" },
  },

  // Exhaust → Gas and luminance. Shared across engines with an optical profile.
  {
    id: "osfs.exhaust.enabled",
    label: "Aircraft exhaust",
    description: "Draw hot exhaust and afterburner on aircraft with an exhaust profile. Turning this off releases its rendering resources.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "Show the configured engine's visual state alongside its moving nozzle.",
    home: main(EXHAUST),
    appliesLive: true,
    source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.contributionView",
    label: "Engine light contribution",
    description: "Isolate a contribution on the engine for diagnosis. Thermal and fuel states continue unchanged. Scene exposure is in Sky → Exposure and display, and the sky model and ambient fill in Sky → Atmosphere and illumination.",
    unit: "none", kind: "choice",
    choices: [
      { id: "combined", label: "Combined", description: "All enabled engine light contributions." },
      { id: "solid", label: "Solid emission", description: "Material self-emission with its direct/environment reflection suppressed; gas and nearby light off." },
      { id: "gas", label: "Gas emission", description: "Only gas/particle emission; hot hardware emission/reflection and nearby light off." },
      { id: "reflection", label: "Reflected light", description: "Engine material reflection from the existing scene; gas, self-emission and the exhaust scene light off." },
      { id: "scene-light", label: "Nearby scene light", description: "The exhaust light on other lit scene surfaces; gas and self-emission off. The emitting engine is excluded from this light." },
    ],
    default: "combined",
    defaultReason: "Show normal combined appearance; individual contributions make thermal color and reflected light distinguishable.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.sampleCount",
    label: "Exhaust samples",
    description: "Samples through each visible exhaust pixel. Localized emission needs more samples; lower counts can miss narrow regions and alter apparent color. More samples use more GPU time.",
    unit: { id: "samples/pixel", text: "samples/pixel" },
    kind: "number",
    step: 1, bounds: within(4, 128),
    default: 32,
    defaultReason: "Bound the default pixel work at 32 steps; 128 remains available for detailed inspection. The retained posed-ray comparison found up to 18.51% error at 32 versus 0.761% at 128, and GPU cost remains unqualified.",
    home: main(EXHAUST),
    appliesLive: true,
    source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.depthOcclusionEnabled",
    label: "Exhaust opaque occlusion",
    description: "Render an opaque-depth pass to stop gas integration at hardware and scenery. Disabling saves the pass but can show light from behind an opaque surface.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "Interior gas must stop at the visible metal surface rather than accumulating light behind it.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/engineExhaustDepth.ts",
  },
  {
    id: "osfs.exhaust.depthResolutionScale",
    label: "Exhaust depth resolution",
    description: "Width and height of the exhaust depth buffer relative to the viewport. Smaller buffers use fewer pixels and less memory, but can misplace thin hardware edges.",
    unit: "ratio", kind: "number", step: 0.01, bounds: within(0.25, 1), default: 1,
    defaultReason: "One depth texel per viewport pixel preserves hardware boundaries. This adds one depth pass; GPU cost is unqualified.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/engineExhaustDepth.ts",
  },
  {
    id: "osfs.exhaust.axialFieldSamples",
    label: "Exhaust axial field samples",
    description: "Source-table samples along the plume. More samples resolve localized emission and increase CPU updates and texture memory; ray samples control separate pixel work.",
    unit: { id: "samples/axis", text: "samples/axis" }, kind: "number", step: 1, bounds: within(8, 64), default: DEFAULT_ENGINE_GAS_AXIAL_SAMPLES,
    defaultReason: "Retain 64 axial samples across the combined internal/external field; 64 × 32 RGBA32F samples use 32 KiB per engine. Current checks cover selected rays, not every view or GPU performance.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.radialFieldSamples",
    label: "Exhaust radial field samples",
    description: "Source-table samples from plume axis to edge. More samples resolve the annulus and mixing layer, increasing CPU updates and texture memory.",
    unit: { id: "samples/axis", text: "samples/axis" }, kind: "number", step: 1, bounds: within(8, 64), default: DEFAULT_ENGINE_GAS_RADIAL_SAMPLES,
    defaultReason: "Thirty-two radial samples resolve the narrow annulus more closely; axial × radial × 16 bytes gives the texture allocation per engine.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.maxDistanceMeters",
    label: "Exhaust draw distance",
    description: "Stop drawing exhaust farther than this distance from the viewing camera.",
    unit: "m",
    kind: "number",
    step: 1, bounds: within(1, 20000),
    default: 2000,
    defaultReason: "Avoid shading a tiny plume at long range while retaining exterior chase and flyby views.",
    home: main(EXHAUST),
    appliesLive: true,
    source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.intensity",
    label: "Exhaust display gain",
    description: "Display gain after physical gas emission has been evaluated. This changes neither emitted physical power nor engine temperature, fuel or afterburner engagement.",
    unit: "ratio",
    kind: "number",
    step: 0.01, bounds: within(0, 8),
    default: 1,
    defaultReason: "Use the profile's reference display brightness; the F135 profile is not radiometrically calibrated.",
    home: main(EXHAUST),
    appliesLive: true,
    source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.gasReferenceNits",
    label: "Gas emission white reference",
    description: "With the sky model off, the gas luminance mapped to unit linear scene intensity before exposure compensation. The physical emission calculation retains absolute units; this reference changes only display mapping. A sky model's exposure takes its place, so gas, metal, sunlight and sky share one white.",
    unit: { id: "cd/m²", text: "cd/m²" }, kind: "number", step: 1, bounds: within(1, 100000), default: 1000,
    defaultReason: "Use the same provisional luminance reference as hot hardware; the scene is not radiometrically calibrated.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.dryIntensity",
    label: "Dry exhaust brightness",
    description: "Display multiplier on luminous gas and its nearby light with afterburner off. One preserves the current physical model's output, whose F135 temperature and particle loading remain uncalibrated. Metal glow and afterburner emission are unchanged.",
    unit: "ratio", kind: "number", step: 0.01, bounds: within(0.5, 10), default: 1,
    defaultReason: "Preserve the current model prediction without changing temperature, fuel, spectrum or physical emitted power.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.surfaceReferenceNits",
    label: "Nozzle glow white reference",
    description: "With the sky model off, the metal luminance mapped to display white. Lower values brighten hot hardware without changing its temperature or the flame. A sky model's exposure takes its place, so gas, metal, sunlight and sky share one white.",
    unit: { id: "cd/m²", text: "cd/m²" },
    kind: "number",
    step: 1, bounds: within(1, 100000),
    default: 1000,
    defaultReason: "A provisional display reference for visible thermal emission; tune to the scene lighting, not engine temperature.",
    home: main(EXHAUST),
    appliesLive: true,
    source: "exhaust/src/createEngineHotSurfaceGlow.ts",
  },
  {
    id: "osfs.exhaust.light.enabled",
    label: "Exhaust scene light",
    description: "One unshadowed light per visible engine represents its bounded gas-emission power on other lit scene surfaces. It cannot illuminate the emitting engine itself.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "Retained night footage shows scene illumination. One isotropic approximation uses the evaluated optical power; geometry, occlusion and engine coefficients remain uncalibrated.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.light.gain",
    label: "Exhaust light display gain",
    description: "Gain on the isotropic candela estimate derived from the bounded optical source. This adjusts scene presentation, not physical emitted power or thermal state.",
    unit: "ratio", kind: "number", step: .01, bounds: within(0, 8), default: 1,
    defaultReason: "Use the evaluated optical source with unit gain; no independent arbitrary candela reference.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.light.rangeMeters",
    label: "Exhaust light range",
    description: "Maximum scene-light range from each visible engine. Larger ranges involve more nearby surfaces in lighting work.",
    unit: "m", kind: "number", step: 0.1, bounds: within(0, 100), default: 12,
    defaultReason: "Keep the provisional interaction near the aircraft and deck; this is a rendering limit rather than a physical radiation cutoff.",
    home: main(EXHAUST), appliesLive: true, source: "exhaust/src/createEngineExhaust.ts",
  },
  {
    id: "osfs.exhaust.smoke.enabled",
    label: "Exhaust smoke",
    description: "Draws sparse smoke sprites for engines with a smoke profile; off releases the particle resources.",
    unit: "none", kind: "boolean", default: true,
    defaultReason: "A faint short trail complements the nozzle glow; appearance is an approximation, not a soot-emissions measurement.",
    home: main(EXHAUST_SMOKE), appliesLive: true, source: "exhaust/src/createEngineSmoke.ts",
  },
  {
    id: "osfs.exhaust.smoke.maxParticles",
    label: "Smoke particle budget",
    description: "Maximum live smoke sprites per configured engine. This bounds geometry, history memory and particle update work.",
    unit: { id: "particles/engine", text: "particles/engine" }, kind: "number", step: 1,
    bounds: within(0, 512), default: 64,
    defaultReason: "A small fixed pool leaves room for short trails without an unbounded particle history.",
    home: main(EXHAUST_SMOKE), appliesLive: true, source: "exhaust/src/createEngineSmoke.ts",
  },
  {
    id: "osfs.exhaust.smoke.emissionPerSecond",
    label: "Smoke emission",
    description: "Maximum emitted smoke sprites each simulated second per running configured engine.",
    unit: "per-s", kind: "number", step: 0.1, bounds: within(0, 128), default: 8,
    defaultReason: "Sparse emission keeps translucent overlap small at the default short lifetime.",
    home: main(EXHAUST_SMOKE), appliesLive: true, source: "exhaust/src/createEngineSmoke.ts",
  },
  {
    id: "osfs.exhaust.smoke.lifetimeSeconds",
    label: "Smoke lifetime",
    description: "How long a smoke sprite remains in the world before returning to the fixed pool, in simulated seconds.",
    unit: "s", kind: "number", step: 0.1, bounds: within(0.1, 10), default: 2,
    defaultReason: "A short trail limits translucent screen coverage and keeps the main exhaust readable.",
    home: main(EXHAUST_SMOKE), appliesLive: true, source: "exhaust/src/createEngineSmoke.ts",
  },
  {
    id: "osfs.exhaust.smoke.maxDistanceMeters",
    label: "Smoke draw distance",
    description: "Maximum camera distance at which engine smoke is emitted and drawn, in metres.",
    unit: "m", kind: "number", step: 1, bounds: within(1, 20_000), default: 1_000,
    defaultReason: "The sparse default smoke is intended for nearby aircraft views.",
    home: main(EXHAUST_SMOKE), appliesLive: true, source: "exhaust/src/createEngineSmoke.ts",
  },
  {
    id: "osfs.exhaust.smoke.opacity",
    label: "Smoke opacity",
    description: "Peak per-sprite opacity before the engine profile and lifetime fade. Higher values make overlapping sprites more apparent.",
    unit: "ratio", kind: "number", step: 0.001, bounds: within(0, 1), default: 0.025,
    defaultReason: "Modern jet exhaust is not a dense rocket smoke trail; this is a restrained visual approximation.",
    home: main(EXHAUST_SMOKE), appliesLive: true, source: "exhaust/src/createEngineSmoke.ts",
  },

  // Interface → Scale: the size of everything drawn over the view.
  {
    id: "osfs.ui.scale",
    label: "UI scale",
    description: "The size of the flight's interface: the instruments, controls, toolbar, menus and panels drawn over the view. The view itself keeps its full size and resolution.",
    unit: "ratio",
    kind: "number",
    step: 0.05,
    bounds: within(0.5, 1.5),
    default: 0.8,
    defaultReason: "At its drawn size the interface covers much of a landscape phone's view; at 0.8× more of the world shows and the text stays readable.",
    home: main(UI_SCALE),
    appliesLive: true,
    source: "src/styles/flight.css",
  },

  // Interface → Flight instruments: where the instruments sit.
  {
    id: "osfs.hud.layout",
    label: "Layout",
    description: "Compact: the instruments sit flush in the two bottom corners on see-through backgrounds. Airspeed, vertical speed and angle of attack sit on the attitude indicator's corners and heading over its horizon; the load, gear and autopilot sit at the toolbar's right end; and the position splits into latitude and longitude, altitude, heading and pitch chips. Classic: the row of instruments above the attitude indicator and the one position readout.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "compact", label: "Compact", description: "Flush in the bottom corners and see-through, with the readings on the attitude indicator and the toolbar." },
      { id: "classic", label: "Classic", description: "The row of instruments above the attitude indicator, on solid backgrounds." },
    ],
    default: "compact",
    defaultReason: "Leaves the most of the view to the world, with every reading still beside the attitude indicator or in the toolbar.",
    home: main(HUD),
    appliesLive: true,
    source: "src/flight/hud/flightHud.ts",
  },

  {
    id: "osfs.hud.planeAttitudeSide",
    label: "Plane attitude side",
    description: "Which side holds the plane's attitude indicator and pitch/roll stick. The engine widget moves to the opposite side.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "left", label: "Left", description: "Attitude and pitch/roll on the left; engines on the right." },
      { id: "right", label: "Right", description: "Attitude and pitch/roll on the right; engines on the left." },
    ],
    default: "left",
    defaultReason: "Preserves the plane's existing control layout.",
    home: main(HUD),
    appliesLive: true,
    source: "src/flight/hud/flightHud.ts",
  },
  {
    id: "osfs.hud.droneAttitudeSide",
    label: "Drone attitude side",
    description: "Which side holds the drone's attitude indicator and pitch/roll stick. The climb/yaw motor widget moves to the opposite side.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "left", label: "Left", description: "Attitude and pitch/roll on the left; climb/yaw on the right." },
      { id: "right", label: "Right", description: "Attitude and pitch/roll on the right; climb/yaw on the left." },
    ],
    default: "right",
    defaultReason: "DJI Mode 2 places climb/yaw on the left and pitch/roll on the right.",
    home: main(HUD),
    appliesLive: true,
    source: "src/flight/hud/flightHud.ts",
  },

  // Renderer → Instruments.
  {
    id: "osfs.renderer.attitudeIndicator",
    label: "Attitude indicator",
    description: "Which API draws the attitude indicator.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "auto", label: "Auto", description: "The GPU when the globe runs on WebGPU, Canvas 2D otherwise." },
      { id: "webgpu", label: "WebGPU", description: "On the globe's GPU device." },
      { id: "canvas2d", label: "Canvas 2D", description: "The browser rasterises its lines and text every frame, which costs more." },
    ],
    default: "auto",
    defaultReason: "Uses the GPU whenever the globe already has a WebGPU device to share.",
    home: main(INSTRUMENTS),
    appliesLive: true,
    source: "src/flight/hud/attitudeRenderer.ts",
  },
  {
    id: "osfs.renderer.attitudeView",
    label: "Attitude indicator view",
    description: "Where the attitude indicator looks from. Camera: the ball turns with the 3D view as the camera orbits, and the aircraft symbol moves to where the nose points and turns as the wings lie. Aircraft: the nose stays at the centre and the wings level, as on a cockpit instrument. The stick it also is moves the aircraft the same way in both.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "camera", label: "Camera", description: "The ball turns with the 3D view; the aircraft symbol shows the nose and the wings against it." },
      { id: "aircraft", label: "Aircraft", description: "The nose at the centre and the wings level, as the instrument always drew." },
    ],
    default: "camera",
    defaultReason: "The ball then agrees with the view on screen, so the aircraft symbol reads against what the pilot sees.",
    home: main(INSTRUMENTS),
    appliesLive: true,
    source: "src/flight/hud/attitudeIndicator.ts",
  },

  ...ENGINE_PARAMETERS_1,

  // Aircraft → Camera.
  ...AIRCRAFT_PARAMETERS_4,
  {
    id: "osfs.camera.orbitReturnTime",
    label: "Orbit return time",
    description: "With Return behind aircraft on release, the time constant of the camera's return to its resting place.",
    unit: "s",
    kind: "number",
    step: 0.05,
    bounds: within(0.05, 5),
    default: 0.45,
    defaultReason: "The original value: about 95% of the way back in 1.35 s.",
    home: all(CAMERA),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },
  {
    id: "osfs.camera.orbitRestoreYaw",
    label: "Resting orbit heading",
    description: "Where the chase camera returns to, measured from straight behind the aircraft; positive is to the right.",
    unit: "deg",
    kind: "number",
    step: 1,
    bounds: within(-180, 180),
    default: 0,
    defaultReason: "Straight behind, where the chase camera starts.",
    home: all(CAMERA),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },
  ...AIRCRAFT_PARAMETERS_5,
  {
    id: "osfs.camera.gamepadOrbitYawRate",
    label: "Gamepad orbit yaw rate",
    description: "How fast a fully deflected camera stick turns the chase camera around the aircraft.",
    unit: "deg/s",
    kind: "number",
    step: 1,
    bounds: within(10, 720),
    default: 1.5 * 180 / Math.PI,
    defaultReason: "The original 1.5 rad/s: a full turn in about four seconds.",
    home: all(CAMERA),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },
  {
    id: "osfs.camera.gamepadOrbitPitchRate",
    label: "Gamepad orbit pitch rate",
    description: "How fast a fully deflected camera stick moves the chase camera above or below the aircraft.",
    unit: "deg/s",
    kind: "number",
    step: 1,
    bounds: within(10, 720),
    default: 1.15 * 180 / Math.PI,
    defaultReason: "The original 1.15 rad/s.",
    home: all(CAMERA),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },

  // Aircraft → Cockpit screen.
  {
    id: "osfs.cockpit.screen.content",
    label: "Screen shows",
    description: "What the cockpit's touchscreen shows.",
    unit: "none", kind: "choice",
    choices: [
      { id: "flight", label: "Flight interface", description: "The instruments, toolbar and windows as the chase view shows them, and they can be pressed there." },
      { id: "aircraft", label: "Aircraft displays", description: "The model's own picture, a stand-in for the aircraft's real displays until they are made." },
    ],
    default: "flight",
    defaultReason: "The aircraft's real displays are not made yet, and the picture standing in for them shows nothing of the flight.",
    home: main(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },
  {
    id: "osfs.cockpit.screen.background",
    label: "Background",
    description: "What the screen shows behind the interface.",
    unit: "none", kind: "choice",
    choices: [
      { id: "black", label: "Black", description: "Nothing: it costs nothing." },
      { id: "chase", label: "Chase view", description: "The chase camera's view, as the chase view shows it. The world is drawn a second time for it, at the screen's refresh rate." },
    ],
    default: "black",
    defaultReason: "The chase view behind the interface draws the world a second time, which only the fastest computers have the time for: they have it by default (src/flight/cockpit/cockpitScreenDefaults.ts).",
    visibleWhen: { id: "osfs.cockpit.screen.content", value: "flight" },
    home: main(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },
  {
    id: "osfs.cockpit.screen.instruments",
    label: "Instruments",
    description: "Whether the attitude, speed, trim and throttle instruments are drawn on the screen, or left to the HUD: over the view, or around the head in a headset.",
    unit: "none", kind: "choice",
    choices: [
      { id: "screen", label: "Screen", description: "On the screen, and in the HUD over the view. In a headset, only on the screen." },
      { id: "hud", label: "HUD", description: "Only in the HUD over the view. In a headset, on panels around the head." },
    ],
    default: "screen", defaultReason: "Everything is on the screen until a part is moved off it.",
    visibleWhen: { id: "osfs.cockpit.screen.content", value: "flight" },
    home: main(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },
  {
    id: "osfs.cockpit.screen.toolbar",
    label: "Toolbar",
    description: "Whether the toolbar along the bottom is drawn on the screen, or left to the HUD: over the view, or around the head in a headset.",
    unit: "none", kind: "choice",
    choices: [
      { id: "screen", label: "Screen", description: "On the screen, and in the HUD over the view. In a headset, only on the screen." },
      { id: "hud", label: "HUD", description: "Only in the HUD over the view. In a headset, on panels around the head." },
    ],
    default: "screen", defaultReason: "Everything is on the screen until a part is moved off it.",
    visibleWhen: { id: "osfs.cockpit.screen.content", value: "flight" },
    home: main(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },
  {
    id: "osfs.cockpit.screen.windows",
    label: "Windows",
    description: "Whether the tab windows and their buttons are drawn on the screen, or left to the HUD: over the view, or around the head in a headset.",
    unit: "none", kind: "choice",
    choices: [
      { id: "screen", label: "Screen", description: "On the screen, and in the HUD over the view. In a headset, only on the screen." },
      { id: "hud", label: "HUD", description: "Only in the HUD over the view. In a headset, on panels around the head." },
    ],
    default: "screen", defaultReason: "Everything is on the screen until a part is moved off it.",
    visibleWhen: { id: "osfs.cockpit.screen.content", value: "flight" },
    home: main(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },
  {
    id: "osfs.cockpit.screen.refreshRate",
    label: "Screen refresh rate",
    description: "How often the screen is drawn again: the interface when it has changed, its instruments' own drawings, and the chase view behind them.",
    unit: "Hz", kind: "number", step: 1, bounds: within(1, 60), alwaysShowTrack: true,
    default: 30, defaultReason: "Half a 60 Hz display's rate: the instruments move smoothly, and a chase view behind them costs half a view more.",
    visibleWhen: { id: "osfs.cockpit.screen.content", value: "flight" },
    home: all(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },
  {
    id: "osfs.cockpit.screen.resolution",
    label: "Screen resolution",
    description: "The screen's width in pixels; its height follows its shape. More is sharper up close, and costs more to draw and to send to the GPU each time it is drawn.",
    unit: "px", kind: "number", step: 64, bounds: within(256, 2560), alwaysShowTrack: true,
    default: 1280, defaultReason: "Sharp at the pilot's seat on most displays, and about 2.8 MB to send each time the screen is drawn.",
    visibleWhen: { id: "osfs.cockpit.screen.content", value: "flight" },
    home: all(COCKPIT_SCREEN), appliesLive: true, source: "src/flight/cockpit/cockpitScreen.ts",
  },

  ...REMOTE_CONTROL_PARAMETERS,

  // Aircraft → Start.
  {
    id: "osfs.start.latitude",
    label: "Start latitude",
    description: "Where a new flight starts, north of the equator.",
    unit: "deg",
    kind: "number",
    step: 0.0001,
    bounds: within(-90, 90),
    default: 44.977753,
    defaultReason: "Minneapolis, the original start.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/bootstrapC172.ts",
  },
  {
    id: "osfs.start.longitude",
    label: "Start longitude",
    description: "Where a new flight starts, east of Greenwich.",
    unit: "deg",
    kind: "number",
    step: 0.0001,
    bounds: within(-180, 180),
    default: -93.265011,
    defaultReason: "Minneapolis, the original start.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/bootstrapC172.ts",
  },
  {
    id: "osfs.start.heightAboveGround",
    label: "Start height",
    description: "How far above the loaded ground a new flight starts.",
    unit: "m",
    kind: "number",
    step: 10,
    bounds: within(0, 15_000),
    default: 1_524,
    defaultReason: "5,000 ft, the original start height.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/bootstrapC172.ts",
  },
  {
    id: "osfs.start.heading",
    label: "Start heading",
    description: "The true heading a new flight starts on.",
    unit: "deg",
    kind: "number",
    step: 1,
    bounds: within(0, 360),
    default: 300,
    defaultReason: "The original start heading.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/bootstrapC172.ts",
  },
  {
    id: "osfs.start.airspeed",
    label: "Start airspeed",
    description: "The calibrated airspeed a new flight starts at.",
    unit: KNOTS,
    kind: "number",
    step: 1,
    bounds: within(0, 800),
    default: 120,
    defaultReason: "The original start airspeed.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/bootstrapC172.ts",
  },
  {
    id: "osfs.start.pitch",
    label: "Start pitch",
    description: "How far the nose points above the horizon when a new flight starts; negative is below it. With the start climb angle it sets the wing's angle to the air.",
    unit: "deg",
    kind: "number",
    step: 1,
    bounds: within(-90, 90),
    named: [{ id: "aircraft", label: "Aircraft's own", description: "The start attitude the aircraft defines for itself." }],
    default: "aircraft",
    defaultReason: "Each aircraft's own start attitude, as every flight started before a shared flight could give one.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/resetFlightLocation.ts",
  },
  {
    id: "osfs.start.climbAngle",
    label: "Start climb angle",
    description: "The angle above the horizon a new flight starts moving along; negative descends.",
    unit: "deg",
    kind: "number",
    step: 1,
    bounds: within(-90, 90),
    default: 0,
    defaultReason: "Level flight, the original start.",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/resetFlightLocation.ts",
  },
  ...CONTROLS_PARAMETERS_1,
  {
    id: "osfs.start.resume",
    label: "Resume last flight",
    description: "A new session carries on from the last saved flight: its place, attitude, speed, controls, fuel and pause. Off, or when the page address gives a start position, flights start at the start position.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "Reloading the page or changing aircraft should not undo the flight in progress.",
    home: main(START),
    appliesLive: false,
    source: "src/flight/jsbsim/savedFlight.ts",
  },
  // "Physics [30 / 60 / 120 Hz] ?": a choice has no words after its track,
  // so the unit ends the last segment; each segment's full name says Hz.
  {
    id: "osfs.physics.rate",
    label: "Physics",
    description: "How many steps a second the flight model takes. The aircraft, its ground contact, the controls, autopilot and trim, and the wheel and G effects advance together, one step at a time; the display draws at its own rate between steps. A change applies to the next flight (New flight, Apply & reload or a change of aircraft), never mid-flight.",
    unit: "Hz",
    kind: "choice",
    choices: [
      { id: "30", label: "30 Hz", shortLabel: "30", description: "Half the work of 60 Hz, and not validated: a C172 at rest keeps bouncing on its gear, and a quick pull peaks about 40 ms late." },
      { id: "60", label: "60 Hz", shortLabel: "60", description: "Half the work of 120 Hz." },
      { id: "120", label: "120 Hz", shortLabel: "120 Hz", description: "Twice the work of 60 Hz: the rate every flight ran at before this choice existed." },
    ],
    default: "60",
    defaultReason: "Half the physics work of the earlier 120 Hz for each simulated second. 30 Hz is not validated yet, and 120 Hz is only ever chosen by hand, never by a preset or a device.",
    persistDefault: true,
    home: main(START),
    appliesLive: false,
    source: "src/flight/physics/physicsRate.ts",
  },
  {
    id: "osfs.start.saveInterval",
    label: "Save the flight every",
    description: "How often the flight in progress is saved for the next session while it runs. Pausing, and leaving or hiding the page, save it too.",
    unit: "s",
    kind: "number",
    step: 1,
    bounds: within(1, 600),
    default: 5,
    defaultReason: "A browser that crashes loses at most 5 s of flight, for one write of about 2 KB to browser storage each time.",
    home: all(START),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },

  // Aircraft → Assists.
  ...CONTROLS_PARAMETERS_2,

  // Autopilot: what the HUD's AP button engages.
  ...AUTOPILOT_PARAMETERS,

  // Aircraft → Ground handling.
  {
    id: "osfs.ground.arcadeLaunches",
    label: "Arcade ground launches",
    description: "Exaggerated bounces: with this off, deep ground impacts stop the flight before the gear springs can launch it.",
    unit: "none",
    kind: "boolean",
    default: false,
    defaultReason: "Off, as before: a deep impact ends the flight.",
    home: main(GROUND),
    appliesLive: true,
    source: "src/flight/physics/fixedStepLoop.ts",
  },
  {
    id: "osfs.ground.automaticMoveMeters",
    label: "Move onto the ground without asking",
    description: "When the map puts the ground this close above or below the aircraft, it is moved onto the ground at once. Further than this, a card asks first. Zero always asks.",
    unit: "m",
    kind: "number",
    step: 0.1,
    bounds: within(0, 5),
    default: 1,
    defaultReason: "Map detail that loads under a landed aircraft moves the ground by centimetres; asking about that interrupts for nothing. A metre still asks before lifting an aircraft out of a hill or a building.",
    home: main(GROUND),
    appliesLive: true,
    source: "ground-contact/src/terrainContact.ts",
  },

  // Sound: the tiers are separate synthesis engines, so the tier is a choice
  // (docs/sound.md). A stored preference never restores louder sound than the
  // pilot last heard, and a downgrade persists until an explicit re-test.
  ...SOUND_PARAMETERS,

  // Engine.
  ...AIRCRAFT_PARAMETERS_6,
  {
    id: "osfs.engineTest.viewDistanceMeters", label: "Test stand starting view distance",
    description: "Initial camera distance from the isolated engine geometry when opening the test stand. Normal orbit and zoom controls remain available.",
    unit: { id: "m", text: "m" }, kind: "number", step: 0.1, bounds: within(1, 100), default: 6,
    defaultReason: "Six metres frames the nozzle and its exhaust for inspection.",
    home: main(ENGINE_TEST), appliesLive: false, source: "src/flight/createFlightSimApp.ts",
  },
  ...ENGINE_PARAMETERS_2,

  // Engine → Simulation: which engine model flies, for an aircraft that offers
  // a choice (the F-35B), and JSBSim's coupled turbine plant. Aircraft with
  // empirical engines ignore the plant's settings.
  {
    id: "osfs.engine.model", label: "Engine model",
    description: "How the engine is simulated, on an aircraft that offers both. The coupled engine plant advances fuel, combustion, gas path, shafts, nozzle and lift fan together. Empirical tables is the aircraft's earlier JSBSim table engine, unchanged, for flying one after the other.",
    unit: "none", kind: "choice",
    choices: [
      { id: "plant", label: "Coupled engine plant", description: "JSBSim's coupled engine plant." },
      { id: "empirical", label: "Empirical tables", description: "JSBSim's table-driven turbine, as the aircraft flew before the plant." },
    ],
    default: "plant",
    defaultReason: "The plant gives reheat thrust only while reheat fuel burns, and one fuel and energy account for the engine and lift fan.",
    home: main(ENGINE_SIMULATION), appliesLive: false, source: "src/flight/jsbsim/createJsbsimRuntime.ts",
  },
  ...ENGINE_PARAMETERS_3,

  // Aircraft → Ground handling: requests; what runs is resolved against what
  // is implemented, and reported beside each choice.
  ...GROUND_CONTACT_PARAMETERS,

  ...CONTROLS_PARAMETERS_3,
] as const satisfies readonly ParameterSpec[];

export type FlightParameterId = (typeof OSFS_PARAMETERS)[number]["id"];

/** The effective value of each flight parameter, by id. */
export type FlightParameterValues = CatalogueValues<typeof OSFS_PARAMETERS>;

/** What code reads flight parameters through: the registry, or its defaults in a test. */
export type FlightParameters = CatalogueParameters<FlightParameterValues>;

/** Reads, writes and watches flight parameters, typed by id. */
export type FlightParameterStore = CatalogueStore<FlightParameterValues>;

/** The registry, typed for the flight's own parameters. */
export function flightParameterStore(registry: CatalogueRegistry): FlightParameterStore {
  return catalogueStore(registry);
}

/** The spec of one flight parameter. */
export const flightParameterSpec = catalogueSpec(OSFS_PARAMETERS);

/**
 * The catalogue's defaults in memory, for code that runs without a registry,
 * such as a unit test. Overrides stand in for values the test sets. Writes are
 * not validated and not saved.
 */
export function flightParameterDefaults(overrides: Partial<FlightParameterValues> = {}): FlightParameterStore {
  return catalogueDefaults(flightParameterSpec, overrides);
}
