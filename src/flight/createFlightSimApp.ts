import { applyFlightResourceDefaults } from "./settings/flightResourceDefaults";
import { onAudioModsChanged } from "@0sfs/sound/installAudioMod";
import { createCameraFollow } from "@0sfs/aircraft/cameraFollow";
import "foss-earth/shell.css";
import "foss-earth/immersive.css";
// The fleet registers with the aircraft catalog before anything reads it.
import "./aircraft/fleet";
import { Matrix, Vector3, type WebGPUEngine } from "@babylonjs/core";
import { bindFrameProfileSettings, FRAME_PROFILING_IDS } from "foss-earth/perf";
import { setActiveFrameProfile } from "./diagnostics/frameProfile";
import { createModelOverrideLoader, requestedModelOverride } from "./aircraft/devModelOverride";
import { AIRCRAFT_URL_NAME } from "./aircraft/aircraftAddress";
import { TerrainRecoveryError } from "./terrainRecovery";
import { createFlightRegionPreparation } from "./flightRegionPreparation";
import { createLoadingCamera } from "./loadingCamera";
import { createFlightPlacementCoordinator } from "./placement/createFlightPlacementCoordinator";
import { createTerrainOverlapNotice } from "./placement/createTerrainOverlapNotice";
import { captureSimulation, restoreSimulation } from "@0sfs/ground-contact/safeFlightState";
import { createFlightUiHost } from "./earthUiHost";
import { createBenchmarkRouteController, forceBenchmarkRouteSettings, requestedBenchmarkRoute, type BenchmarkRouteController } from "./benchmarkRoutes";
import { attachResetButton, bootStep, browserReportDownloads, describeIsolation, createTestFeedbackPanel, failBoot } from "@foss-earth/ui/browser";
import { getAppSettings, TOOLBAR_ACTIVITY_OUTLINE_ID, TOOLBAR_EDIT_PRIORITIES_ID } from "foss-earth/settings";
import { openAccountSession } from "foss-earth/account";
import {
  getAppIdentity,
  issueReporterFromBuild,
  markBoot,
  markBootOnFrame,
  reportSecrets,
  describeError,
  redactIssueReport,
  startAppDiagnostics,
  type AppDiagnostics,
} from "foss-earth/diagnostics";
import { createMeshInspector } from "foss-earth/diagnosticDrawing";
import { createWasmSections, earthWasmCores, earthComputeScheduling } from "foss-earth/wasm";
import { describeAttitudeRendererStatus } from "./hud/attitudeRenderer";
import { AIRCRAFT_FOCUS_POINT, registerFlightSettings } from "./settings/registerFlightSettings";
import { flightParameterSpec, type FlightParameterStore } from "./settings/flightParameters";
import { AIRCRAFT_START_PARAMETER_IDS, applyAircraftStartDefaults } from "./settings/aircraftStart";
import {
  AIRCRAFT_SELECTION_PARAMETER_IDS,
  aircraftSelectionValues,
  readAircraftSelection,
} from "@0sfs/aircraft/aircraftSelectionSetting";
import "foss-earth/windowing.css";
import type { LocationSearchProvider } from "foss-earth/windowing";
import { createFlightLocation, type FlightLocation } from "./location/flightLocation";
import { resetFlightLocation } from "./jsbsim/resetFlightLocation";
import { readFuelTanks, writeFuelTanks } from "@0sfs/fuel/fuelTanks";
import { readExternalFuelTanks, setExternalFuelTankAttached } from "@0sfs/fuel/externalFuelTanks";
import { getExternalTankDefinitions } from "@0sfs/fuel/externalTankDefinitions";
import { createExternalTankVisuals } from "@0sfs/fuel/createExternalTankVisuals";
import { createStoreVisuals, type StoreVisualHandle } from "@0sfs/stores/createStoreVisuals";
import { createBayGearInterlock, type BayGearInterlock } from "@0sfs/stores/bayGearInterlock";
import { stationForFuelTank, tankOnStation as attachedTankStations } from "@0sfs/stores/stationTable";
import {
  aircraftHasWeaponStations, readBayDoorPositionsInto, readStoreMirror, writeGunFiring, writeGunRounds, writeMasterArm, writeStation,
  type StoreMirror,
} from "@0sfs/stores/storeAttachment";
import { rearmRefusal } from "@0sfs/stores/storeCatalog";
import { REARM_GROUND_ONLY } from "./settings/rearmRule";
import { createEngagement } from "./combat/engagement";
import { bestTarget, createFireControl, kinematicsFromState } from "./combat/fireControl";
import { createWeaponTrigger } from "./combat/weaponTrigger";
import { initialWeapon, isFireableWeapon, weaponCount, weaponStation, weaponTypes, type ArmamentControlsState } from "@0sfs/stores/armamentControls";
import { createArmamentWidget } from "@0sfs/stores/armamentWidget";
import { createProjectileView } from "./combat/projectileView";
import type { CombatMessage } from "@0sfs/multiplayer/protocol";
import { createEngineControl, engineIndices } from "@0sfs/engines/engineControl";
import {
  applySavedControls,
  captureSavedFlight,
  createSavedFlightStore,
  restoreSavedFlight,
  savedFlightPreview,
  type SavedFlight,
} from "./jsbsim/savedFlight";
import { createStartupPause } from "@0sfs/controls/startupPause";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { createFrameSurfaceQuery } from "@0sfs/ground-contact/frameSurfaceQuery";
import { createVisibleMeshCollision } from "@0sfs/ground-contact/visibleMeshCollision";
import { loadInputModePreference, loadInputSensitivityPreference } from "foss-earth/input";
import "../styles/flight.css";
import "@felipegalind0/gamepad-tools/styles.css";
import { controlTakesKey, createBrowserInputSource } from "@felipegalind0/gamepad-tools/browser";
import {
  BindingRuntime,
  createProfileStore,
} from "@felipegalind0/gamepad-tools/core";
import { mountBindingEditor } from "@felipegalind0/gamepad-tools/ui";

import {
  applyRendererChoice,
  createBabylonRuntime,
  createCanvasTextureDevicePorts,
  createSceneDeviceLocationMarker,
  createTerrainPerformanceCapture,
  RASTER_BASE_MAP_SOURCES,
  TERRAIN_SOURCES,
  resolveMapRuntimeConfig,
  setMapSourcePreference,
  setTerrainSourcePreference,
  type BabylonRuntime,
  type BabylonRuntimeOptions,
  type DeviceLocationFix,
  type DeviceLocationMarker,
  type GlobeMapDebugSnapshot,
  type RasterBaseMapSource,
} from "foss-earth/runtime";
import { createPlaceholderAircraft } from "@0sfs/aircraft/createPlaceholderAircraft";
import {
  getAircraftDefinition,
  getAircraftFamilyForAircraft,
  normalizeAircraftSelection,
  resolveControlCapabilities,
  type AircraftId,
  type AircraftLodId,
  type AircraftSelection,
} from "@0sfs/aircraft/aircraftCatalog";
import { applyAircraftRig, readControlSurfaceState, readGearDownNorm, type ControlSurfaceState } from "@0sfs/aircraft/aircraftAnimation";
import { createControlPositionReader } from "./controlPositions";
import { flightLog } from "@0sfs/logging/flightLog";
import { createFlightRecorder } from "@0sfs/logging/flightRecorder";
import { createEvaluationInstruments } from "./hud/evaluationInstruments";
import { INSTRUMENT_BANDS, readingTints } from "./hud/instrumentBands";
import { seaLevelMeters } from "./hud/seaLevel";
import { createHostFlightUi } from "./hud/hostFlightUi";
import { createGMeter } from "@0sfs/g-forces/gMeter";
import { createGVisionOverlay } from "@0sfs/g-forces/gVisionOverlay";
import type { LoggingAction, LoggingPanelState } from "@0sfs/logging/LoggingPanel";
import { bindRecorderMarkHotkey, downloadCsv } from "@0sfs/logging/loggingTab";
import { createEngineMonitor } from "@0sfs/engines/engineMonitor";
import { throttleLeverGauges } from "@0sfs/engines/throttleLever";
import { toDroneMotorStatus, toEngineStatus } from "@0sfs/rc/engineStatus";
import type { AircraftStatus } from "@0sfs/rc/protocol";
import { createCollisionDebugOverlay } from "@0sfs/ground-contact/createCollisionDebugOverlay";
import { createForcesDebugOverlay } from "./diagnostics/createForcesDebugOverlay";
import { createWheelSpinDebugOverlay } from "@0sfs/ground-contact/createWheelSpinDebugOverlay";
import { createWheelSpinExperiment } from "@0sfs/ground-contact/createWheelSpinExperiment";
import type { WheelSpinMode } from "@0sfs/ground-contact/wheelSpin";
import { createTireAudio } from "@0sfs/sound/createTireAudio";
import { createFlightAudio } from "@0sfs/sound/createFlightAudio";
import { AUDIO_PARAMETER_IDS, createAudioSettingsStore, readSoundTierLimits, SOUND_TIER_LIMIT_IDS } from "@0sfs/sound/audioSettings";
import { createElectricAudioAdapter } from "@0sfs/sound/electricAudioAdapter";
import { droneAcousticTelemetry } from "./drone/droneGate";
import { createJsbsimAudioAdapter } from "@0sfs/sound/jsbsimAudioAdapter";
import { applyEnginePlantSettings, ENGINE_PLANT_PARAMETER_IDS, readEnginePlantSettings } from "./jsbsim/enginePlantSettings";
import { getAircraftAudioInstallation, resolveAircraftAudioInstallation } from "@0sfs/sound/aircraftAudioProfiles";
import { WHEEL_SPIN_CONFIGS } from "@0sfs/ground-contact/wheelSpin";
import { probeWheelContactCapability } from "@0sfs/ground-contact/wheelContact";
import { createSlipAudioSink, createWheelCueBus, type WheelCueResetReason } from "@0sfs/controls/wheelCueBus";
import { createGamepadHapticOutput, createHapticsController, readHapticTuning, type HapticOutput } from "@0sfs/controls/haptics";
import {
  createGroundSettingsStore,
  GROUND_CHOICE_LABELS,
  GROUND_BOUNDARY_KEYS,
  GROUND_PARAMETER_IDS,
  patchGroundSettings,
  resolveGroundInteraction,
  type GroundBoundaryKey,
  type GroundCapabilities,
  type GroundInteractionSettingsV1,
} from "@0sfs/ground-contact/groundInteractionSettings";
import type { GroundInteractionAction, GroundInteractionPanelState } from "@0sfs/ground-contact/GroundInteractionSettingsPanel";
import {
  createFlightPerformanceCapture,
  isFlightPerformanceCaptureEnabled,
  setActiveFlightPerformanceCapture,
} from "@0sfs/logging/flightPerformanceCapture";
import {
  createPhoneCameraTrace,
  isPhoneCameraTraceEnabled,
  setActivePhoneCameraTrace,
} from "@0sfs/rc/phoneCameraTrace";
import {
  createAircraftModel,
  type AircraftModelHandle,
  type AircraftModelState,
} from "@0sfs/aircraft/createAircraftModel";
import { createAircraftLights, type AircraftLightSettings, type AircraftLightsHandle } from "@0sfs/aircraft/createAircraftLights";
import { applySlowDeviceSkyDefaults, offerViewpointSurfaceLighting } from "./settings/skyDefaults";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import { EMPTY_FLIGHT_STATE, type FlightState } from "@0sfs/ground-contact/flightState";
import { createFloatingOrigin, type FloatingOriginHandle } from "./bridge/floatingOrigin";
import { takeMultiplayerInvitation } from "./multiplayer/invitationHandoff";
import type { MountMultiplayer } from "./multiplayer/MultiplayerTab";
import type { createMultiplayerFeature } from "./multiplayer/createMultiplayerFeature";
import { createAircraftDamage } from "./damage/aircraftDamage";
import type { DamageImplementation } from "@0sfs/multiplayer/sharedSettings";
import type { SharedSettingsPanelState } from "./multiplayer/SharedSettingsPanel";
import {
  type FlightControlPanelHandle,
  type FlightControlPanelSnapshot,
  type FlightOverlayTab,
  type FlightWeatherState,
} from "./hud/FlightControlPanel";
import { createFlightControlPanel } from "./hud/createFlightControlPanel";
import { createAircraftSwitchOverlay } from "./hud/createAircraftSwitchOverlay";
import { createFlightHud, type FlightHudHandle, type FlightHudMasterAp } from "./hud/flightHud";
import { createFlightHudBar, type FlightHudBarHandle } from "./hud/createFlightHudBar";
import { createFlightStatusOverlay, type FlightStatusOverlayHandle } from "./hud/createFlightStatusOverlay";
import type { FlightStatusOverlayState } from "./hud/FlightStatusOverlay";
import { attachFlightCameraInput } from "@0sfs/controls/flightCameraInput";
import { createCameraGlide, createTouchSurfaceGlide, DEFAULT_GLIDE_DECAY } from "@0sfs/controls/cameraGlide";
import { createCockpitLook } from "./cockpitLook";
import { createCockpitScreen, type CockpitScreenPart } from "./cockpit/cockpitScreen";
import { createHeadsetPanel, createHeadsetSession, headsetFramesOf, offerHeadsetTab, type HeadsetSurface } from "foss-earth/immersive";
import { applyFastestComputerCockpitDefaults } from "./cockpit/cockpitScreenDefaults";
import { applyFlightControls } from "@0sfs/controls/applyFlightControls";
import { automaticFlapCommand } from "@0sfs/controls/autoFlaps";
import { createAutoTrimState, readAutoTrimTuning, setAutoTrimEnabled, stepPitchAutoTrim, stepRollAutoTrim } from "@0sfs/controls/autoTrim";
import {
  AUTOPILOT_PARAMETER_IDS,
  createAutopilotSettingsStore,
  type AutopilotSettingsV1,
} from "@0sfs/autopilot/autopilotSettings";
import { DISCONNECTED_ARDUPILOT_STATUS } from "@0sfs/autopilot/ardupilotStatus";
import {
  autopilotEngageBlockReason,
  createControlArbiterState,
  idleAutopilotOwners,
  resetArbiterHold,
  setArbiterEngaged,
  stepControlArbiter,
  type ControlArbiterResult,
} from "@0sfs/autopilot/controlArbiter";
import type { PhoneControlSession } from "@0sfs/rc/createPhoneControlSession";
import { phoneAttitude, type CameraAim } from "@0sfs/rc/protocol";
import {
  describePhoneCameraTuning,
  PHONE_CAMERA_PARAMETER_IDS,
  readPhoneCameraTuning,
  type PhoneCameraTuning,
} from "@0sfs/rc/phoneCameraTuning";
import { CONTROL_SHARING_PARAMETER_IDS, readControlSharing, type ControlSharing } from "@0sfs/rc/controlSharing";
import {
  PHONE_CONTROLLER_PARAMETER_IDS,
  phoneControllerSettingsValues,
  readPhoneControllerSettings,
} from "@0sfs/rc/phoneControllerSettings";
import { createControlBlend, type ControlBlend } from "@0sfs/rc/controlBlend";
import type { MountPhonePairing } from "@0sfs/rc/RemoteControlTab";
import { createFlightInputManager } from "@0sfs/controls/flightInputManager";
import {
  createFlightGamepadAdapter,
  createLegacyFlightProfile,
  createStandardFlightProfile,
  withWeaponNextDefaults,
} from "@0sfs/controls/gamepadToolsAdapter";
import { quadProfile } from "./drone/quadRegistry";
import { DEFAULT_KEYBOARD_AXES, KEYBOARD_AXES, keyboardAxisParameterId, readKeyboardAxes, withKeyboardAxes } from "@0sfs/controls/keyboardAxisBindings";
import { KEYBOARD_STICK_PARAMETER_IDS, readKeyboardStickSettings } from "@0sfs/controls/keyboardStickSettings";
import { createGamepadPollingController } from "@0sfs/controls/gamepadPolling";
import type { OrbitInvertSettings } from "foss-earth/input";
import { createJsbsimRuntime } from "./jsbsim/createJsbsimRuntime";
import { CONTROL_LAW_MODE_VALUES, getFdmProfile, resolveEngineModel } from "./jsbsim/fdmProfiles";
import { createAircraftEngineVisuals } from "@0sfs/aircraft/createAircraftEngineVisuals";
import { createFixedStepPhysicsLoop, type GroundImpact, HARD_GROUND_IMPACT_FAULT } from "./physics/fixedStepLoop";
import { createAircraftRest, enginesTurning, readAircraftMotion, touchingGround } from "./physics/aircraftRest";
import { groundContactUnits } from "@0sfs/ground-contact/groundContactClearance";
import { maxCatchUpSteps, PHYSICS_RATE_PARAMETER_ID, physicsStepSeconds, readPhysicsHz } from "./physics/physicsRate";
import { readPilotG } from "@0sfs/g-forces/gForce";
import { createFlightPilot, PILOT_PARAMETER_IDS, readFlightPilotSettings, type PilotTransition } from "./createFlightPilot";
import { cameraAttitudeView } from "./hud/cameraAttitudeView";
import { createFlightPathOverlay } from "./hud/flightPathOverlay";
import { createFlightCompass } from "./hud/flightCompass";
import type { AttitudeView } from "./hud/attitudeIndicator";
import { createFlightLoadingScreen, type FlightLoadingScreen } from "../loading/createFlightLoadingScreen";
import { appendModDependencyTree } from "@0sfs/about/modTree";
import { modAboutParts } from "@0sfs/mods";
import { ensureModsSession, getModsSession } from "./mods/modSession";
import { unavailableAircraftRequest } from "./unavailableAircraft";
import {
  currentDroneCommand, droneCameraTab, droneHooks, droneMotorTelemetry, droneRefusal, droneTelemetry, isDroneAircraftId, loadDroneFeature, noteActiveAircraft, setDroneRemovalSwitch,
} from "./drone/droneGate";
import {
  connectMapDetailLog,
  connectMapDetailRuntime,
  createAboutPanel,
  createBugReportPanel,
  createDiagnosticsSection,
  createGameLog,
  createMapDetailController,
  createMapSourcePanel,
  createOverviewMap,
  createPresetsSection,
  createRendererPanel,
  reportRendererStart,
  markParametersApplied,
  createSavedSettingsSection,
  createDateTimePanel,
  createSkyPanel,
  clearMapCache,
  inspectMapCache,
  createBrowserPositionSeaLevelPort,
  type GameLog,
  type GameLogLine,
  type MapDetailController,
  type PanelSection,
} from "foss-earth/shell";
import { importLegacyWorldDetail, navigatorDeviceHints } from "./worldDetail";
import { appHref } from "@0sfs/rc/appRoute";
import { engineTestStandBootstrapOptions, engineTestStandInitialState, isEngineTestStandRequested, makeEngineTestStandUrl } from "@0sfs/engines/engineTestStand";
import { createBrowserDataPanel } from "@foss-earth/ui/browser";

export interface FlightSimAppOptions {
  loadingScreen?: FlightLoadingScreen;
  /** Shared with the page's first-paint log; created here when absent. */
  log?: GameLog;
  /** Captures loading before the flight module starts; reused rather than started again. */
  diagnostics?: AppDiagnostics;
  googleApiKey?: string | null;
  baseMap?: string | RasterBaseMapSource | null;
  preferGoogleTiles?: boolean;
  dataBaseUrl?: string;
  locationSearchProvider?: LocationSearchProvider;
}

export interface FlightSimAppHandle {
  runtime: BabylonRuntime;
  destroy(): void;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
/** The Flight minimum's colour on the detail track and the HUD rail: the coarse end of the detail ramp. */
/**
 * The phone sends a swipe in CSS pixels scaled by 1/1000, so this works out at
 * 0.005 rad per pixel — the same rate a mouse drag on the desktop canvas uses,
 * which is why a swipe there and a swipe on the phone feel like one gesture.
 */
const PHONE_SWIPE_RADIANS = 5;

/** How far above the floor it hit Move up leaves the lowest contact after a hard impact. */
const IMPACT_LIFT_MARGIN_METERS = 0.1;

/** The flight's instruments, as the cockpit screen and a headset's HUD pick them. */
const FLIGHT_INSTRUMENTS = ".flight-hud-root, .flight-status-root";
/** What no copy of the page shows: the 3D view itself, and what acts on the pilot's eyes. */
const FLIGHT_NEVER_MIRRORED = ".flight-app__canvas, .flight-g-vision-root";
/** The VR tab's list: what the controllers do in the cockpit. */
const FLIGHT_HEADSET_CONTROLS: readonly (readonly [string, string])[] = [
  ["Trigger or pinch", "Press what you point at on the cockpit screen, a window or the toolbar."],
  ["Grip", "Hold a window to move it; let it go near its place to put it back."],
  ["Thumbstick up or down", "Scroll what you point at, or push a held window away and bring it near."],
  ["+ below the view", "With the windows in the HUD: open a window, or a tab once both sides hold one."],
  ["Flying", "A keyboard, a game controller or a paired phone flies the aircraft; the headset's controllers do not yet."],
];

function preferenceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeAngle(angle: number): number {
  const fullTurn = 2 * Math.PI;
  const normalized = angle % fullTurn;
  if (normalized > Math.PI) return normalized - fullTurn;
  if (normalized < -Math.PI) return normalized + fullTurn;
  return normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(current: number, target: number, deltaSeconds: number, halfLife: number): number {
  return current + (target - current) * (1 - Math.exp(-deltaSeconds / halfLife));
}

/**
 * Commit the complete aircraft choice atomically, taking it back if browser
 * storage refuses it.
 */
function writeAircraftSelection(parameters: FlightParameterStore, selection: AircraftSelection): string | null {
  const previous = readAircraftSelection(parameters);
  const result = parameters.setMany(aircraftSelectionValues(selection));
  if (!result.ok) return `Could not apply your aircraft choice: ${result.reason}`;
  if (parameters.storageError() === null) return null;
  parameters.setMany(aircraftSelectionValues(previous));
  return "Could not save your aircraft choice. The active aircraft is unchanged. Allow browser storage, then apply again.";
}

function zoomMetersFromAltitude(altMeters: number): number {
  return Math.max(250, Math.min(altMeters * 1.5, 12_000));
}

/** This page's address opening the report-only page, which shows the report and starts no flight. */
function reportOnlyAddress(href: string): string {
  const url = new URL(href);
  url.searchParams.set("report", "");
  return url.href;
}

interface FlightSessionState {
  flight: SavedFlight | null;
  health: number;
  damageImplementation: DamageImplementation;
  state: FlightState;
  selection: AircraftSelection;
  weather: FlightWeatherState;
  viewMode: "first" | "third";
  position?: { x: number; y: number };
}

interface FlightSessionOptions {
  runtime?: BabylonRuntime;
  canvas?: HTMLCanvasElement;
  resume?: FlightSessionState;
  jsbsim?: Awaited<ReturnType<typeof createJsbsimRuntime>>;
  switching?: boolean;
  selection?: AircraftSelection;
  signal?: AbortSignal;
  onAircraftSwitch(selection: AircraftSelection, reportError?: boolean): Promise<string | null>;
}

interface FlightSessionHandle extends FlightSimAppHandle {
  canvas: HTMLCanvasElement;
  readonly alive: boolean;
  suspend(): FlightSessionState;
  finishSwitch(): void;
  report(): Promise<string>;
  destroy(preserveWorld?: boolean): void;
}

let droneRateRestore: "30" | "60" | "120" | null = null;

function modDefinesAircraft(aircraftId: string): boolean {
  const stack = [...getModsSession().records];
  while (stack.length) {
    const record = stack.pop();
    if (!record) break;
    stack.push(...record.dependencies);
    if (record.manifest.aircraft?.definitions.some(definition => definition["id"] === aircraftId)) return true;
  }
  return false;
}

function findJsbsimMod(modId: string): { baseUrl: string; files: readonly string[] } | null {
  const stack = [...getModsSession().records];
  while (stack.length) {
    const record = stack.pop();
    if (!record) break;
    stack.push(...record.dependencies);
    if (record.manifest.id === modId && record.manifest.jsbsimFiles) {
      return { baseUrl: record.baseUrl, files: record.manifest.jsbsimFiles };
    }
  }
  return null;
}

/** Keep the page, canvas and streamed world while replacing all aircraft-owned resources. */
export async function createFlightSimApp(
  rootElement: HTMLElement,
  options: FlightSimAppOptions = {},
): Promise<FlightSimAppHandle> {
  let current: FlightSessionHandle;
  let switching = false;
  let destroyed = false;
  const switchAbort = new AbortController();
  const overlay = createAircraftSwitchOverlay(rootElement.ownerDocument.body);
  let switchStatus: FlightLoadingScreen | null = null;
  const switchLoading: FlightLoadingScreen = {
    show() {
      overlay.hide();
      switchStatus ??= createFlightLoadingScreen(options.log);
      switchStatus.show({ title: "Switching aircraft", reset: true });
    },
    hide() { switchStatus?.hide(); },
    destroy() { switchStatus?.destroy(); switchStatus = null; },
    fail(message, failure) { switchStatus?.fail(message, failure); },
    setSpawnOverride(action) { switchStatus?.setSpawnOverride?.(action); },
    setPhase(phase, update) { switchStatus?.setPhase(phase, update); },
  };
  const switchAircraft = async (selection: AircraftSelection, reportError = false): Promise<string | null> => {
    let retainedReport = "";
    const failureReport = async (...failure: string[]): Promise<string> => redactIssueReport([
      ...failure,
      await current.report().catch(() => retainedReport),
    ].join("\n"), reportSecrets(getAppSettings()));
    if (switching || destroyed) return failureReport("An aircraft switch is already in progress.");
    const parameters = registerFlightSettings(getAppSettings());
    switching = true;
    let previous: FlightSessionState;
    try {
      previous = current.suspend();
      const saveError = writeAircraftSelection(parameters, selection);
      if (saveError) {
        parameters.setMany(aircraftSelectionValues(previous.selection));
        current.finishSwitch();
        switching = false;
        const report = await failureReport(saveError);
        if (reportError) overlay.fail(report);
        return report;
      }
    } catch (error) {
      switching = false;
      current.finishSwitch();
      const cause = describeError(error);
      const report = await failureReport(`Could not prepare the aircraft switch: ${cause.message}`, cause.stack ?? "");
      if (reportError) overlay.fail(report);
      return report;
    }
    overlay.show(getAircraftDefinition(selection.aircraftId).label, previous.position);
    let prepared: Awaited<ReturnType<typeof createJsbsimRuntime>> | undefined;
    let replaced = false;
    const runtime = current.runtime;
    const canvas = current.canvas;
    try {
      if (isDroneAircraftId(selection.aircraftId)) {
        await ensureModsSession();
        const installed = modDefinesAircraft(selection.aircraftId);
        if (!installed) {
          current.finishSwitch();
          switching = false;
          return "Install the DJI quadcopter mod from the Mods tab.";
        }
        await loadDroneFeature();
        if (!droneRateRestore) droneRateRestore = parameters.get(PHYSICS_RATE_PARAMETER_ID) as "30" | "60" | "120";
        parameters.set(PHYSICS_RATE_PARAMETER_ID, "120");
      } else if (droneRateRestore) {
        parameters.set(PHYSICS_RATE_PARAMETER_ID, droneRateRestore);
        droneRateRestore = null;
      }
      const profile = getFdmProfile(selection.aircraftId);
      prepared = await createJsbsimRuntime({
        dataBaseUrl: options.dataBaseUrl,
        aircraftId: selection.aircraftId,
        engineModel: resolveEngineModel(selection.aircraftId, parameters.get("osfs.engine.model"))?.id,
        findMod: findJsbsimMod,
        // A switch starts a new flight: the saved physics rate applies to it.
        physicsHz: readPhysicsHz(parameters),
        bootstrap: {
          latDeg: previous.state.latDeg, lonDeg: previous.state.lonDeg,
          headingDeg: previous.state.headingRad / RADIANS_PER_DEGREE,
          airspeedKts: profile.initialAirspeedKts ?? parameters.get("osfs.start.airspeed"),
          throttleNorm: profile.initialThrottleNorm,
        },
        onProgress: progress => overlay.progress(progress.progress == null ? null : progress.progress * 100, progress.message),
      });
      if (destroyed) { prepared.dispose(); return null; }
      // Presets/imports may have edited settings while the accepted switch loaded.
      // Its prepared physics and visible aircraft must commit as one identity.
      parameters.setMany(aircraftSelectionValues(selection));
      // Recreate every aircraft-specific consumer around the same map renderer.
      retainedReport = await current.report().catch(() => "");
      current.destroy(true);
      replaced = true;
      current = await createFlightSimSession(rootElement, {
        ...options, diagnostics: undefined, log: undefined, loadingScreen: switchLoading,
      }, { runtime, canvas, jsbsim: prepared, resume: previous, switching: true, selection, signal: switchAbort.signal, onAircraftSwitch: switchAircraft });
      prepared = undefined;
      if (destroyed) { current.destroy(); return null; }
      parameters.setMany(aircraftSelectionValues(selection));
      current.finishSwitch();
      overlay.hide();
      return null;
    } catch (error) {
      prepared?.dispose();
      parameters.setMany(aircraftSelectionValues(previous.selection));
      let recoveryError: unknown;
      if (!destroyed) {
        if (replaced) {
          try {
            current = await createFlightSimSession(rootElement, {
              ...options, diagnostics: undefined, log: undefined, loadingScreen: switchLoading,
            }, { runtime, canvas, resume: previous, switching: true, selection: previous.selection, signal: switchAbort.signal, onAircraftSwitch: switchAircraft });
          } catch (failure) { recoveryError = failure; }
        }
        if (!recoveryError) current.finishSwitch();
      }
      const cause = describeError(error);
      const recovery = recoveryError ? `\nRecovery also failed: ${describeError(recoveryError).message}` : "\nThe previous aircraft remains paused.";
      const report = await failureReport(
        `Aircraft switch failed: ${previous.selection.aircraftId} → ${selection.aircraftId}`,
        `Requested generation: ${selection.generationId ?? "default"}; detail: ${selection.lodId}`,
        cause.message, cause.stack ?? "", recovery,
      );
      if (!destroyed) {
        if (replaced || reportError) overlay.fail(report);
        else overlay.hide();
      }
      return report;
    } finally { switching = false; }
  };
  try {
    current = await createFlightSimSession(rootElement, options, { onAircraftSwitch: switchAircraft });
  } catch (error) { overlay.dispose(); throw error; }
  return {
    get runtime() { return current.runtime; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      switchAbort.abort();
      const alive = current.alive;
      current.destroy();
      if (!alive) current.runtime.destroy();
      overlay.dispose();
      switchLoading.destroy();
    },
  };
}

async function createFlightSimSession(
  rootElement: HTMLElement,
  options: FlightSimAppOptions,
  session: FlightSessionOptions,
): Promise<FlightSessionHandle> {
  markBoot("boot:modules");
  bootStep("modules", "Starting the flight", 0);
  // One registry for the page: FOSS Earth's parameters and the flight's.
  const settings = getAppSettings();
  const parameters = registerFlightSettings(settings);
  const flightResources = applyFlightResourceDefaults(settings);
  const benchmarkRoute = requestedBenchmarkRoute(window.location.search);
  let benchmarkRouteRun: BenchmarkRouteController | null = null;
  const diagnostics = options.diagnostics ?? startAppDiagnostics({
    log: options.log ?? createGameLog(), settings, identity: getAppIdentity(),
  });
  diagnostics.checkpoint?.("flight-resources.txt", JSON.stringify(flightResources, null, 2), true);
  const log = diagnostics.log;
  // A flight is lit by the hour it is flown at. The dome is the highest rung of
  // the sky ladder built, and needs nothing a device may lack: no float texture,
  // no render target and no shader of its own.
  settings.setHostDefault("sky.model", "dome", "a flight is lit by the Sun and the sky; the dome draws on any renderer");
  // The aircraft's underside is lit by the ground below it as it is drawn; and a
  // low flight may light its imagery as at the aircraft, the default only on a very slow device.
  settings.setHostDefault("sky.groundLight.mode", "rendered", "a flight lights the aircraft from the ground below it as it is drawn");
  offerViewpointSurfaceLighting(settings);
  const engineTest = isEngineTestStandRequested(window.location.search);
  const engineInitialState = engineTestStandInitialState(window.location.search);
  const benchBootstrap = engineTest ? engineTestStandBootstrapOptions(engineInitialState) : null;
  // A dev server may fly the aircraft with models from build/model-overrides/ instead of public/.
  const modelOverride = requestedModelOverride(window.location.search);
  if (modelOverride) flightLog.warn("aircraft", `Dev model override ${modelOverride} is active`);
  const loadOverriddenContainer = modelOverride ? createModelOverrideLoader(modelOverride, {
    onSubstitute: (assetPath, url) => flightLog.warn("aircraft", `Dev model override ${modelOverride}: ${assetPath}`, { url }),
  }) : undefined;
  const stopWatching: (() => void)[] = [];
  // Where sea level is over Google 3D Tiles, whose heights are the WGS84
  // ellipsoid's: the toolbar's altitude and the phone's take it away.
  const seaLevel = createBrowserPositionSeaLevelPort();
  stopWatching.push(() => seaLevel.dispose());
  /** Feet above sea level, or null while sea level there is unknown. */
  const feetAboveSeaLevel = (state: FlightState): number | null => {
    const base = seaLevelMeters(seaLevel, settings, runtime.status.mode, state.latDeg, state.lonDeg);
    return base === null ? null : (state.altMeters - base) / 0.3048;
  };
  // A still outline spares the page restyling and repainting the busy chips every frame.
  const applyActivityOutline = (): void => {
    if (settings.get(TOOLBAR_ACTIVITY_OUTLINE_ID) === "still") document.documentElement.dataset.hudActivity = "still";
    else delete document.documentElement.dataset.hudActivity;
  };
  applyActivityOutline();
  stopWatching.push(settings.watch(TOOLBAR_ACTIVITY_OUTLINE_ID, applyActivityOutline));
  if (benchmarkRoute) {
    if (engineTest) throw new Error("A benchmark route cannot run on the engine test stand.");
    stopWatching.push(forceBenchmarkRouteSettings(settings, benchmarkRoute));
  }
  // The physics log is structured and has its own UI. Only its message joins
  // the visit's trail; property snapshots and coordinates stay out of it.
  let lastFlightEventId = flightLog.entries()[0]?.id ?? 0;
  stopWatching.push(flightLog.subscribe(entries => {
    for (const entry of entries.filter(entry => entry.id > lastFlightEventId).reverse()) {
      const text = `${entry.source}: ${entry.message}`;
      if (entry.level === "info") diagnostics.trail.step(text);
      else diagnostics.trail.trouble(text);
      lastFlightEventId = entry.id;
    }
  }));
  const startLocation = () => ({ latDeg: parameters.get("osfs.start.latitude"), lonDeg: parameters.get("osfs.start.longitude") });
  let startHeightMeters = parameters.get("osfs.start.heightAboveGround");
  const loading = options.loadingScreen ?? createFlightLoadingScreen(log, () => diagnostics.report({ allSettings: true }));
  const traceStartup = <T,>(name: string, run: () => Promise<T>): Promise<T> => loading.trace ? loading.trace(name, run) : run();
  loading.show();
  loading.setPhase("app", { state: "ready" });
  loading.setPhase("world", { state: "loading", detail: "Preparing the map renderer" });
  loading.setPhase("flight", { state: "loading", detail: "Loading flight physics" });
  // Restored selections and flight snapshots validate aircraft IDs against the
  // live catalogue. Install the default modpack, whose drones join the catalogue
  // here, and reinstall saved mods before either is read; otherwise a reload
  // treats a mod aircraft as unknown and loses its location.
  diagnostics.checkpoint?.("mods-state.txt", "Installing startup mods", true);
  await ensureModsSession();
  diagnostics.checkpoint?.("mods-state.txt", "Startup mods installed", true);
  // The last saved flight carries on where it was, unless resuming is off or
  // the page address chose a start position.
  const savedFlights = createSavedFlightStore(preferenceStorage());
  const addressedStart = (["osfs.start.latitude", "osfs.start.longitude"] as const)
    .some(id => settings.inspect(id).provenance === "url");
  const resumeFlight = session.resume ? session.resume.flight : !engineTest && parameters.get("osfs.start.resume") && !addressedStart ? savedFlights.read() : null;
  if (resumeFlight) {
    log.print({ text: `Resuming the flight saved ${new Date(resumeFlight.savedAtMs).toLocaleString()}${resumeFlight.paused ? ", paused" : ""}` });
  }
  // Pause works from the first moment of loading. The flight's own input,
  // which needs the simulator, takes it over once it exists.
  const flightGamepadPolling = createGamepadPollingController(parameters);
  let startupPauseLine: GameLogLine | null = null;
  const startupPause = createStartupPause({
    paused: session.switching || (resumeFlight?.paused ?? false),
    shouldPoll: flightGamepadPolling.claimIdleFrame,
    onChange: paused => {
      const entry = { text: paused ? "The flight will start paused." : "The flight will start running." };
      if (startupPauseLine) startupPauseLine.update(entry);
      else startupPauseLine = log.print(entry);
    },
  });
  const account = await openAccountSession(document);
  stopWatching.push(() => account.destroy());
  const explicitGoogleKey = Boolean(options.googleApiKey?.trim()) || account.visitLocked;
  if (!explicitGoogleKey && account.hosted) {
    settings.setHostDefault("map.source.basemap", "google", "the signed-in account includes Google 3D Tiles");
  }
  const mapConfig = resolveMapRuntimeConfig({
    googleApiKey: explicitGoogleKey ? options.googleApiKey : null,
    ignoreSavedGoogleKey: !explicitGoogleKey && Boolean(account.hosted),
    baseMap: options.baseMap,
    preferGoogleTiles: options.preferGoogleTiles,
    settings,
  });
  let initialAircraftSelection = session.selection ?? readAircraftSelection(parameters);
  const droneRequested = !session.jsbsim && isDroneAircraftId(initialAircraftSelection.aircraftId);
  if (droneRequested) await ensureModsSession();
  // An aircraft the address or this browser asked for that nothing installed
  // supplies. The flight waits: flying another aircraft is the pilot's choice.
  const unavailable = droneRequested && !modDefinesAircraft(initialAircraftSelection.aircraftId)
    ? initialAircraftSelection.aircraftId
    : session.selection ? null : unavailableAircraftRequest(settings);
  if (unavailable) {
    const instead: AircraftSelection = droneRequested ? { aircraftId: "cessna-172", lodId: "auto" } : initialAircraftSelection;
    const message = `No installed mod supplies the aircraft "${unavailable}" this flight asks for. Add the mod that provides it, then reload.`;
    await new Promise<void>(resolve => {
      loading.fail(message, { actions: [{ label: `Fly the ${getAircraftDefinition(instead.aircraftId).label} instead`, onClick: () => resolve() }] });
      // The boot terminal covers the page until the first frame: it hands over to the loading screen, which shows the choice.
      failBoot(message);
    });
    // The choice replaces the request, so a mod that arrives later does not switch the aircraft.
    const refused = writeAircraftSelection(parameters, instead);
    if (refused) flightLog.warn("aircraft", refused);
    initialAircraftSelection = instead;
    loading.show();
  } else if (droneRequested) {
    await loadDroneFeature();
    if (!droneRateRestore) droneRateRestore = parameters.get(PHYSICS_RATE_PARAMETER_ID) as "30" | "60" | "120";
    parameters.set(PHYSICS_RATE_PARAMETER_ID, "120");
  }
  const initialAircraftId: AircraftId = initialAircraftSelection.aircraftId;
  const aircraftControls = getAircraftDefinition(initialAircraftId).controls;
  const droneAircraft = isDroneAircraftId(initialAircraftId);
  // A fresh flight starts where its aircraft's mod says. Switching aircraft
  // keeps the flight where it is: the new start waits for the next new flight.
  for (const problem of applyAircraftStartDefaults(settings, getAircraftDefinition(initialAircraftId), droneAircraft)) {
    flightLog.warn("aircraft", `Part of the ${initialAircraftId} start was refused; the flight's own start applies`, { reason: problem });
  }
  if (session.runtime) markParametersApplied(settings, AIRCRAFT_START_PARAMETER_IDS);
  startHeightMeters = parameters.get("osfs.start.heightAboveGround");
  const spawn = benchBootstrap ? { latDeg: benchBootstrap.latDeg!, lonDeg: benchBootstrap.lonDeg! }
    : session.resume ? { latDeg: session.resume.state.latDeg, lonDeg: session.resume.state.lonDeg }
    : resumeFlight ? { latDeg: resumeFlight.latDeg, lonDeg: resumeFlight.lonDeg } : startLocation();
  // A new flight's attitude and path, such as a shared flight's; "aircraft" keeps the aircraft's own attitude.
  const startPitch = parameters.get("osfs.start.pitch");
  const startAttitude: Pick<FlightLocation, "pitchDeg" | "flightPathDeg"> = benchBootstrap || session.resume || resumeFlight ? {} : {
    ...(typeof startPitch === "number" ? { pitchDeg: startPitch } : {}),
    flightPathDeg: parameters.get("osfs.start.climbAngle"),
  };
  const controlCapabilities = resolveControlCapabilities(getAircraftDefinition(initialAircraftId), droneAircraft);
  const climbRateControls = aircraftControls?.vertical === "climb-rate";
  for (const axis of KEYBOARD_AXES) settings.setHostDefault(keyboardAxisParameterId(axis), aircraftControls?.keyboard?.[axis] ?? DEFAULT_KEYBOARD_AXES[axis], `the ${initialAircraftId} controls profile`);
  const aircraftCamera = getAircraftDefinition(initialAircraftId).camera;
  settings.setHostDefault("osfs.camera.chaseFrame", aircraftCamera?.follow ?? "aircraft", `the ${initialAircraftId} camera profile`);
  for (const [id, value] of [
    ["osfs.camera.chaseDistance", aircraftCamera?.chaseDistanceMeters],
    ["osfs.camera.chaseHeight", aircraftCamera?.chaseHeightMeters],
    ["osfs.camera.chaseZoomLimits", aircraftCamera?.chaseZoomLimits],
    ["osfs.camera.nearClipMeters", aircraftCamera?.nearClipMeters],
  ] as const) {
    settings.setHostDefault(id, value ?? flightParameterSpec(id).default, `the ${initialAircraftId} camera profile`);
  }
  noteActiveAircraft(initialAircraftId);
  // Engine → Simulation: the engine model this flight loads, where the aircraft offers a choice.
  const engineModel = resolveEngineModel(initialAircraftId, parameters.get("osfs.engine.model"))?.id ?? null;
  let mapDetail = null as MapDetailController | null;
  let disconnectMapDetail: () => void = () => {};
  let arrivalCamera: ReturnType<typeof createLoadingCamera> | null = null;
  let previewPlacement: (state: FlightState) => void = () => {};
  let aircraftBodyRadius = droneAircraft ? 0.5 : 10;
  const regionPreparation = createFlightRegionPreparation({
    parameters, drone: droneAircraft, loading,
    groundClearanceMeters: getFdmProfile(initialAircraftId).stance.staticMeters + 0.17,
    confirmRaise: (from, altitude, signal) => placement.request({
      destination: `${from.latDeg.toFixed(5)}, ${from.lonDeg.toFixed(5)} at ${altitude.toFixed(1)} m`,
      reason: `Raise the aircraft ${(altitude - from.altMeters).toFixed(1)} m to stand just above the ground loaded so far. Higher map detail may change this surface.`, signal,
    }),
    onProgress(progress, preview) {
      previewPlacement(preview);
      arrivalCamera?.update(progress);
      diagnostics.checkpoint?.("terrain-region.txt", JSON.stringify({ progress, target: {
        latDeg: preview.latDeg, lonDeg: preview.lonDeg, altitudeMeters: preview.altMeters,
      } }, null, 2));
    },
  });
  stopWatching.push(parameters.watch("osfs.region.show", () => regionPreparation.showRegion()));

  if (!session.canvas) rootElement.innerHTML = `
    <div class="flight-app">
      <canvas class="flight-app__canvas" aria-label="Flight simulator viewport"></canvas>
      <div class="flight-g-vision-root"></div>
      <div class="flight-hud-root"></div>
      <div class="flight-status-root"></div>
      <div class="flight-shell-root"></div>
      <div class="flight-panel-root"></div>
    </div>
  `;

  if (session.canvas) {
    const flightRoot = rootElement.querySelector<HTMLElement>(".flight-app")!;
    for (const child of [...flightRoot.children]) if (child !== session.canvas) child.remove();
    for (const className of ["flight-g-vision-root", "flight-hud-root", "flight-status-root", "flight-shell-root", "flight-panel-root"]) {
      const host = rootElement.ownerDocument.createElement("div");
      host.className = className;
      flightRoot.append(host);
    }
  }
  const canvas = session.canvas ?? rootElement.querySelector<HTMLCanvasElement>(".flight-app__canvas");
  const gVisionRoot = rootElement.querySelector<HTMLElement>(".flight-g-vision-root");
  const hudRoot = rootElement.querySelector<HTMLElement>(".flight-hud-root");
  const statusRoot = rootElement.querySelector<HTMLElement>(".flight-status-root");
  const shellRoot = rootElement.querySelector<HTMLElement>(".flight-shell-root");
  const panelRoot = rootElement.querySelector<HTMLElement>(".flight-panel-root");
  if (!canvas || !gVisionRoot || !hudRoot || !statusRoot || !shellRoot || !panelRoot) {
    throw new Error("Flight sim shell failed to mount.");
  }

  let bootstrapFailed = false;
  const bootResources: { runtime?: BabylonRuntime; jsbsim?: Awaited<ReturnType<typeof createJsbsimRuntime>> } = {};
  const startupAbort = new AbortController();
  if (session.signal) {
    const abort = () => startupAbort.abort();
    session.signal.addEventListener("abort", abort, { once: true });
    stopWatching.push(() => session.signal?.removeEventListener("abort", abort));
    if (session.signal.aborted) startupAbort.abort();
  }
  // ?terrainCapture=1 records terrain timings in window.fossTerrainPerformance and
  // ?mapDebug=1 publishes the map's debug events in window.__fossMapDebug
  // (docs/near-ground-performance.md). FOSS Earth's runtime no longer reads the address.
  const debugWindow = window as Window & { fossTerrainPerformance?: unknown; __fossMapDebug?: GlobeMapDebugSnapshot };
  const addressParameters = new URLSearchParams(window.location.search);
  const terrainPerformanceCapture = addressParameters.get("terrainCapture") === "1" ? createTerrainPerformanceCapture() : undefined;
  if (terrainPerformanceCapture) debugWindow.fossTerrainPerformance = terrainPerformanceCapture;
  const observations = addressParameters.get("mapDebug") === "1"
    ? {
      mapDebug: true,
      publishMapDebug: (snapshot: GlobeMapDebugSnapshot) => {
        debugWindow.__fossMapDebug = snapshot;
        return () => { if (debugWindow.__fossMapDebug === snapshot) delete debugWindow.__fossMapDebug; };
      },
    }
    : undefined;
  const runtimePromise = traceStartup("Create world renderer", () => (session.runtime ? Promise.resolve(session.runtime) : createBabylonRuntime(canvas, {
    googleApiKey: mapConfig.googleApiKey,
    googleCredential: explicitGoogleKey ? null : account.hosted,
    preferGoogleTiles: mapConfig.preferGoogleTiles,
    rasterBaseMap: mapConfig.rasterBaseMap,
    terrainSource: mapConfig.terrainSource,
    rasterImagery: mapConfig.rasterImagery,
    terrainPerformanceCapture,
    simMode: true,
    // The compat options omit observations; createBabylonRuntime passes them on to the globe runtime.
    ...(observations ? { observations } : {}),
  } as BabylonRuntimeOptions))).then(runtime => {
    if (bootstrapFailed) { if (!session.runtime) runtime.destroy(); throw new Error("Startup cancelled."); }
    bootResources.runtime = runtime;
    diagnostics.attachRuntime(runtime);
    // The controller is the one writer of the renderer's detail target. The
    // flight's old World detail is imported into it once.
    mapDetail = createMapDetailController({ settings, deviceHints: navigatorDeviceHints, googleRecommendation: "device-hints" });
    const imported = importLegacyWorldDetail(mapDetail, preferenceStorage(), {
      rendererMode: runtime.renderer.mode,
      deviceHints: navigatorDeviceHints(),
      flightMinimum: parameters.get("osfs.flight.minimum"),
    });
    if (imported === "retry") flightLog.warn("terrain", "World detail settings could not be saved; they apply until reload");
    const disconnectDetailRuntime = connectMapDetailRuntime(mapDetail, runtime);
    const disconnectDetailLog = connectMapDetailLog(runtime, log, settings);
    disconnectMapDetail = () => { disconnectDetailRuntime(); disconnectDetailLog(); };
    runtime.setSimRunning(false);
    runtime.setSimViewState({ ...spawn, zoomMeters: zoomMetersFromAltitude(resumeFlight?.aboveGroundMeters ?? startHeightMeters) });
    loading.setPhase("world", { state: "ready" });
    return runtime;
  });
  // Each aircraft starts at its own profile's throttle unless the pilot chose one.
  settings.setHostDefault("osfs.start.throttle", getFdmProfile(initialAircraftId).initialThrottleNorm,
    `the ${initialAircraftId} profile`);
  settings.setHostDefault("osfs.start.airspeed",
    getFdmProfile(initialAircraftId).initialAirspeedKts ?? flightParameterSpec("osfs.start.airspeed").default,
    `the ${initialAircraftId} profile`);
  if (session.runtime) markParametersApplied(settings, ["osfs.start.airspeed", "osfs.start.throttle"]);
  const startHeadingDeg = session.resume ? session.resume.state.headingRad / RADIANS_PER_DEGREE
    : resumeFlight?.headingDeg ?? parameters.get("osfs.start.heading");
  // The pose this flight will have, before the simulator exists: a switch's or
  // saved flight's absolute pose and motion, or a fresh start along its heading
  // at the simulator's temporary 5,000 ft until the ground is known.
  const freshStart: FlightState = {
    ...EMPTY_FLIGHT_STATE, ...spawn,
    altMeters: (benchBootstrap?.altFt ?? 5_000) * 0.3048,
    headingRad: startHeadingDeg * RADIANS_PER_DEGREE,
    airspeedKts: benchBootstrap ? 0 : parameters.get("osfs.start.airspeed"),
    northVelocityFps: benchBootstrap ? 0 : parameters.get("osfs.start.airspeed") * 1.68781 * Math.cos(startHeadingDeg * RADIANS_PER_DEGREE),
    eastVelocityFps: benchBootstrap ? 0 : parameters.get("osfs.start.airspeed") * 1.68781 * Math.sin(startHeadingDeg * RADIANS_PER_DEGREE),
    throttleNorm: parameters.get("osfs.start.throttle"),
  };
  const startupPreview: FlightState = benchBootstrap ? freshStart
    : resumeFlight ? savedFlightPreview(resumeFlight, session.resume?.state ?? freshStart)
    : session.resume?.state ?? freshStart;
  // Absolute altitude for every start except a new one, which starts above its ground.
  const startupAboveGround = benchBootstrap || resumeFlight || session.resume ? undefined : startHeightMeters;
  // Spawn now anyway cannot bypass the simulator: it is offered once physics exists.
  let startupAircraftAltitude: number | undefined;
  // Start local terrain selection as soon as the renderer exists. WASM and its
  // aircraft data are loading independently; no simulator work blocks this.
  const terrainReady = runtimePromise.then(runtime => traceStartup("Prepare local terrain", () => regionPreparation.prepare(runtime, startupPreview, startupAbort.signal, {
    aboveGroundMeters: startupAboveGround, aircraftAltitudeMeters: startupAircraftAltitude,
  })));
  // The full readiness join happens after the visual assets have started too.
  void terrainReady.catch(() => {});
  const jsbsimPromise = traceStartup("Create JSBSim physics", () => (session.jsbsim ? Promise.resolve(session.jsbsim) : createJsbsimRuntime({
    dataBaseUrl: options.dataBaseUrl,
    aircraftId: initialAircraftId,
    engineModel: engineModel ?? undefined,
    physicsHz: readPhysicsHz(parameters),
    findMod: findJsbsimMod,
    bootstrap: benchBootstrap ?? {
      ...spawn,
      headingDeg: startHeadingDeg,
      airspeedKts: parameters.get("osfs.start.airspeed"),
      throttleNorm: parameters.get("osfs.start.throttle"),
    },
    onProgress: progress => loading.setPhase("flight", {
      state: "loading", detail: progress.message, progress: progress.progress,
    }),
    onLog: (stream, message) => {
      if (stream === "stderr") {
        console.warn("[jsbsim]", message);
      }
    },
  }))).then(jsbsim => {
    if (bootstrapFailed) { jsbsim.dispose(); throw new Error("Startup cancelled."); }
    bootResources.jsbsim = jsbsim;
    flightLog.info("jsbsim", "Runtime build identified", { identity: jsbsim.identity });
    // Before the pilot's controls are made from the simulator's. A saved
    // flight that cannot be applied must not stop the flight from starting.
    if (resumeFlight) {
      try {
        applySavedControls(jsbsim.sdk, resumeFlight, initialAircraftId);
      } catch (error) {
        flightLog.warn("sim", "The saved flight's controls could not be applied", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    diagnostics.checkpoint?.("wasm-memory.txt", JSON.stringify({
      cores: bootResources.runtime ? earthWasmCores(bootResources.runtime) ?? [] : [],
      jsbsimMemoryBytes: (() => {
        try {
          const module = jsbsim.sdk?.module;
          const heap = module ? Reflect.get(module, "HEAPU8") as Uint8Array | undefined : undefined;
          return heap?.buffer.byteLength ?? "unavailable";
        } catch { return "unavailable"; }
      })(),
      note: "WASM memory sizes are partial observations, not total process memory.",
    }, null, 2), true);
    loading.setPhase("flight", { state: "ready" });
    startupAircraftAltitude = readFlightState(jsbsim.sdk).altMeters;
    regionPreparation.allowOverride(startupAircraftAltitude);
    return jsbsim;
  });
  let runtime: BabylonRuntime;
  let jsbsim: Awaited<ReturnType<typeof createJsbsimRuntime>>;
  try {
    [runtime, jsbsim] = await Promise.all([runtimePromise, jsbsimPromise]);
  } catch (error) {
    bootstrapFailed = true;
    startupAbort.abort();
    startupPause.dispose();
    disconnectMapDetail();
    mapDetail?.dispose();
    if (!session.runtime) bootResources.runtime?.destroy();
    bootResources.jsbsim?.dispose();
    loading.fail("Flight could not load. Check your connection and try again.", { cause: error });
    for (const stop of stopWatching.splice(0)) stop();
    if (!options.diagnostics) diagnostics.destroy();
    throw error;
  }
  // One step for the whole flight: the rate the native model was initialized
  // with, not the setting now. The loop, controls, autopilot, trim, wheel
  // cues and time accounting all use it; a changed setting waits for the next flight.
  const physicsHz = jsbsim.physicsHz;
  const physicsDt = physicsStepSeconds(physicsHz);
  let latestTerrainMeters: number | null = null;
  let requestedDroneId: string | null = null;
  flightLog.info("physics", "Fixed-step rate", { physicsHz, stepSeconds: physicsDt, maxCatchUpSteps: maxCatchUpSteps(physicsHz) });
  if (session.runtime && readPhysicsHz(parameters) === physicsHz) markParametersApplied(settings, [PHYSICS_RATE_PARAMETER_ID]);
  if (runtime.geospatialCamera) {
    runtime.geospatialCamera.detachControl();
    runtime.geospatialCamera.setEnabled(false);
  }
  // The renderer has said what it is: a very slow device lights imagery as at the aircraft, and takes the ground's light as one colour.
  applySlowDeviceSkyDefaults(settings);
  // And one of the fastest draws the chase view behind the cockpit screen's interface.
  applyFastestComputerCockpitDefaults(settings);
  let worldLoading = true;
  let aircraftSwitching = session.switching ?? false;
  // A new aircraft starts healthy; a failed switch restores the previous aircraft's health.
  const damage = createAircraftDamage(session.resume?.selection.aircraftId === initialAircraftId ? session.resume.health : undefined,
    session.resume?.damageImplementation);
  let sharedSettingsState: SharedSettingsPanelState = {
    values: { damageImplementation: damage.implementation, settingsEditors: "host" },
    role: "local", ready: true, pending: false, error: null,
  };
  const sharedSettingsBlocked = () => !sharedSettingsState.ready || sharedSettingsState.pending;
  // Holds physics while hidden gear pipelines compile under the loading screen.
  let gearPipelineWarmup = false;
  let placementAbort = startupAbort;
  const placement = createFlightPlacementCoordinator(document);
  const overlapNotice = createTerrainOverlapNotice(document);

  let phoneSession: PhoneControlSession | null = null;
  let phonePairing: Promise<MountPhonePairing> | null = null;
  // Diagnostics distinguish deliberate local input from automatic trim and
  // flap updates. Local input never removes the phone or changes priority.
  let localInputRevision = 0;
  /** A live phone and this computer share input using the selected priority. */
  let controlBlend: ControlBlend | null = null;
  const pausedAtStart = session.switching || startupPause.isPaused();
  startupPause.dispose();
  // A parked aircraft left alone stops stepping physics and drawing frames;
  // wakeFromRest, below, starts both again.
  const aircraftRest = createAircraftRest();
  // A flight setting can change what moves the aircraft: its weight, its
  // controls, its ground. Only a changed value counts; a note under a control
  // changes as renderers report, and moves nothing.
  let restSettings: Map<string, string> | null = null;
  const settingValue = (id: string): string => JSON.stringify(settings.get(id));
  stopWatching.push(settings.subscribe(changed => {
    if (!restSettings) return;
    for (const id of changed) {
      const before = restSettings.get(id);
      if (before !== undefined && before !== settingValue(id)) { wakeFromRest("setting"); return; }
    }
  }));
  const inputManager = createFlightInputManager({
    parameters,
    initialThrottle: jsbsim.sdk.getPropertyValue("fcs/throttle-cmd-norm"),
    verticalControl: aircraftControls?.vertical,
    initialGearDown: jsbsim.sdk.getPropertyValue("gear/gear-cmd-norm") > 0.5,
    initialPaused: pausedAtStart,
    rudderSign: getFdmProfile(initialAircraftId).rudderSign,
    afterburnerDetent: getAircraftDefinition(initialAircraftId).afterburner?.throttleDetent,
    onPausedChange: (paused) => syncSimulationPaused(paused),
    // The HUD's gear button follows the G key. Repainting here rather than
    // waiting for the next frame is what keeps the two in step while the
    // simulation is paused and the render loop is idle.
    onGearChange: (down) => { flightHud.setGearDown(down); runtime.requestRender(); },
    onLocalInput: () => { localInputRevision += 1; phoneSession?.noteLocalInput(); wakeFromRest("input"); },
    keyboardStickSettings: readKeyboardStickSettings(parameters),
    getBodyRates: () => ({
      rollRateRad: jsbsim.sdk.getPropertyValue("velocities/p-rad_sec"),
      pitchRateRad: jsbsim.sdk.getPropertyValue("velocities/q-rad_sec"),
      yawRateRad: jsbsim.sdk.getPropertyValue("velocities/r-rad_sec"),
    }),
  });
  // Keep the aircraft's initialized trim when the input owner takes over. The
  // aircraft holds roll trim scaled by osfs.aircraft.rollTrimRange: the wheel's
  // position is the command over the range, or a resumed flight's trim would
  // shrink by the range at every reload.
  inputManager.replacePitchTrim(jsbsim.sdk.getPropertyValue("fcs/pitch-trim-cmd-norm"));
  const heldRollTrim = jsbsim.sdk.getPropertyValue("fcs/roll-trim-cmd-norm") / parameters.get("osfs.aircraft.rollTrimRange");
  inputManager.replaceRollTrim(Number.isFinite(heldRollTrim) ? Math.max(-1, Math.min(1, heldRollTrim)) : 0);
  // A resumed flight's flap lever starts where it was left.
  if (resumeFlight) {
    const flaps = jsbsim.sdk.getPropertyValue("fcs/flap-cmd-norm");
    if (Number.isFinite(flaps)) inputManager.replaceFlaps(flaps);
  }
  let appliedControls = inputManager.getControls();
  const readActualFlaps = (): number => {
    const flap = getFdmProfile(initialAircraftId).flapPosition;
    return jsbsim.sdk.getPropertyValue(flap.property) / flap.fullTravel;
  };
  const controlPositionReader = createControlPositionReader(jsbsim.sdk, getFdmProfile(initialAircraftId));
  let actualControls = controlPositionReader.read();
  stopWatching.push(() => controlPositionReader.dispose());
  let actualFlaps = readActualFlaps();
  let lastLocalFlapsRevision = inputManager.getFlapsInputRevision();
  let lastRemoteFlaps: number | null = null;
  let takingFlapsManually = false;
  const takeFlapsManually = (): void => {
    takingFlapsManually = true;
    try { parameters.set("osfs.assist.autoFlaps", false); }
    finally { takingFlapsManually = false; }
  };
  const noticeLocalFlaps = (): void => {
    const revision = inputManager.getFlapsInputRevision();
    if (revision === lastLocalFlapsRevision) return;
    lastLocalFlapsRevision = revision;
    takeFlapsManually();
  };
  const noticeRemoteFlaps = (value: number): void => {
    const previous = lastRemoteFlaps;
    lastRemoteFlaps = value;
    if (previous !== null && value !== previous) takeFlapsManually();
  };
  const detachInput = inputManager.attach(window);
  for (const id of KEYBOARD_STICK_PARAMETER_IDS) {
    stopWatching.push(parameters.watch(id, () => inputManager.setKeyboardStickSettings(readKeyboardStickSettings(parameters))));
  }
  const arcadeGroundLaunches = (): boolean => parameters.get("osfs.ground.arcadeLaunches");
  let pitchAutoTrim = createAutoTrimState(parameters.get("osfs.assist.autoTrim"));
  let rollAutoTrim = createAutoTrimState(parameters.get("osfs.assist.autoRollTrim"));
  // The HUD's TRIM squares and Aircraft → Assists edit the same parameters.
  stopWatching.push(
    parameters.watch("osfs.assist.autoTrim", enabled => { pitchAutoTrim = setAutoTrimEnabled(pitchAutoTrim, enabled); runtime.requestRender(); }),
    parameters.watch("osfs.assist.autoRollTrim", enabled => { rollAutoTrim = setAutoTrimEnabled(rollAutoTrim, enabled); runtime.requestRender(); }),
  );
  const ardupilotStatus = DISCONNECTED_ARDUPILOT_STATUS;
  const autopilotStore = createAutopilotSettingsStore(parameters);
  let autopilotSettings: AutopilotSettingsV1 = autopilotStore.settings;
  let arbiterState = createControlArbiterState(
    inputManager.getGearDownNorm(),
    inputManager.getControls().flaps,
    inputManager.getControls().throttle,
  );
  let lastApResult: ControlArbiterResult = {
    engaged: false,
    blockedReason: autopilotEngageBlockReason(autopilotSettings, ardupilotStatus),
    owners: idleAutopilotOwners(),
    controls: inputManager.getControls(),
    gearDownNorm: inputManager.getGearDownNorm(),
  };
  const autopilotBlockReason = () => engineTest ? "The engine test stand uses manual throttle." : autopilotEngageBlockReason(autopilotSettings, ardupilotStatus);
  const hudMasterAp = (): FlightHudMasterAp => ({
    engaged: lastApResult.engaged,
    canEngage: autopilotBlockReason() === null,
    blockedReason: autopilotBlockReason(),
    ownsPitch: lastApResult.owners.pitch !== "pilot",
    ownsRoll: lastApResult.owners.roll !== "pilot",
    ownsGear: lastApResult.owners.gear !== "pilot",
    ownsFlaps: lastApResult.owners.flaps !== "pilot",
  });
  const aircraftOnGround = (): boolean => [0, 1, 2].some((index) => {
    const wow = jsbsim.sdk.getPropertyValue(`gear/unit[${index}]/WOW`);
    return Number.isFinite(wow) && wow > 0.5;
  });
  const readArbiterFlight = (dt: number) => ({
    dt,
    onGround: aircraftOnGround(),
    rollRad: jsbsim.sdk.getPropertyValue("attitude/phi-deg") * Math.PI / 180,
    rollRateRad: jsbsim.sdk.getPropertyValue("velocities/p-rad_sec"),
    pitchRad: jsbsim.sdk.getPropertyValue("attitude/theta-deg") * Math.PI / 180,
    pitchRateRad: jsbsim.sdk.getPropertyValue("velocities/q-rad_sec"),
    headingRad: jsbsim.sdk.getPropertyValue("attitude/psi-deg") * Math.PI / 180,
    yawRateRad: jsbsim.sdk.getPropertyValue("velocities/r-rad_sec"),
    airspeedKts: jsbsim.sdk.getPropertyValue("velocities/vc-kts"),
  });
  const syncArbiter = (pilot = inputManager.getControls()): ControlArbiterResult => {
    if (benchmarkRouteRun) {
      const target = benchmarkRouteRun.targets(readFlightState(jsbsim.sdk));
      const held = arbiterState.our;
      arbiterState = { ...arbiterState, our: { ...held,
        roll: { ...held.roll, hasTarget: true, targetRad: target.rollRad },
        pitch: { ...held.pitch, hasTarget: true, targetRad: target.pitchRad },
        yaw: { ...held.yaw, hasTarget: true, targetRad: target.headingRad },
        throttle: { ...held.throttle, hasTarget: true, target: target.airspeedKts,
          command: held.throttle.hasTarget ? held.throttle.command : pilot.throttle },
      } };
    }
    const stepped = stepControlArbiter(arbiterState, {
      settings: autopilotSettings,
      ardupilot: ardupilotStatus,
      pilot,
      gearDownNorm: inputManager.getGearDownNorm(),
      flight: readArbiterFlight(physicsDt),
      stickOverride: parameters.get("osfs.autopilot.stickOverride"),
    });
    arbiterState = stepped.state;
    lastApResult = stepped.result;
    return lastApResult;
  };
  const setAutopilotEngaged = (engaged: boolean): void => {
    if (engaged && autopilotBlockReason()) {
      runtime.requestRender();
      return;
    }
    if (engaged && parameters.get("osfs.assist.autoFlaps") && Number.isFinite(actualFlaps)) {
      inputManager.replaceFlaps(actualFlaps);
    }
    arbiterState = setArbiterEngaged(arbiterState, engaged);
    syncArbiter();
    runtime.requestRender();
  };
  // The Autopilot tab and its Show all parameters list edit the same parameters.
  const followAutopilotSettings = (): void => {
    if (autopilotSettings === autopilotStore.settings) return;
    autopilotSettings = autopilotStore.settings;
    if (autopilotBlockReason()) arbiterState = setArbiterEngaged(arbiterState, false);
    syncArbiter();
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    runtime.requestRender();
  };
  for (const id of AUTOPILOT_PARAMETER_IDS) stopWatching.push(parameters.watch(id, followAutopilotSettings));
  const applyAutopilotSettings = (next: AutopilotSettingsV1): void => {
    autopilotStore.set(next);
    followAutopilotSettings();
  };
  // Ground interaction: persistent requests resolve to what can actually run.
  // The Debug A/B experiment is a session-only override layered on top.
  const groundStore = createGroundSettingsStore(parameters);
  const contactCapability = probeWheelContactCapability(jsbsim.sdk);
  const groundCapabilities: GroundCapabilities = {
    // Even a detected bridge stays unavailable until the coupled solver is integrated with it.
    contactBridgeUnavailable: contactCapability.available
      ? "the coupled solver is not yet integrated with the native bridge" : contactCapability.reason,
    audioUnavailable: (globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext
      || (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext ? null : "Web Audio is unavailable in this browser",
  };
  const boundaryOf = (settings: GroundInteractionSettingsV1) => Object.fromEntries(
    GROUND_BOUNDARY_KEYS.map(key => [key, settings[key]])) as Pick<GroundInteractionSettingsV1, GroundBoundaryKey>;
  // A new flight is a safe boundary: saved wheel/force/contact choices start applied.
  let appliedGroundBoundary = boundaryOf(groundStore.settings);
  let groundResolution = resolveGroundInteraction(groundStore.settings, groundCapabilities, appliedGroundBoundary);
  let wheelExperiment: { rotation: WheelSpinMode | "off" | null; tireSound: boolean | null } = { rotation: null, tireSound: null };
  let groundMessage: GroundInteractionPanelState["message"] = null;
  let wheelSpinMode: WheelSpinMode | "off" = "off";
  let tireSoundEnabled = false;
  let hapticsActive = false;
  let acceptedWheelSteps = 0;
  let groundRevision = 0;
  const wheelSpin = createWheelSpinExperiment(jsbsim.sdk);
  // One sound owner for the engine and the tire cue: one context, one worklet,
  // one limiter, one set of holds (sound.md §2). Nothing is allocated until a
  // gesture asks for sound.
  const audioSettingsStore = createAudioSettingsStore(parameters);
  // Status can change before the panel exists (a restored tire cue arms its
  // unlock during startup), so refreshes wait until there is a panel to refresh.
  let audioPanelReady = false;
  const flightAudio = createFlightAudio({
    settings: audioSettingsStore,
    tierLimits: () => readSoundTierLimits(parameters),
    onStatusChange: () => {
      if (audioPanelReady) controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    },
  });
  // The Sound tab's own controls go through flightAudio; Show all parameters
  // and imports change the parameters directly, and the sound follows.
  for (const id of [...AUDIO_PARAMETER_IDS, ...SOUND_TIER_LIMIT_IDS]) {
    stopWatching.push(parameters.watch(id, () => flightAudio.followSettings()));
  }
  // Beside each tier limit: what the running tier uses, and whether shedding lowered it.
  const TIER_NAMES = ["off", "low", "med", "high"];
  const RUNNING_FIELDS = {
    partials: "partials", noiseBands: "noiseBands", grains: "grains", grainStarts: "startsPerSecond", irMs: "irMilliseconds",
  } as const;
  for (const id of SOUND_TIER_LIMIT_IDS) {
    const [, , tier, field] = id.split(".") as [string, string, string, keyof typeof RUNNING_FIELDS];
    stopWatching.push(settings.setReadingSource(id, () => {
      const running = flightAudio.getStatus().running;
      if (!running || TIER_NAMES[running.tier] !== tier) return null;
      const value = running[RUNNING_FIELDS[field]];
      return running.shed > 0 ? `Running ${value}, shed ${running.shed} stages under load` : `Running ${value}`;
    }));
  }
  let boundAudioInstallation: ReturnType<typeof getAircraftAudioInstallation>;
  let boundAudioRenderer: object | undefined;
  let boundAudioProfiles: readonly object[] = [];
  function bindAircraftAudio(): void {
    const installation = getAircraftAudioInstallation(initialAircraftId);
    const admitted = resolveAircraftAudioInstallation(installation);
    if (installation === boundAudioInstallation && admitted.supported && admitted.renderer === boundAudioRenderer
      && admitted.sources.every((source, i) => source.definition === boundAudioProfiles[i])) return;
    boundAudioInstallation = installation;
    boundAudioRenderer = admitted.supported ? admitted.renderer : undefined;
    boundAudioProfiles = admitted.supported ? admitted.sources.map(source => source.definition) : [];
    if (!admitted.supported) { flightAudio.attachAdapter(null); return; }
    try {
      flightAudio.attachAdapter(admitted.source.definition.engineClass === "electric"
        ? createElectricAudioAdapter(jsbsim.sdk, { aircraftId: initialAircraftId,
          gearHeightMetres: getFdmProfile(initialAircraftId).stance.staticMeters,
          sources: admitted.sources, readTelemetry: droneAcousticTelemetry })
        : createJsbsimAudioAdapter(jsbsim.sdk, {
          gearHeightMetres: getFdmProfile(initialAircraftId).stance.staticMeters, source: admitted.source,
        }));
    } catch (error) {
      flightAudio.attachAdapter(null);
      flightLog.warn("sim", "Engine sound telemetry is unavailable; the tire cue still plays", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  bindAircraftAudio();
  stopWatching.push(onAudioModsChanged(bindAircraftAudio));
  const tireAudio = createTireAudio({ audio: flightAudio });
  tireAudio.setPaused(true);
  // Engine sound is held for pause and world loading only. Blocked terrain and
  // contact faults hold the tire cue alone (through tireAudio); the engine
  // follows its telemetry, so a flickering contact cannot chop it.
  flightAudio.setHeld(true, "loading");
  // Accepted fixed steps only; presentation consumers can never feed back into forces.
  const wheelCues = createWheelCueBus(WHEEL_SPIN_CONFIGS.map(config => config.name), error => {
    flightLog.warn("sim", "A wheel feedback consumer failed and was detached", {
      reason: error instanceof Error ? error.message : String(error),
    });
  });
  const slipAudio = createSlipAudioSink();
  wheelCues.subscribe(slipAudio);
  const hapticTuning = () => readHapticTuning(parameters);
  const gamepadHaptics = createGamepadHapticOutput({
    getSelectedSlot: () => inputManager.getSelectedGamepadSlot(),
    onChange: () => haptics.cancel(),
    getTuning: hapticTuning,
  });
  const phoneHaptics: HapticOutput = {
    // Coarse on/off pulses: magnitude maps to pulse length, not intensity.
    play: envelope => phoneSession?.setHapticFeedback(Math.min(envelope.durationMs,
      Math.round(10 + 50 * Math.max(envelope.strong, envelope.weak)))),
    cancel: () => phoneSession?.setHapticFeedback(0),
  };
  const haptics = createHapticsController([gamepadHaptics, phoneHaptics], hapticTuning);
  wheelCues.subscribe(haptics);
  const resetWheelSpin = (reason: WheelCueResetReason = "reset"): void => {
    wheelSpin.reset();
    wheelCues.invalidate(reason);
    tireAudio.update(0);
  };
  let externalTankStepSeconds = 0;
  const physicsLoop = createFixedStepPhysicsLoop(jsbsim.sdk, (state, stepSeconds) => {
    if (benchmarkRouteRun) {
      benchmarkRouteRun.acceptStep(state, () => runtime.surface.sample(state.latDeg, state.lonDeg)?.heightMeters ?? null);
      if (benchmarkRouteRun.status !== "running") inputManager.setPaused(true);
    }
    externalTankStepSeconds += stepSeconds;
    stepFlightPilot(stepSeconds);
    // Ahead of the wheel guard: engine sound must not depend on a wheel experiment.
    flightAudio.publishStep();
    if (engineTest || wheelSpinMode === "off") return;
    wheelSpin.step(stepSeconds, wheelSpinMode);
    acceptedWheelSteps += 1;
    wheelCues.publish(acceptedWheelSteps * stepSeconds, stepSeconds, wheelSpin.getStates());
  }, {
    physicsHz,
    getArcadeGroundLaunches: arcadeGroundLaunches,
  });
  const flightSurface = createFrameSurfaceQuery(runtime.surface);
  /** The terrain's height under the aircraft, which the HUD bar's altitude above ground is measured from; null while none has loaded there. */
  const groundHeightUnder = (state: FlightState): number | null =>
    runtime.surface.sample(state.latDeg, state.lonDeg)?.heightMeters ?? null;
  const terrainContact = createTerrainContact(jsbsim.sdk, flightSurface, getFdmProfile(initialAircraftId).stance, {
    bodyProbes: getFdmProfile(initialAircraftId).bodyCollisionProbes,
    automaticMoveMeters: () => parameters.get("osfs.ground.automaticMoveMeters"),
  });
  const visibleMeshCollision = createVisibleMeshCollision(jsbsim.sdk, flightSurface, {
    bodyProbes: getFdmProfile(initialAircraftId).bodyCollisionProbes,
    getRestitution: () => arcadeGroundLaunches() ? 1.35 : 0.25,
  });
  // This stays completely out of the normal render loop unless someone opts
  // in through the URL. It makes a stutter reproducible with numbers instead
  // of trying to infer its source from a single FPS reading.
  const flightPerformance = (benchmarkRoute || isFlightPerformanceCaptureEnabled())
    ? createFlightPerformanceCapture(benchmarkRoute ? { capacity: 65_536 } : {}) : null;
  if (flightPerformance) setActiveFlightPerformanceCapture(flightPerformance);
  // Where each frame's time goes (Debug → Frame budget). The runtime owns the
  // profiler and closes each frame; the flight adds its sections. `flightPerf=1`
  // starts it on; otherwise it is off until the Debug tab switches it on. Off,
  // it leaves nothing attached to the scene.
  const frameProfile = runtime.frameProfile;
  const frameProfiler = frameProfile.profiler;
  const unbindFrameProfile = bindFrameProfileSettings(settings, frameProfile);
  const setFrameProfiling = (enabled: boolean): void => { settings.set(FRAME_PROFILING_IDS.enabled, enabled); };
  // FOSS Earth's panels refresh after each drawn frame and settings change, as in the globe's app.
  const ui = createFlightUiHost(settings, document);
  const afterFrameUi = runtime.scene.onAfterRenderObservable.add(ui.emit);
  stopWatching.push(() => { runtime.scene.onAfterRenderObservable.remove(afterFrameUi); ui.dispose(); });
  setActiveFrameProfile({
    profiler: frameProfiler,
    session: frameProfile,
    settings,
    ui,
    setEnabled: setFrameProfiling,
    gpuTimed: () => frameProfile.gpuTimed(),
  });
  if (flightPerformance) setFrameProfiling(true);
  // The same idea for the phone's camera trackpad (`phoneCameraTrace=1`): every
  // hop from the phone's touch to the orbit drawn here, with both clocks.
  const phoneCameraTrace = isPhoneCameraTraceEnabled()
    ? createPhoneCameraTrace({
      getSettings: () => ({ recenterMode: orbitInvert().recenterMode, phoneSwipeRadians: PHONE_SWIPE_RADIANS, tuning: { ...phoneCameraTuning } }),
    }) : null;
  if (phoneCameraTrace) setActivePhoneCameraTrace(phoneCameraTrace);
  const vtolProfile = getFdmProfile(initialAircraftId).stovl;
  const aircraftPresentation = getAircraftDefinition(initialAircraftId);
  const afterburnerProfile = aircraftPresentation.afterburner;
  /** Where one push of the throttle lever stops, here and on the phone, unless the pilot opts out. */
  const afterburnerDetent = (): number | null => afterburnerProfile && !parameters.get("osfs.input.afterburnerOneMotion")
    ? afterburnerProfile.throttleDetent : null;
  // Under a sky model the scene has one exposure: an emitter is shown against the
  // luminance that exposure makes white, as the Sun's and the sky's light are.
  // With the model off there is none, and each emitter keeps its own reference.
  const skyWhiteLuminance = (): number | null => runtime.sky.getEnvironment()?.whiteLuminance ?? null;
  const readLightSettings = (): AircraftLightSettings => ({
    navigation: parameters.get("osfs.lights.navigation"),
    antiCollision: parameters.get("osfs.lights.antiCollision"),
    landing: parameters.get("osfs.lights.landing"),
    groundLight: parameters.get("osfs.lights.groundLight"),
    sizePx: parameters.get("osfs.lights.sizePx"),
    liftMeters: parameters.get("osfs.lights.liftMeters"),
    referenceNits: parameters.get("osfs.lights.referenceNits"),
  });
  for (const id of ["osfs.lights.navigation", "osfs.lights.antiCollision", "osfs.lights.landing", "osfs.lights.groundLight",
    "osfs.lights.sizePx", "osfs.lights.liftMeters", "osfs.lights.referenceNits"] as const) {
    stopWatching.push(parameters.watch(id, () => aircraftLights?.refresh()));
  }
  const readExhaustSettings = () => ({
    enabled: parameters.get("osfs.exhaust.enabled"),
    sampleCount: parameters.get("osfs.exhaust.sampleCount"),
    axialFieldSamples: parameters.get("osfs.exhaust.axialFieldSamples"),
    radialFieldSamples: parameters.get("osfs.exhaust.radialFieldSamples"),
    depthOcclusionEnabled: parameters.get("osfs.exhaust.depthOcclusionEnabled"),
    depthResolutionScale: parameters.get("osfs.exhaust.depthResolutionScale"),
    maxDistanceMeters: parameters.get("osfs.exhaust.maxDistanceMeters"),
    intensity: parameters.get("osfs.exhaust.intensity"),
    dryIntensity: parameters.get("osfs.exhaust.dryIntensity"),
    contributionView: parameters.get("osfs.exhaust.contributionView"),
    gasReferenceNits: skyWhiteLuminance() ?? parameters.get("osfs.exhaust.gasReferenceNits"),
    surfaceReferenceNits: skyWhiteLuminance() ?? parameters.get("osfs.exhaust.surfaceReferenceNits"),
    lightEnabled: parameters.get("osfs.exhaust.light.enabled"),
    lightGain: parameters.get("osfs.exhaust.light.gain"),
    lightRangeMeters: parameters.get("osfs.exhaust.light.rangeMeters"),
  });
  const engineVisuals = createAircraftEngineVisuals(jsbsim.sdk, runtime.scene, aircraftPresentation, {
    settings: readExhaustSettings(), requestRender: () => runtime.requestRender(),
    smokeSettings: readSmokeSettings(),
    getWorldFromEcef: () => floatingOrigin?.getWorldFromEcef() ?? null,
    onError: message => flightLog.warn("aircraft", message),
  });
  stopWatching.push(() => engineVisuals.dispose());
  for (const id of ["osfs.exhaust.enabled", "osfs.exhaust.sampleCount", "osfs.exhaust.maxDistanceMeters", "osfs.exhaust.intensity", "osfs.exhaust.surfaceReferenceNits",
    "osfs.exhaust.dryIntensity", "osfs.exhaust.axialFieldSamples", "osfs.exhaust.radialFieldSamples",
    "osfs.exhaust.depthOcclusionEnabled", "osfs.exhaust.depthResolutionScale",
    "osfs.exhaust.contributionView", "osfs.exhaust.gasReferenceNits",
    "osfs.exhaust.light.enabled", "osfs.exhaust.light.gain", "osfs.exhaust.light.rangeMeters"] as const) {
    stopWatching.push(parameters.watch(id, () => engineVisuals.setSettings(readExhaustSettings())));
  }
  // The sky's exposure moves with the hour and, metered, with the light: the emitters follow it.
  let exhaustWhiteLuminance = skyWhiteLuminance();
  const noteExhaustReferences = (): void => {
    const note = exhaustWhiteLuminance === null ? null
      : `Not used while a sky model is on: the sky's exposure shows ${Number(exhaustWhiteLuminance.toPrecision(3)).toLocaleString("en-US")} cd/m² as white, for this as for sunlight (Sky → Exposure and display).`;
    settings.setNote("osfs.exhaust.gasReferenceNits", note);
    settings.setNote("osfs.exhaust.surfaceReferenceNits", note);
  };
  noteExhaustReferences();
  stopWatching.push(runtime.sky.subscribe(() => {
    const white = skyWhiteLuminance();
    if (white === exhaustWhiteLuminance) return;
    exhaustWhiteLuminance = white;
    noteExhaustReferences();
    engineVisuals.setSettings(readExhaustSettings());
  }), () => {
    exhaustWhiteLuminance = null;
    noteExhaustReferences();
  });
  function readSmokeSettings() {
    return {
      enabled: parameters.get("osfs.exhaust.smoke.enabled"),
      maxParticles: parameters.get("osfs.exhaust.smoke.maxParticles"),
      emissionPerSecond: parameters.get("osfs.exhaust.smoke.emissionPerSecond"),
      lifetimeSeconds: parameters.get("osfs.exhaust.smoke.lifetimeSeconds"),
      maxDistanceMeters: parameters.get("osfs.exhaust.smoke.maxDistanceMeters"),
      opacity: parameters.get("osfs.exhaust.smoke.opacity"),
    };
  }
  for (const id of ["osfs.exhaust.smoke.enabled", "osfs.exhaust.smoke.maxParticles", "osfs.exhaust.smoke.emissionPerSecond",
    "osfs.exhaust.smoke.lifetimeSeconds", "osfs.exhaust.smoke.maxDistanceMeters", "osfs.exhaust.smoke.opacity"] as const) {
    stopWatching.push(parameters.watch(id, () => engineVisuals.setSmokeSettings(readSmokeSettings())));
  }
  const controlLawProfile = getFdmProfile(initialAircraftId).controlLaw;
  const followControlLaw = (): void => {
    if (!controlLawProfile) return;
    const mode = parameters.get("osfs.aircraft.controlLaw");
    jsbsim.sdk.setPropertyValue(controlLawProfile.commandProperty, CONTROL_LAW_MODE_VALUES[mode]);
  };
  followControlLaw();
  if (controlLawProfile) {
    stopWatching.push(parameters.watch("osfs.aircraft.controlLaw", () => {
      followControlLaw();
      runtime.requestRender();
    }));
    stopWatching.push(settings.setReadingSource("osfs.aircraft.controlLaw", () => {
      const enabled = jsbsim.sdk.getPropertyValue(controlLawProfile.enabledProperty) > 0.5;
      return `Active: ${enabled ? "Fly-by-wire" : "Manual"}${parameters.get("osfs.aircraft.controlLaw") === "auto" ? " (aircraft default)" : ""}`;
    }));
  }
  // The throttle lever starts and stops the engine, on this screen and the phone's.
  const engineControl = createEngineControl(jsbsim.sdk, getFdmProfile(initialAircraftId));
  let localStartHeld = false;
  const flightHud: FlightHudHandle = createFlightHud(hudRoot, {
    drone: droneAircraft,
    capabilities: controlCapabilities,
    onEngineDetails: () => controlPanel?.openOrSelectTab("engine"),
    getActualControls: () => actualControls,
    onGearChange: (down) => { inputManager.setGearDown(down); runtime.requestRender(); },
    onThrottleChange: (value) => { inputManager.setThrottle(value); runtime.requestRender(); },
    climbRate: climbRateControls ? {
      onChange: value => { inputManager.setClimbRateCommand(value); runtime.requestRender(); },
      getCommand: () => inputManager.getClimbRateCommand(),
      climbMps: quadProfile(initialAircraftId)?.modes.normal.climbMps ?? 1,
      descentMps: quadProfile(initialAircraftId)?.modes.normal.descentMps ?? 1,
    } : undefined,
    onPowerChange: initialAircraftId === "f-35b" ? ({ throttle, brake }) => {
      inputManager.setThrottleBrake(throttle, brake);
      runtime.requestRender();
    } : undefined,
    getKeepSliderBrakes: () => parameters.get("osfs.input.keepSliderBrakes"),
    getSliderBrake: () => inputManager.getSliderBrake(),
    // The monitor is made below; the HUD first draws from the sim loop, after it.
    getEngineGauges: () => throttleLeverGauges(engineMonitor.getReading()?.sample),
    engine: {
      getReading: () => engineControl.reading(),
      // Holding the lever is local pilot input; it preserves the selected device priority.
      onStartHold: (held) => {
        if (held) { phoneSession?.noteLocalInput(); wakeFromRest("input"); }
        localStartHeld = held;
      },
      onShutdown: () => {
        phoneSession?.noteLocalInput();
        wakeFromRest("input");
        engineControl.shutdown();
      },
    },
    afterburner: afterburnerProfile ? {
      accentColor: afterburnerProfile.accentColor,
      getActive: engineVisuals.afterburnerActive,
      getDetent: afterburnerDetent,
    } : undefined,
    vtolConversion: vtolProfile ? {
      getCommandNorm: () => parameters.get("osfs.aircraft.stovlConversion"),
      getPositionNorm: () => {
        try { return jsbsim.sdk.getPropertyValue(vtolProfile.positionProperty); }
        catch { return Number.NaN; }
      },
      onCommandChange: value => { parameters.set("osfs.aircraft.stovlConversion", value); },
    } : undefined,
    onPitchTrimChange: (value) => { inputManager.setPitchTrim(value); runtime.requestRender(); },
    onRollTrimChange: (value) => { inputManager.setRollTrim(value); runtime.requestRender(); },
    onPitchAutoTrimChange: (enabled) => { parameters.set("osfs.assist.autoTrim", enabled); },
    onRollAutoTrimChange: (enabled) => { parameters.set("osfs.assist.autoRollTrim", enabled); },
    onAutopilotEngageChange: (engaged) => { setAutopilotEngaged(engaged); },
    onFlapsChange: (value) => { inputManager.setFlaps(value); noticeLocalFlaps(); runtime.requestRender(); },
    flapAutomation: {
      getEnabled: () => parameters.get("osfs.assist.autoFlaps"),
      onEnabledChange: enabled => { parameters.set("osfs.assist.autoFlaps", enabled); },
      getPositionNorm: () => actualFlaps,
      minPositionNorm: getFdmProfile(initialAircraftId).flapPosition.minNorm,
    },
    onRudderChange: (value) => { inputManager.setRudder(value); runtime.requestRender(); },
    onStickChange: (aileron, elevator) => { inputManager.setStick(aileron, elevator); runtime.requestRender(); },
    pitchAutoTrim: pitchAutoTrim.enabled,
    rollAutoTrim: rollAutoTrim.enabled,
    autopilotEngaged: lastApResult.engaged,
    // Babylon keeps its device on an internal field. Sharing it puts the
    // instrument on the globe's queue instead of opening a second device.
    gpuDevice: runtime.renderer.mode === "webgpu" ? (runtime.renderer.engine as WebGPUEngine)._device : null,
    attitudeRenderer: parameters.get("osfs.renderer.attitudeIndicator"),
    onAttitudeStatus: status => {
      // What actually draws, under the choice in Renderer → Instruments.
      settings.setNote("osfs.renderer.attitudeIndicator", describeAttitudeRendererStatus(status));
      if (!status.backend) return;
      flightLog.info("hud", `Attitude indicator draws with ${status.backend === "webgpu" ? "WebGPU" : "Canvas 2D"}`,
        { preference: status.preference, renderer: runtime.renderer.mode, ...(status.reason ? { reason: status.reason } : {}) });
    },
    profiler: frameProfiler,
  });
  const attitudeSideParameter = droneAircraft ? "osfs.hud.droneAttitudeSide" : "osfs.hud.planeAttitudeSide";
  const applyAttitudeSide = (): void => {
    flightHud.setAttitudeSide?.(parameters.get(attitudeSideParameter));
    runtime.requestRender();
  };
  applyAttitudeSide();
  stopWatching.push(parameters.watch(attitudeSideParameter, applyAttitudeSide));
  stopWatching.push(parameters.watch("osfs.renderer.attitudeIndicator", preference => {
    flightHud.setAttitudeRenderer(preference);
    runtime.requestRender();
  }));
  /** Renderer → Instruments → Attitude indicator view: the 3D camera's frame, or null for the aircraft's. */
  const attitudeView = (): AttitudeView | null => (
    parameters.get("osfs.renderer.attitudeView") === "camera" ? cameraAttitudeView(runtime.scene.activeCamera) : null
  );
  stopWatching.push(parameters.watch("osfs.renderer.attitudeView", () => runtime.requestRender()));
  for (const id of ["osfs.input.keepSliderBrakes", "osfs.input.afterburnerOneMotion"] as const) {
    stopWatching.push(parameters.watch(id, () => {
      runtime.requestRender();
      phoneSession?.syncStatus();
    }));
  }
  if (vtolProfile) stopWatching.push(parameters.watch("osfs.aircraft.stovlConversion", () => {
    flightHud.refreshVtolConversion();
    runtime.requestRender();
  }));
  const syncNativeAutoFlaps = (): void => {
    const auto = getFdmProfile(initialAircraftId).automaticFlaps;
    if (auto.kind === "native") jsbsim.sdk.setPropertyValue(auto.commandProperty,
      Number(parameters.get("osfs.assist.autoFlaps") && lastApResult.owners.flaps === "pilot"));
  };
  syncNativeAutoFlaps();
  // Engine → Simulation, on every coupled-plant engine.
  const syncEnginePlantSettings = (): void => { applyEnginePlantSettings(jsbsim.sdk, readEnginePlantSettings(parameters)); };
  syncEnginePlantSettings();
  for (const id of ENGINE_PLANT_PARAMETER_IDS) stopWatching.push(parameters.watch(id, syncEnginePlantSettings));
  stopWatching.push(parameters.watch("osfs.assist.autoFlaps", enabled => {
    if (!enabled && !takingFlapsManually && Number.isFinite(actualFlaps)) {
      inputManager.replaceFlaps(actualFlaps);
    }
    syncNativeAutoFlaps();
    flightHud.refreshFlaps();
    runtime.requestRender();
  }));

  let floatingOrigin: FloatingOriginHandle | null = null;
  let flightCompass: ReturnType<typeof createFlightCompass> | null = null;
  // Map → Detail can load the ground around the aircraft, so that turning the
  // chase camera loads nothing new. The floating origin is the aircraft.
  stopWatching.push(runtime.registerFocusPoint({
    id: AIRCRAFT_FOCUS_POINT,
    label: "Aircraft",
    getPosition: () => floatingOrigin?.getOriginEcef() ?? null,
  }));
  let aircraft: ReturnType<typeof createPlaceholderAircraft> | null = null;
  let aircraftModel: AircraftModelHandle | null = null;
  let aircraftLights: AircraftLightsHandle | null = null;
  let externalTankVisuals: ReturnType<typeof createExternalTankVisuals> | null = null;
  let storeVisuals: StoreVisualHandle | null = null;
  let storeMirror: StoreMirror | null = null;
  let selectedWeaponKey: string | null = null;
  let gunFiring = false;
  const engagement = createEngagement();
  const fireControl = createFireControl();
  const weaponTrigger = createWeaponTrigger();
  let armamentWidget: ReturnType<typeof createArmamentWidget> | null = null;
  // A launch owns only a bay opening that it requested from a previously shut bay.
  let launchOwnedBay: 0 | 1 | null = null;
  let armamentGearCommand = inputManager.getGearDownNorm();
  let armamentFocused = document.hasFocus();
  const focusedKeys = new Set<string>();
  let projectiles: ReturnType<typeof createProjectileView> | null = null;
  let doorsSettled = true;
  // Holds a gear change until both weapon bays are shut, and a bay open until the gear rests.
  let bayInterlock: BayGearInterlock | null = null;
  let weaponStations: boolean | null = null;
  const hasWeaponStations = (): boolean => {
    if (weaponStations === null) weaponStations = aircraftHasWeaponStations(jsbsim.sdk);
    return weaponStations;
  };
  const refreshStores = (): void => {
    if (!hasWeaponStations()) return;
    cancelArmament();
    storeMirror = readStoreMirror(jsbsim.sdk);
    selectedWeaponKey ??= initialWeapon(storeMirror.load, storeMirror.gunRounds);
    storeVisuals?.sync(storeMirror);
    bayInterlock?.resync();
    doorsSettled = false;
  };
  stopWatching.push(parameters.watch("osfs.externalTanks.debrisLifetimeSeconds", seconds => {
    externalTankVisuals?.setLifetimeSeconds(seconds);
  }));
  stopWatching.push(parameters.watch("osfs.externalTanks.maxDetachedTanks", count => {
    externalTankVisuals?.setMaxDetachedTanks(count);
  }));
  stopWatching.push(parameters.watch("osfs.stores.debrisLifetimeSeconds", seconds => {
    storeVisuals?.setLifetimeSeconds(seconds);
  }));
  stopWatching.push(parameters.watch("osfs.stores.maxDetachedStores", count => {
    storeVisuals?.setMaxDetachedStores(count);
  }));
  // The pilot's setting, or a session's rule through setRearmRule: both tabs follow it.
  stopWatching.push(parameters.watch(REARM_GROUND_ONLY, () => {
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
  }));
  /** Whether weapon and fuel changes wait for the wheels now. Jettison never asks. */
  const rearmWaitsForWheels = (): boolean => parameters.get(REARM_GROUND_ONLY) && !aircraftOnGround();
  /** Scene east/up/south ground velocity, so a released store keeps the aircraft's momentum. */
  const releaseVelocity = (): Vector3 => {
    const state = physicsLoop.getLatestState() ?? initialState;
    return new Vector3(state.eastVelocityFps * 0.3048, state.verticalSpeedFps * 0.3048, -state.northVelocityFps * 0.3048);
  };
  let controlPanel: FlightControlPanelHandle | null = null;
  const armamentState = (): ArmamentControlsState | null => {
    if (!storeMirror) return null;
    const pending = fireControl.getPending();
    const selectedStation = weaponCount(storeMirror.load, selectedWeaponKey, storeMirror.gunRounds) > 0
      ? weaponStation(storeMirror.load, selectedWeaponKey) : null;
    let status: ArmamentControlsState["status"] = "ready";
    if (damage.snapshot().destroyed) status = "destroyed";
    else if (inputManager.isPaused() || worldLoading || gearPipelineWarmup || document.hidden || !armamentFocused || aircraftSwitching
      || terrainBlockedSinceMs !== null || physicsLoop.getFault()) status = "paused";
    else if (!storeMirror.masterArm) status = "safe";
    else if (!isFireableWeapon(selectedWeaponKey)) status = "unavailable";
    else if (weaponCount(storeMirror.load, selectedWeaponKey, storeMirror.gunRounds) <= 0) status = "empty";
    else if (weaponTrigger.needsRelease()) status = "release-trigger";
    else if (pending) status = bayInterlock?.queued(pending.bay) ? "waiting-for-gear" : "opening-bay";
    else if (gunFiring) status = "firing";
    return {
      load: storeMirror.load,
      tankOnStation: attachedTankStations(readExternalFuelTanks(jsbsim.sdk, aircraftId).flatMap(tank => tank.attached ? [tank.index] : [])),
      selectedWeaponKey, selectedStation, gunRounds: storeMirror.gunRounds,
      masterArm: storeMirror.masterArm, firing: gunFiring, pendingStation: pending?.station ?? null,
      status, canFire: status === "ready" || status === "firing",
    };
  };
  const refreshArmament = (): void => {
    const state = armamentState();
    if (state) armamentWidget?.update(state);
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    runtime.requestRender();
  };
  function cancelArmament(): void {
    const close = fireControl.cancel();
    if (close && launchOwnedBay === close.bay) bayInterlock?.requestBay(close.bay, false);
    launchOwnedBay = null;
    weaponTrigger.cancel(inputManager.getWeaponRelease() > 0.5);
    armamentWidget?.cancelTrigger();
    if (gunFiring) {
      gunFiring = false;
      writeGunFiring(jsbsim.sdk, false);
    }
  }
  const selectWeapon = (key: string): void => {
    if (!storeMirror || !isFireableWeapon(key) || !storeMirror.load.includes(key) || key === selectedWeaponKey) return;
    cancelArmament();
    selectedWeaponKey = key;
    refreshArmament();
  };
  const cycleWeapon = (direction: 1 | -1): void => {
    if (!storeMirror) return;
    const types = weaponTypes(storeMirror.load, storeMirror.gunRounds);
    if (!types.length) return;
    const index = selectedWeaponKey === null ? -1 : types.indexOf(selectedWeaponKey);
    const next = types[index < 0 ? (direction > 0 ? 0 : types.length - 1) : (index + direction + types.length) % types.length];
    if (next) selectWeapon(next);
  };
  const setMasterArm = (armed: boolean): void => {
    if (!storeMirror) return;
    cancelArmament();
    writeMasterArm(jsbsim.sdk, armed);
    storeMirror = { ...storeMirror, masterArm: armed };
    saveFlight();
    refreshArmament();
  };
  // Pilot evaluation: engine, AoA and CAS on the HUD. Flight recording lives in
  // the Logging tab and stays off until the pilot starts it.
  const flightRecorder = createFlightRecorder({
    metadata: {
      build: __SOURCE_VERSION__,
      built: __BUILD_TIME__,
      aircraft: initialAircraftId,
      generation: initialAircraftSelection.generationId ?? "",
      jsbsim: JSON.stringify(jsbsim.identity),
      physics_hz: String(physicsHz),
    },
  });
  const recordingFileName = () =>
    `0sfs-${initialAircraftId}-${__SOURCE_VERSION__}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const loggingSnapshot = (): LoggingPanelState => ({
    recording: flightRecorder.isRecording(),
    sampleCount: flightRecorder.getSampleCount(),
    durationSec: flightRecorder.getDurationSec(),
    markCount: flightRecorder.getMarks().length,
  });
  const handleLoggingAction = (action: LoggingAction): void => {
    if (action.type === "start") flightRecorder.start();
    else if (action.type === "stop") flightRecorder.stop();
    else if (action.type === "mark") flightRecorder.mark();
    else if (action.type === "clear") {
      flightRecorder.stop();
      flightRecorder.clear();
    } else if (action.type === "save" && flightRecorder.getSampleCount() > 0) {
      downloadCsv(`${recordingFileName()}.csv`, flightRecorder.toCsv());
    }
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
  };
  const unbindRecorderMark = bindRecorderMarkHotkey(flightRecorder);
  const evaluationInstruments = createEvaluationInstruments(
    hudRoot.querySelector<HTMLElement>(".flight-hud__eval") ?? hudRoot,
  );
  // What the airspeed, angle of attack and load chips are tinted against.
  const instrumentBands = INSTRUMENT_BANDS[initialAircraftId];
  // G-forces: the load at the pilot's seat is read after each accepted physics
  // step, for the pilot, and shown by the indicator and the vignettes once a
  // frame. All of it is DOM, so none of it asks the globe for a frame.
  const gMeter = createGMeter(hudRoot.querySelector<HTMLElement>(".flight-hud__g") ?? hudRoot, {
    onToggleTab: () => controlPanel?.toggleTab("gforces"),
  });
  const gVisionOverlay = createGVisionOverlay(gVisionRoot);
  let gIndicatorShown = parameters.get("osfs.gForce.indicator");
  let gVisionEnabled = parameters.get("osfs.gForce.vision");
  let passOutEnabled = parameters.get("osfs.gForce.passOut");
  // The response is the flight's: its states do not translate, so a change waits for the next flight.
  const pilot = createFlightPilot(parameters.get("osfs.gForce.response"), readFlightPilotSettings(parameters));
  if (session.runtime) markParametersApplied(settings, ["osfs.gForce.response"]);
  flightLog.info("pilot", "Response", { response: pilot.profileId() });
  /** The load the last accepted step gave the pilot, for the indicator; null after the frame has shown it. */
  let steppedPilotG: number | null = null;
  const logPilotTransition = (transition: PilotTransition, details: Record<string, number> = {}): void => {
    if (!transition) return;
    const secondsOut = pilot.kind === "curve" && transition === "passed-out" ? pilot.diagnostics().secondsOut : undefined;
    flightLog.info("pilot", transition === "passed-out" ? "Pilot passed out" : "Pilot came to", {
      response: pilot.profileId(), ...details,
      ...(secondsOut === undefined ? {} : { secondsOut: Number(secondsOut.toFixed(1)) }),
    });
  };
  // Once per accepted step, with that step's load and length: a pilot who
  // passes out in one step lets go of the controls from the next, also within
  // a frame. With the vignettes and passing out both off, nothing is followed.
  function stepFlightPilot(stepSeconds: number): void {
    if (!gVisionEnabled && !passOutEnabled) return;
    const pilotG = readPilotG(jsbsim.sdk);
    steppedPilotG = pilotG;
    logPilotTransition(pilot.step(pilotG, stepSeconds), { loadG: Number(pilotG.toFixed(1)) });
  }
  const showGVision = (): void => {
    // A pilot who is out sees nothing, in every view and at any strength.
    if (pilot.isOut()) { gVisionOverlay.show(1, 0); return; }
    const drawn = gVisionEnabled
      && (parameters.get("osfs.gForce.visionViews") === "all" || aircraft?.getViewMode() === "first");
    const strength = drawn ? parameters.get("osfs.gForce.visionStrength") : 0;
    gVisionOverlay.show(pilot.blackout() * strength, pilot.redout() * strength);
  };
  const clearGVision = (): void => {
    pilot.reset();
    showGVision();
  };
  /** Edits within the response keep what the pilot has used up: they never grant a recovery. */
  const configurePilot = (): void => {
    logPilotTransition(pilot.configure(readFlightPilotSettings(parameters)));
    showGVision();
  };
  const coverGVision = (): void => gVisionOverlay.cover(parameters.get("osfs.gForce.visionLayer") === "everything");
  gMeter.setVisible(gIndicatorShown);
  coverGVision();
  stopWatching.push(
    parameters.watch("osfs.gForce.indicator", shown => {
      gIndicatorShown = shown;
      gMeter.setVisible(shown);
      if (shown) gMeter.update(readPilotG(jsbsim.sdk));
    }),
    // Off forgets the load so far: sight is clear when it is turned on again.
    // The load is still followed while passing out is on, to pass out by.
    parameters.watch("osfs.gForce.vision", enabled => {
      gVisionEnabled = enabled;
      if (!enabled && !passOutEnabled) clearGVision();
      else showGVision();
    }),
    parameters.watch("osfs.gForce.passOut", enabled => {
      passOutEnabled = enabled;
      // Off wakes a pilot who is out, with their sight coming back from black.
      const transition = pilot.configure(readFlightPilotSettings(parameters));
      if (transition === "came-to") flightLog.info("pilot", "Pilot came to: passing out was turned off");
      else logPilotTransition(transition);
      if (enabled || gVisionEnabled) showGVision();
      else clearGVision();
    }),
    parameters.watch("osfs.gForce.visionLayer", coverGVision),
  );
  for (const id of PILOT_PARAMETER_IDS) {
    if (id !== "osfs.gForce.passOut") stopWatching.push(parameters.watch(id, configurePilot));
  }
  // How the vignettes are drawn: the pilot is unchanged.
  for (const id of ["osfs.gForce.visionStrength", "osfs.gForce.visionViews"] as const) {
    stopWatching.push(parameters.watch(id, showGVision));
  }
  const createAppliedEngineMonitor = isDroneAircraftId(initialAircraftId)
    ? droneHooks()?.createEngineMonitor ?? createEngineMonitor : createEngineMonitor;
  stopWatching.push(parameters.watch("osfs.aircraft.propellerDiscs", () => runtime.requestRender()));
  const engineMonitor = createAppliedEngineMonitor(
    hudRoot.querySelector<HTMLElement>(".flight-hud__engine") ?? hudRoot,
    {
      layoutScope: `${initialAircraftId}:${engineModel ?? "default"}:${getFdmProfile(initialAircraftId).engine}`,
      definition: {
        kind: (engineKind => engineKind === "none" ? "piston" as const : engineKind)(getFdmProfile(initialAircraftId).engine), maxRpm: getFdmProfile(initialAircraftId).maxEngineRpm,
        rotorBlades: getFdmProfile(initialAircraftId).rotorBlades,
        primaryThermalSolid: initialAircraftId === "f-35b" ? "liner" : undefined,
      },
      gpuDevice: runtime.renderer.mode === "webgpu" ? (runtime.renderer.engine as WebGPUEngine)._device : null,
      onOrbStatus: status => settings.setNote("osfs.renderer.engineOrbs", status.backend
        ? `Drawing with ${status.backend}.${status.reason ? ` ${status.reason}` : ""}` : "Preparing shaft indicators…"),
      soundStatus: () => flightAudio.getStatus(),
      afterburner: afterburnerProfile ? {
        accentColor: afterburnerProfile.accentColor,
        getActive: engineVisuals.afterburnerActive,
      } : undefined,
      parameters,
      testStand: {
        active: engineTest,
        description: getAircraftDefinition(initialAircraftId).engineAssets
          ? "Complete engine reconstruction on Earth at MSP runway 35; move it using Location. Use THR, VTOL and the normal start/stop control. Gas, core-facing metal and cooled nozzle histories use simulation time. Geometry and thermal coefficients are provisional."
          : getAircraftDefinition(initialAircraftId).engineTestNodeNames?.length
          ? "Stationary native engine test with the declared nozzle assembly isolated on Earth. Starts at MSP runway 35; move it using Location. The asset has no complete engine casing or internal turbine model. Use THR, VTOL and the normal start/stop control; plots below record simulation time."
          : "Stationary native engine test on Earth, starting at MSP runway 35. Move it using Location. This aircraft has no declared isolated engine geometry; the stand shows readings without an aircraft mesh.",
        onChange: active => {
          saveFlight();
          window.location.assign(makeEngineTestStandUrl(new URL(window.location.href), active).href);
        },
        initialization: { state: engineInitialState, onStart: state => {
          saveFlight();
          const next = makeEngineTestStandUrl(new URL(window.location.href), true, state);
          if (next.href === window.location.href) window.location.reload();
          else window.location.assign(next.href);
        } },
      },
      onOpen: () => controlPanel?.openOrSelectTab("engine"),
    },
  );
  if (!engineTest && hasWeaponStations()) {
    const host = hudRoot.querySelector<HTMLElement>(".flight-hud__armament");
    if (host) {
      host.hidden = false;
      host.closest<HTMLElement>(".flight-hud__yaw-throttle")?.setAttribute("data-armament", "true");
      armamentWidget = createArmamentWidget(host, {
        onSelectWeapon: selectWeapon,
        onCycle: cycleWeapon,
        onTrigger: held => {
          if (held && !armamentState()?.canFire) return;
          weaponTrigger.setUiHeld(held);
          runtime.requestRender();
        },
        onCancel: () => { cancelArmament(); refreshArmament(); },
        onMasterArm: setMasterArm,
        onOpen: () => controlPanel?.openOrSelectTab("armament"),
      });
    }
  }
  // Session-only debug opt-in: no overlay meshes or SDK reads until enabled.
  let collisionDebugEnabled = false;
  let collisionDebugOverlay: ReturnType<typeof createCollisionDebugOverlay> | null = null;
  let wheelSpinDebugOverlay: ReturnType<typeof createWheelSpinDebugOverlay> | null = null;
  let forcesDebugOverlay: ReturnType<typeof createForcesDebugOverlay> | null = null;
  const meshInspector = createMeshInspector(runtime.scene, { requestRender: () => runtime.requestRender() });
  meshInspector.setEnabled(parameters.get("osfs.aircraft.wireframe"));
  stopWatching.push(parameters.watch("osfs.aircraft.wireframe", enabled => meshInspector.setEnabled(enabled)));
  const readForcesSettings = () => ({
    enabled: parameters.get("osfs.forces.enabled"),
    newtonsPerMeter: parameters.get("osfs.forces.newtonsPerMeter"),
    maxArrowMeters: parameters.get("osfs.forces.maxArrowMeters"),
    labels: parameters.get("osfs.forces.labels"),
    labelRefreshHz: parameters.get("osfs.forces.labelRefreshHz"),
    controlSurfaces: parameters.get("osfs.forces.controlSurfaces"),
    newtonMetersPerDegree: parameters.get("osfs.forces.newtonMetersPerDegree"),
    arcRadiusMeters: parameters.get("osfs.forces.arcRadiusMeters"),
    maxArcDegrees: parameters.get("osfs.forces.maxArcDegrees"),
  });
  const syncForcesDebugOverlay = (): void => {
    const settings = readForcesSettings();
    if (!forcesDebugOverlay && aircraft && settings.enabled) {
      forcesDebugOverlay = createForcesDebugOverlay(runtime.scene, aircraft.root, jsbsim.sdk, {
        settings,
        engineLabels: getFdmProfile(initialAircraftId, engineModel ?? undefined).forceEngineLabels,
        controlSurfaces: getFdmProfile(initialAircraftId).forceControlSurfaces,
        externalForces: getFdmProfile(initialAircraftId, engineModel ?? undefined).forceExternalForces,
        requestRender: () => runtime.requestRender(),
        onUnavailable: message => flightLog.warn("forces", message),
      });
    } else forcesDebugOverlay?.setSettings(settings);
  };
  for (const id of ["osfs.forces.enabled", "osfs.forces.newtonsPerMeter", "osfs.forces.maxArrowMeters",
    "osfs.forces.labels", "osfs.forces.labelRefreshHz", "osfs.forces.controlSurfaces", "osfs.forces.newtonMetersPerDegree",
    "osfs.forces.arcRadiusMeters", "osfs.forces.maxArcDegrees"] as const) {
    stopWatching.push(parameters.watch(id, syncForcesDebugOverlay));
  }
  const syncCollisionDebugOverlay = (): void => {
    if (collisionDebugEnabled && aircraft && !collisionDebugOverlay) {
      collisionDebugOverlay = createCollisionDebugOverlay(runtime.scene, aircraft.root, jsbsim.sdk,
        getFdmProfile(initialAircraftId).bodyCollisionProbes);
    }
    collisionDebugOverlay?.setEnabled(collisionDebugEnabled);
    const showWheels = collisionDebugEnabled && wheelSpinMode !== "off";
    if (showWheels && aircraft && !wheelSpinDebugOverlay) {
      wheelSpinDebugOverlay = createWheelSpinDebugOverlay(runtime.scene, aircraft.root, jsbsim.sdk, wheelSpin.getStates);
    }
    wheelSpinDebugOverlay?.setEnabled(showWheels);
  };
  /** Applies the resolved settings plus any Debug override; boundary choices only change when applied. */
  const applyGroundRuntime = (): void => {
    groundResolution = resolveGroundInteraction(groundStore.settings, groundCapabilities, appliedGroundBoundary);
    const active = groundResolution.active;
    const nextMode = wheelExperiment.rotation ?? active.rotation;
    if (nextMode !== wheelSpinMode) {
      wheelSpinMode = nextMode;
      resetWheelSpin("mode");
    }
    const nextSound = wheelSpinMode !== "off" && (wheelExperiment.tireSound ?? active.tireAudio === "slip");
    if (nextSound !== tireSoundEnabled) {
      tireSoundEnabled = nextSound;
      tireAudio.setEnabled(nextSound);
    }
    tireAudio.setVolume(groundStore.settings.tireAudioVolume);
    const nextHaptics = wheelSpinMode !== "off" && active.haptics === "landing";
    if (nextHaptics !== hapticsActive) {
      hapticsActive = nextHaptics;
      haptics.setEnabled(nextHaptics);
    }
    haptics.setStrength(groundStore.settings.hapticStrength);
    syncCollisionDebugOverlay();
  };
  /** Paused, loading and reset states are safe boundaries for wheel/force/contact choices. */
  const applyGroundBoundary = (): void => {
    appliedGroundBoundary = boundaryOf(groundStore.settings);
    applyGroundRuntime();
  };
  applyGroundRuntime();
  // Show all parameters and imports change the ground parameters directly:
  // apply them the way the section's own controls are applied.
  const followGroundSettings = (): void => {
    if (inputManager.isPaused() || worldLoading) applyGroundBoundary();
    else applyGroundRuntime();
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
  };
  for (const id of GROUND_PARAMETER_IDS) stopWatching.push(parameters.watch(id, followGroundSettings));
  const aircraftId: AircraftId = initialAircraftId;
  setDroneRemovalSwitch((_modId, removedAircraftIds) => {
    if (removedAircraftIds.includes(aircraftId)) void session.onAircraftSwitch({ aircraftId: "cessna-172", lodId: "auto" });
  });
  let aircraftLodId: AircraftLodId = initialAircraftSelection.lodId;
  let aircraftGenerationId: string = initialAircraftSelection.generationId ?? getAircraftFamilyForAircraft(aircraftId).variants[0]?.id ?? "cessna-172";
  let aircraftSettingSwitchQueued = false;
  // Direct parameter controls and preset imports use the same complete-aircraft
  // activation as the gallery. Coalesce a batch so identity, generation and LOD
  // are read together, after all settings in the choice have been written.
  const followAircraftPresentation = (): void => {
    const next = readAircraftSelection(parameters);
    if (next.aircraftId !== aircraftId) {
      if (!aircraftSwitching && !aircraftSettingSwitchQueued) {
        aircraftSettingSwitchQueued = true;
        queueMicrotask(() => {
          aircraftSettingSwitchQueued = false;
          if (disposed || aircraftSwitching) return;
          const selection = readAircraftSelection(parameters);
          if (selection.aircraftId !== aircraftId) void session.onAircraftSwitch(selection, true);
        });
      }
      return;
    }
    const generationId = next.generationId ?? aircraftGenerationId;
    if (next.lodId === aircraftLodId && generationId === aircraftGenerationId) return;
    aircraftLodId = next.lodId;
    aircraftGenerationId = generationId;
    // The model asks for its own frames, and only when what it shows changes.
    aircraftModel?.setLod(next.lodId);
    if (aircraftModel) modelState = aircraftModel.getState();
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
  };
  for (const id of AIRCRAFT_SELECTION_PARAMETER_IDS) stopWatching.push(parameters.watch(id, followAircraftPresentation));

  let modelState: AircraftModelState = {
    aircraftId, lodId: aircraftLodId, activeLodId: null,
    status: "placeholder", triangles: null, error: null, download: null,
  };
  let hudBar: FlightHudBarHandle | null = null;
  let statusOverlay: FlightStatusOverlayHandle | null = null;
  // A missing terrain sample stops the loop from stepping without raising a
  // fault, so track how long that has been true to tell a stall from a hitch.
  let terrainBlockedSinceMs: number | null = null;
  let terrainBlockedReason: ReturnType<typeof terrainContact.getBlockReason> = null;
  /** The physics faults of this visit, for the bug report: a fault can clear before the report is made. */
  const faultHistory: { shown: string | null; last: string | null; atMs: number; count: number; impact: GroundImpact | null } = {
    shown: null, last: null, atMs: 0, count: 0, impact: null,
  };
  let inputMode = loadInputModePreference(new Set(["mouse", "trackpad"]));
  let inputSensitivity = loadInputSensitivityPreference();
  // FOSS Earth's orbit inversion, shared with the globe's camera.
  const orbitInvert = (): OrbitInvertSettings => ({
    invertYaw: settings.get<boolean>("input.orbit.invertYaw"),
    invertPitch: settings.get<boolean>("input.orbit.invertPitch"),
    recenterMode: settings.get<OrbitInvertSettings["recenterMode"]>("input.orbit.recenterMode"),
  });
  // The chase camera's orbit, in radians, from the osfs.camera.* parameters.
  const orbitPitchLimits = (): { min: number; max: number } => {
    const limits = parameters.get("osfs.camera.orbitPitchLimits");
    return { min: limits.min * RADIANS_PER_DEGREE, max: limits.max * RADIANS_PER_DEGREE };
  };
  const orbitRestoreYaw = (): number => parameters.get("osfs.camera.orbitRestoreYaw") * RADIANS_PER_DEGREE;
  const orbitRestorePitch = (): number =>
    Math.atan2(parameters.get("osfs.camera.chaseHeight"), parameters.get("osfs.camera.chaseDistance"));
  // The phone trackpad's A/B settings (Remote Control tab). Read live by the
  // phone session and each frame, so a change is felt on the next swipe.
  let phoneCameraTuning: PhoneCameraTuning = readPhoneCameraTuning(parameters);
  let phoneCameraVariant = describePhoneCameraTuning(phoneCameraTuning);
  for (const id of PHONE_CAMERA_PARAMETER_IDS) {
    stopWatching.push(parameters.watch(id, () => {
      phoneCameraTuning = readPhoneCameraTuning(parameters);
      phoneCameraVariant = describePhoneCameraTuning(phoneCameraTuning);
      runtime.requestRender();
    }));
  }
  // Who flies when a paired phone and this computer both could (Remote Control
  // tab). Read live by the phone session at every decision.
  let controlSharing: ControlSharing = readControlSharing(parameters);
  for (const id of CONTROL_SHARING_PARAMETER_IDS) {
    stopWatching.push(parameters.watch(id, () => {
      controlSharing = readControlSharing(parameters);
      phoneSession?.syncStatus();
    }));
  }
  // The phone controller's own settings (Remote Control tab): a paired phone
  // changes them over the link, and is told when they change here.
  for (const id of PHONE_CONTROLLER_PARAMETER_IDS) {
    stopWatching.push(parameters.watch(id, () => phoneSession?.syncPhoneSettings()));
  }
  // A paused flight draws only on request: one for the phone's attitude indicator as it is turned on.
  stopWatching.push(parameters.watch("osfs.phone.attitude", () => runtime.requestRender()));
  // Remote Control → Shared controls → Flight UI on this computer while a phone
  // is connected: off, the phone has the instruments and controls, and this
  // screen the view, the toolbar and the windows — until the phone stops
  // answering, or a key is pressed here.
  const hostFlightUi = createHostFlightUi({
    isConnected: () => phoneSession?.isConnected() ?? false,
    isPhoneQuiet: () => phoneSession?.getSnapshot().quiet ?? false,
    isShownWithPhone: () => parameters.get("osfs.remote.hostFlightUi"),
    onChange: hidden => {
      if (hidden) cancelArmament();
      flightHud.setHidden(hidden);
      // A HUD shown again catches up, and a phone just connected gets its first
      // attitude, at the next frame, which a paused flight draws only on request.
      runtime.requestRender();
    },
  });
  stopWatching.push(parameters.watch("osfs.remote.hostFlightUi", hostFlightUi.noteSettingChanged));
  const cameraFollow = createCameraFollow();
  let chaseFrameApplied: PhoneCameraTuning["chaseFrame"] = "aircraft";
  let orbitStateYaw = orbitRestoreYaw();
  let orbitStatePitch = orbitRestorePitch();
  type OrbitInputSource = "gamepad" | "manual" | "phone" | "glide";
  const orbitInputSources = new Set<OrbitInputSource>();
  const setOrbitInputActive = (source: OrbitInputSource, active: boolean): void => {
    if (active) { orbitInputSources.add(source); arrivalCamera?.takeover(); }
    else orbitInputSources.delete(source);
  };
  const isOrbitInputActive = (): boolean => orbitInputSources.size > 0;
  const applyOrbitDelta = (yaw: number, pitch: number): void => {
    if (arrivalCamera?.orbit(yaw, pitch)) return;
    if (!aircraft || aircraft.getViewMode() !== "third") return;
    orbitStateYaw = normalizeAngle(orbitStateYaw + yaw);
    const limits = orbitPitchLimits();
    orbitStatePitch = clamp(orbitStatePitch + pitch, limits.min, limits.max);
    aircraft.orbitChaseCamera(yaw, pitch);
    runtime.requestRender();
  };
  const applyCameraZoom = (factor: number): void => {
    if (arrivalCamera?.zoom(factor)) return;
    if (!aircraft || aircraft.getViewMode() !== "third") return;
    aircraft.zoomChaseCamera(factor);
    aircraftModel?.refreshAutoLod();
    runtime.requestRender();
  };
  /**
   * FOSS Earth's camera glide, Aircraft → Camera → Glide here (`camera.inertiaDecay`):
   * the chase camera eases into a zoom, and a pinch or a phone swipe glides on
   * after the fingers lift. One for this computer's gestures and one for the
   * phone's, so a finger landing on either stops only its own.
   */
  const glideOptions = {
    decay: () => settings.has("camera.inertiaDecay") ? settings.get<number>("camera.inertiaDecay") : DEFAULT_GLIDE_DECAY,
    orbit: applyOrbitDelta,
    zoom: applyCameraZoom,
    wake: () => runtime.requestRender(),
  };
  const localGlide = createCameraGlide(glideOptions);
  const phoneGlide = createCameraGlide(glideOptions);
  const phonePad = createTouchSurfaceGlide(phoneGlide);
  /**
   * The phone controller's camera trackpad. It sends what the fingers did —
   * a swipe as a fraction of the pad, a pinch as a spread ratio — so this is a
   * one-to-one gesture like the mouse drag, not something integrated over time.
   * A full-pad swipe is a little over a third of a turn before sensitivity.
   */
  const applyPhoneCameraAim = (): CameraAim | null => {
    setOrbitInputActive("phone", phoneSession?.isCameraActive() ?? false);
    const aim = phoneSession?.takeCameraAim() ?? null;
    // Deliberately not the desktop's pointer sensitivity: that setting belongs
    // to a mouse or a laptop trackpad, and a phone is neither.
    const inversion = orbitInvert();
    // Every frame, moving or not: fingers lifting glide the gesture on, and one landing stops it.
    phonePad.frame({
      fingers: phoneSession?.cameraFingers() ?? null,
      yaw: (aim?.yaw ?? 0) * PHONE_SWIPE_RADIANS * (inversion.invertYaw ? -1 : 1),
      pitch: (aim?.pitch ?? 0) * PHONE_SWIPE_RADIANS * (inversion.invertPitch ? -1 : 1),
      // A pinch apart brings the aircraft closer, which is a smaller distance.
      zoom: aim?.zoom !== undefined && aim.zoom !== 1 ? 1 / aim.zoom : 1,
    });
    return aim;
  };
  const applyChaseFrame = (state: FlightState, dt: number): void => {
    const frame = phoneCameraTuning.chaseFrame;
    if (!aircraft || (frame === "aircraft" && chaseFrameApplied === "aircraft")) return;
    chaseFrameApplied = frame;
    aircraft.setChaseFrame(cameraFollow.update(frame, state, dt, parameters.get("osfs.camera.yawSpringTime")));
    if (aircraft.getViewMode() === "third" && cameraFollow.isActive()) runtime.requestRender();
  };
  const recenterOrbit = (deltaSeconds: number): void => {
    if (!aircraft || aircraft.getViewMode() !== "third") return;
    if (deltaSeconds <= 0) return;
    if (orbitInvert().recenterMode !== "recenter") return;
    if (isOrbitInputActive()) return;
    const targetYaw = orbitRestoreYaw();
    const targetPitch = orbitRestorePitch();
    const deltaYaw = -normalizeAngle(orbitStateYaw - targetYaw);
    const deltaPitch = targetPitch - orbitStatePitch;
    if (Math.abs(deltaYaw) <= 0.00005 && Math.abs(deltaPitch) <= 0.00005) return;
    const returnSeconds = parameters.get("osfs.camera.orbitReturnTime");
    const nextYaw = approach(orbitStateYaw, targetYaw, deltaSeconds, returnSeconds);
    const nextPitch = approach(orbitStatePitch, targetPitch, deltaSeconds, returnSeconds);
    applyOrbitDelta(nextYaw - orbitStateYaw, nextPitch - orbitStatePitch);
  };
  const detachCameraInput = attachFlightCameraInput(canvas, {
    getMode: () => inputMode,
    getSensitivity: () => inputSensitivity,
    getOrbitInvert: orbitInvert,
    orbit: (yaw, pitch) => {
      applyOrbitDelta(yaw, pitch);
    },
    onOrbitActive: (active) => setOrbitInputActive("manual", active),
    zoom: factor => localGlide.zoom(factor),
    glide: localGlide,
    getTouchWheelCooldownMs: () => parameters.get("osfs.input.touchWheelCooldown"),
  });
  // The Cockpit view looks around as a FOSS Earth 360 photograph does; the chase input above acts only outside it.
  const cockpitLook = createCockpitLook({
    canvas,
    aircraft: () => aircraft,
    fieldOfViewDeg: () => parameters.get("osfs.camera.fieldOfView"),
    inputMode: () => inputMode,
    requestRender: () => runtime.requestRender(),
    now: () => performance.now(),
  });
  // The cockpit's touchscreen shows the page's interface, as the chase view does.
  const cockpitScreen = createCockpitScreen({
    scene: runtime.scene,
    document: rootElement.ownerDocument,
    canvas,
    aircraft: () => aircraft,
    settings: () => ({
      content: parameters.get("osfs.cockpit.screen.content"),
      background: parameters.get("osfs.cockpit.screen.background"),
      places: {
        instruments: parameters.get("osfs.cockpit.screen.instruments"),
        toolbar: parameters.get("osfs.cockpit.screen.toolbar"),
        windows: parameters.get("osfs.cockpit.screen.windows"),
      },
      refreshRateHz: parameters.get("osfs.cockpit.screen.refreshRate"),
      resolutionPx: parameters.get("osfs.cockpit.screen.resolution"),
    }),
    parts: { instruments: FLIGHT_INSTRUMENTS, toolbar: ".flight-shell-root", windows: ".flight-panel-root" },
    never: FLIGHT_NEVER_MIRRORED,
    viewHolders: ".flight-app",
    requestRender: () => runtime.requestRender(),
    now: () => performance.now(),
  });
  for (const id of ["content", "background", "instruments", "toolbar", "windows", "refreshRate", "resolution"] as const) {
    stopWatching.push(parameters.watch(`osfs.cockpit.screen.${id}`, () => cockpitScreen.refresh()));
  }
  // A VR headset seats the pilot in the cockpit, the space turning with the
  // aircraft. The interface is on the cockpit's touchscreen, as in the cockpit
  // view; the parts placed in the HUD are on panels around the head instead.
  const headsetFrames = headsetFramesOf(runtime);
  const cockpitSurface: HeadsetSurface = {
    id: "cockpit-screen",
    hit: (origin, direction) => cockpitScreen.hit(origin, direction),
    locate: page => cockpitScreen.locate(page.x, page.y),
  };
  const headset = headsetFrames ? createHeadsetSession({
    scene: runtime.scene, frames: headsetFrames, navigator: window.navigator,
    holdRendering() {
      runtime.beginContinuous();
      let released = false;
      return () => { if (!released) { released = true; runtime.endContinuous(); } };
    },
    requestRender: () => runtime.requestRender(),
    place() {
      if (!aircraft) return null;
      const seat = aircraft.cockpit.computeWorldMatrix(true);
      // The cockpit camera is the pilot's eye, placed in the cockpit.
      const eye = Vector3.TransformCoordinates(aircraft.firstPersonCamera.position, seat);
      // At rest the cockpit camera faces the nose: half a turn from its own look, which is −z in a right-handed scene.
      const forward = Vector3.TransformNormal(new Vector3(0, 0, runtime.scene.useRightHandedSystem ? 1 : -1), seat).normalize();
      const up = Vector3.TransformNormal(Vector3.Up(), seat).normalize();
      return { position: [eye.x, eye.y, eye.z], forward: [forward.x, forward.y, forward.z], up: [up.x, up.y, up.z] };
    },
    globeCamera: () => aircraft?.firstPersonCamera ?? null,
    ui: {
      document: rootElement.ownerDocument,
      selectors: { toolbar: ".flight-shell-root .hud-bar", instruments: FLIGHT_INSTRUMENTS },
      never: FLIGHT_NEVER_MIRRORED,
      seeThrough: ".flight-app",
      parts() {
        // The aircraft's own picture on its screen leaves every part to the HUD.
        const onScreen = cockpitScreen.showsInterface();
        const inHud = (part: CockpitScreenPart): boolean => !onScreen || parameters.get(`osfs.cockpit.screen.${part}`) === "hud";
        return { toolbar: inHud("toolbar"), windows: inHud("windows"), instruments: inHud("instruments") };
      },
      surfaces: () => [cockpitSurface],
    },
    report: (message, error) => flightLog.warn("vr", message, { error: error instanceof Error ? error.message : String(error ?? "") }),
  }) : null;
  // The headset is in the cockpit: the view comes back to what it was after.
  let viewBeforeHeadset: "first" | "third" | null = null;
  const offHeadsetView = headset?.subscribe(() => {
    const seated = headset.state === "starting" || headset.state === "presenting";
    if (seated && viewBeforeHeadset === null && aircraft) {
      viewBeforeHeadset = aircraft.getViewMode();
      aircraft.setViewMode("first");
    } else if (!seated && viewBeforeHeadset !== null) {
      aircraft?.setViewMode(viewBeforeHeadset);
      viewBeforeHeadset = null;
    }
    runtime.requestRender();
  });
  const headsetPanel = headset ? createHeadsetPanel(rootElement.ownerDocument, headset, {
    about: "Fly from the cockpit in a VR headset. The interface is on the cockpit's screen; Aircraft → Cockpit screen moves its parts to panels around you.",
    controls: FLIGHT_HEADSET_CONTROLS,
  }) : null;
  stopWatching.push(() => { offHeadsetView?.(); headsetPanel?.destroy(); headset?.dispose(); });
  let skipResumeDelta = false;
  let disposed = false;
  let lastPanelUpdateMs = 0;
  let fpsSampleStartedMs = performance.now();
  let fpsSampleFrames = 0;
  let measuredFps: number | null = null;
  const weather: FlightWeatherState = { ...(session.resume?.weather ?? { windDirectionDeg: 0, windSpeedKts: 0 }) };

  loading.setPhase("assets", { state: "loading", detail: "Loading your aircraft" });
  // The placeholder blocks stand in only when there is no mesh to show: none
  // exists for the airframe, or it failed to load. While a chosen mesh loads
  // nothing stands in, and the log carries its progress.
  let blocksStandIn: boolean | null = null;
  const onModelState = (state: AircraftModelState): void => {
    modelState = state;
    const standIn = state.status === "placeholder" || state.status === "error";
    if (standIn !== blocksStandIn) {
      blocksStandIn = standIn;
      aircraft?.setModelLoaded(engineTest || !standIn);
      runtime.requestRender();
    }
    const download = state.download;
    if (state.status === "loading" && download?.chosen) {
      const label = getAircraftDefinition(state.aircraftId).lods.find(lod => lod.id === download.lodId)?.label ?? download.lodId;
      const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);
      loading.setPhase("assets", {
        state: "loading",
        detail: download.total ? `Loading ${label}, ${megabytes(download.loaded)} of ${megabytes(download.total)} MB` : `Loading ${label}`,
        progress: download.total ? download.loaded / download.total : null,
      });
    } else if (state.status === "ready") {
      loading.setPhase("assets", { state: "ready" });
    } else if (state.status === "placeholder") {
      // The placeholder is a complete, flyable aircraft. A visual mesh should
      // never keep a safely prepared flight from starting.
      loading.setPhase("assets", { state: "ready", detail: "Using the flight-ready fallback aircraft" });
    } else if (state.status === "error") {
      loading.setPhase("assets", { state: "ready", detail: "Aircraft mesh unavailable; using the flight-ready fallback" });
    }
  };
  const mountFlightWorld = (): void => {
    const worldRoot = runtime.getWorldRoot();
    if (!worldRoot || floatingOrigin) return;

    floatingOrigin = createFloatingOrigin(runtime.scene, worldRoot);
    flightCompass = createFlightCompass(runtime.scene, floatingOrigin, document, () => runtime.requestRender());
    floatingOrigin.aircraftRoot.setEnabled(false);
    const definition = getAircraftDefinition(aircraftId);
    aircraft = createPlaceholderAircraft(runtime.scene, floatingOrigin.aircraftRoot, parameters, {
      cockpitOffset: definition.cockpitOffset,
      showModelInCockpit: definition.cockpitMesh,
      ...(engineTest ? {
        chaseTargetOffset: definition.engineTestFocusOffset,
        chaseDistanceMeters: parameters.get("osfs.engineTest.viewDistanceMeters"),
        chaseZoomLimits: () => parameters.get("osfs.engineTest.zoomLimits"),
      } : {}),
    });
    markParametersApplied(settings, ["osfs.camera.chaseDistance", "osfs.camera.chaseHeight", "osfs.camera.chaseZoomLimits", "osfs.camera.nearClipMeters"]);
    if (engineTest) aircraft.setModelLoaded(true);
    aircraft.setViewMode(session.resume?.viewMode ?? "third");
    const externalTanks = getExternalTankDefinitions(aircraftId);
    if (!engineTest && externalTanks.length > 0) {
      externalTankVisuals = createExternalTankVisuals(runtime.scene, aircraft.modelRoot, externalTanks, {
        requestRender: () => runtime.requestRender(),
        getWorldFromEcef: () => floatingOrigin?.getWorldFromEcef() ?? null,
        lifetimeSeconds: parameters.get("osfs.externalTanks.debrisLifetimeSeconds"),
        maxDetachedTanks: parameters.get("osfs.externalTanks.maxDetachedTanks"),
      });
      externalTankVisuals.sync(readExternalFuelTanks(jsbsim.sdk, aircraftId));
      void externalTankVisuals.ready.catch((error: unknown) => {
        if (!disposed) flightLog.warn("aircraft", "External tank models could not be prepared", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }
    if (!engineTest && hasWeaponStations()) {
      storeMirror = readStoreMirror(jsbsim.sdk);
      selectedWeaponKey ??= initialWeapon(storeMirror.load, storeMirror.gunRounds);
      storeVisuals = createStoreVisuals(runtime.scene, aircraft.modelRoot, {
        requestRender: () => runtime.requestRender(),
        getWorldFromEcef: () => floatingOrigin?.getWorldFromEcef() ?? null,
        lifetimeSeconds: parameters.get("osfs.stores.debrisLifetimeSeconds"),
        maxDetachedStores: parameters.get("osfs.stores.maxDetachedStores"),
      });
      storeVisuals.sync(storeMirror);
      doorsSettled = false;
      bayInterlock = createBayGearInterlock(jsbsim.sdk, (bay, cmd) => {
        if (!storeMirror) return;
        const bayCmd: [number, number] = [storeMirror.bayCmd[0], storeMirror.bayCmd[1]];
        bayCmd[bay] = cmd;
        storeMirror = { ...storeMirror, bayCmd };
        doorsSettled = false;
      });
    }
    const limits = orbitPitchLimits();
    orbitStateYaw = orbitRestoreYaw();
    orbitStatePitch = engineTest ? orbitRestorePitch() : Math.asin(
      clamp(aircraft.thirdPersonCamera.position.y / aircraft.thirdPersonCamera.position.length(), limits.min, limits.max),
    );
    syncCollisionDebugOverlay();
    aircraftModel = createAircraftModel(runtime.scene, aircraft.modelRoot, {
      aircraftId,
      lodId: aircraftLodId,
      renderStowedGear: parameters.get("osfs.debug.renderStowedGear"),
      windowTint: parameters.get("osfs.aircraft.windowTint"),
      engineOnly: engineTest,
      loadContainer: loadOverriddenContainer,
      // The weapon-bay doors are cut from the airframe's own belly, once per load.
      prepareModel: storeVisuals ? airframe => {
        try {
          return storeVisuals?.fitAirframe(airframe) ?? null;
        } catch (error) {
          flightLog.warn("aircraft", "The weapon-bay doors could not be fitted; the belly stays closed", {
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      } : undefined,
      onMeshRootsChange: roots => {
        const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const root of roots) {
          const bounds = root.getHierarchyBoundingVectors(true);
          min.minimizeInPlace(bounds.min); max.maximizeInPlace(bounds.max);
        }
        const radius = Vector3.Distance(min, max) / 2;
        if (Number.isFinite(radius) && radius > 0) {
          aircraftBodyRadius = Math.max(aircraftBodyRadius, radius);
          regionPreparation.setBodyRadius(aircraftBodyRadius);
        }
        meshInspector.setRoots(roots);
        cockpitScreen.setModel(roots, definition.screenMaterialNames ?? []);
      },
      getChaseDistanceMeters: () => aircraft?.getChaseDistanceMeters() ?? 0,
      onStateChange: (state) => {
        onModelState(state);
        if (controlPanel) controlPanel.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      },
      requestRender: () => runtime.requestRender(),
    });
    aircraftModel.updateGearVisibility(readControlSurfaceState(jsbsim.sdk, aircraftId).gearDownNorm);
    syncForcesDebugOverlay();
    if (!engineTest) {
      // Its lights, against the sky's exposure, and its beams on the ground; the ground's light is measured from it.
      const lightedAircraft = aircraft;
      aircraftLights = createAircraftLights({
        scene: runtime.scene,
        parent: lightedAircraft.modelRoot,
        aircraftId,
        modelOffset: definition.modelOffset,
        getSettings: readLightSettings,
        getWhiteLuminance: skyWhiteLuminance,
        setGroundLights: lights => runtime.sky.setGroundLights(lights),
        getGearDownNorm: () => readGearDownNorm(jsbsim.sdk),
        // Paused or loading, the render loop is idle: the flashes hold and ask for no frames.
        isRunning: () => !inputManager.isPaused() && !worldLoading,
        requestRender: () => runtime.requestRender(),
      });
      runtime.sky.setGroundLightReceiver(() => lightedAircraft.modelRoot.getAbsolutePosition());
    }

    onModelState(aircraftModel.getState());
    const initialState = readFlightState(jsbsim.sdk);
    floatingOrigin.apply(initialState);
    runtime.setSimViewState({
      latDeg: initialState.latDeg,
      lonDeg: initialState.lonDeg,
      zoomMeters: zoomMetersFromAltitude(initialState.altMeters),
      headingDeg: (initialState.headingRad * 180) / Math.PI,
    });
  };

  stopWatching.push(parameters.watch("osfs.debug.renderStowedGear", enabled => {
    aircraftModel?.setRenderStowedGear(enabled);
  }));
  stopWatching.push(parameters.watch("osfs.aircraft.windowTint", fraction => {
    aircraftModel?.setWindowTint(fraction);
  }));

  stopWatching.push(parameters.watch("osfs.camera.fieldOfView", degrees => {
    aircraft?.setFieldOfView(degrees);
    cockpitLook.setFieldOfView(degrees);
    runtime.requestRender();
  }));
  stopWatching.push(parameters.watch("osfs.camera.nearClipMeters", meters => {
    aircraft?.setNearClipMeters(meters);
    runtime.requestRender();
  }));

  const startArrivalCamera = (preview: FlightState): void => {
    if (engineTest || session.switching) return;
    mountFlightWorld();
    if (!aircraft || !floatingOrigin || !runtime.scene.onBeforeRenderObservable) return;
    const target = aircraft.getViewMode() === "first" ? aircraft.firstPersonCamera : aircraft.thirdPersonCamera;
    if (typeof target.getWorldMatrix !== "function") return;
    arrivalCamera?.dispose();
    floatingOrigin.apply(preview);
    arrivalCamera = createLoadingCamera({ scene: runtime.scene, target,
      anchor: floatingOrigin.aircraftRoot.getAbsolutePosition(), up: Vector3.Up(),
      requestRender: () => runtime.requestRender(),
      beginContinuous: () => runtime.beginContinuous(), endContinuous: () => runtime.endContinuous(),
      // It comes down once the pilot has let the camera go.
      isGestureActive: isOrbitInputActive,
      reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
    const progress = regionPreparation.read();
    if (progress) arrivalCamera.update(progress);
  };
  previewPlacement = preview => { if (worldLoading) floatingOrigin?.apply(preview); };
  const finishArrivalForOverride = (overridden: boolean): void => {
    if (overridden) arrivalCamera?.update({ minimumReady: true, finalReady: true, estimatedRemainingMs: 0 });
  };
  const waitForArrival = async (signal: AbortSignal): Promise<void> => {
    while (arrivalCamera && !arrivalCamera.isFinished()) {
      if (disposed || signal.aborted) throw new DOMException("Placement cancelled.", "AbortError");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };

  const toggleCameraView = (): void => {
    if (engineTest) return;
    arrivalCamera?.dispose(); arrivalCamera = null;
    aircraft?.toggleViewMode();
    runtime.requestRender();
  };

  const onViewKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "KeyV" || event.repeat) return;
    if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
    if (controlTakesKey(event.target, event.key)) return;
    if (inputManager.isBindingCaptureActive() || inputManager.isGamepadToolsActive()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    toggleCameraView();
    phoneSession?.syncStatus();
  };

  // Capture, like the flight keys, so a Ctrl chord with V is not handed on by
  // an embedding browser's own window listener.
  window.addEventListener("keydown", onViewKeyDown, { capture: true });
  window.addEventListener("keydown", hostFlightUi.noteKey, { capture: true });
  // A key held in another window must not become a new trigger through auto-repeat on return.
  const onFocusKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) focusedKeys.add(event.code);
    else if (!focusedKeys.has(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onFocusKeyUp = (event: KeyboardEvent): void => { focusedKeys.delete(event.code); };
  window.addEventListener("keydown", onFocusKeyDown, { capture: true });
  window.addEventListener("keyup", onFocusKeyUp, { capture: true });

  const flightGamepadSource = createBrowserInputSource({ target: window });
  const flightGamepadResponse = inputManager.getGamepadResponseController();
  const flightGamepadRuntime = new BindingRuntime({
    defaultAxisDeadzone: parameters.get("osfs.input.stickDeadzone"),
    getAxisDeadzoneMode: () => flightGamepadResponse.getSettings().deadzoneMode,
    adapter: createFlightGamepadAdapter(inputManager, {
      onWeaponNext: () => cycleWeapon(1),
      onViewToggle: () => {
        toggleCameraView();
        phoneSession?.syncStatus();
      },
      onCameraOrbitActive: (active) => {
        setOrbitInputActive("gamepad", active);
        if (!active) cockpitLook.setStick(0, 0);
      },
      onCameraOrbit: (yaw, pitch, dt) => {
        // The camera stick moves the chase camera around the aircraft, so pushed right its yaw is negative.
        // In the cockpit it looks the way it is pushed, as in a photograph.
        if (aircraft?.getViewMode() === "first") {
          cockpitLook.setStick(-yaw, pitch);
          return;
        }
        const inversion = orbitInvert();
        applyOrbitDelta(
          yaw * dt * parameters.get("osfs.camera.gamepadOrbitYawRate") * RADIANS_PER_DEGREE * (inversion.invertYaw ? -1 : 1),
          pitch * dt * parameters.get("osfs.camera.gamepadOrbitPitchRate") * RADIANS_PER_DEGREE * (inversion.invertPitch ? -1 : 1),
        );
      },
    }),
    profile: withKeyboardAxes(createStandardFlightProfile(flightGamepadSource.getSelectedDevice()?.slot ?? 0, parameters.get("osfs.input.stickDeadzone")), readKeyboardAxes(parameters), climbRateControls),
  });
  let previousKeyboardAxes = readKeyboardAxes(parameters);
  for (const axis of KEYBOARD_AXES) stopWatching.push(parameters.watch(keyboardAxisParameterId(axis), () => {
    const next = readKeyboardAxes(parameters);
    const oldPair = previousKeyboardAxes[axis];
    previousKeyboardAxes = next;
    const displaced = KEYBOARD_AXES.find(other => other !== axis && next[axis] !== "none" && next[other] === next[axis]);
    if (displaced) parameters.set(keyboardAxisParameterId(displaced), oldPair);
    flightGamepadRuntime.setProfile(withKeyboardAxes(flightGamepadRuntime.getProfile(), readKeyboardAxes(parameters), climbRateControls));
    inputManager.setGamepadToolsActive(false);
    inputManager.setGamepadToolsActive(true);
    flightGamepadSource.tick();
  }));
  const flightGamepadStore = createProfileStore();
  inputManager.setGamepadToolsActive(true);
  const detachGamepadProfileInput = flightGamepadSource.subscribe((frame) => {
    inputManager.setSelectedGamepadSlot(flightGamepadSource.getSelectedDevice()?.slot ?? 0);
    flightGamepadRuntime.dispatch(frame);
  });
  // The flight step owns active-flight sampling. Poll separately only while
  // it is idle so controller pause/resume and binding capture still work.
  flightGamepadSource.start({
    useAnimationFrame: true,
    shouldPoll: flightGamepadPolling.claimIdleFrame,
  });
  let flightBindingSignature = JSON.stringify(flightGamepadRuntime.getProfile().bindings);
  const gamepadBindings = {
    mount(root: HTMLElement): { destroy(): void } {
      return mountBindingEditor({
        root,
        runtime: flightGamepadRuntime,
        source: flightGamepadSource,
        store: flightGamepadStore,
        builtInProfiles: [
          {
            id: "legacy",
            label: "Classic",
            previousNames: ["Legacy 0sfs compatibility"],
            create: () => withKeyboardAxes(createLegacyFlightProfile(inputManager.getSelectedGamepadSlot(), parameters.get("osfs.input.stickDeadzone")), readKeyboardAxes(parameters), climbRateControls),
          },
          {
            id: "standard",
            label: "Xbox",
            previousNames: ["Standard Xbox / PlayStation flight"],
            create: () => withKeyboardAxes(createStandardFlightProfile(inputManager.getSelectedGamepadSlot(), parameters.get("osfs.input.stickDeadzone")), readKeyboardAxes(parameters), climbRateControls),
          },
        ],
        // FOSS Earth's tiny circular reset, on a control away from its default.
        attachReset: (control, { label, reset }) => { attachResetButton(document, control, { label: () => label, shown: () => true, reset }); },
        onProfileChange: (profile) => {
          const mapped = withKeyboardAxes(withWeaponNextDefaults(profile), readKeyboardAxes(parameters), climbRateControls);
          const signature = JSON.stringify(mapped.bindings);
          if (JSON.stringify(profile.bindings) !== signature) flightGamepadRuntime.setProfile(mapped);
          if (signature === flightBindingSignature) return;
          flightBindingSignature = signature;
          inputManager.setGamepadToolsActive(false);
          inputManager.setGamepadToolsActive(true);
          // Prime neutral/held inputs at the switch so the next movement
          // reaches the next flight step, without a first-input wait.
          flightGamepadSource.tick();
        },
      });
    },
  };

  mountFlightWorld();
  const initialState = readFlightState(jsbsim.sdk);
  const describeWheelExperiment = (): string | null => {
    const parts: string[] = [];
    if (wheelExperiment.rotation !== null) parts.push(`wheel response ${GROUND_CHOICE_LABELS.rotation[wheelExperiment.rotation]}`);
    if (wheelExperiment.tireSound !== null) parts.push(`tire sound ${wheelExperiment.tireSound ? "on" : "off"}`);
    return parts.length > 0 ? parts.join(", ") : null;
  };
  const handleGroundAction = (action: GroundInteractionAction): void => {
    groundMessage = null;
    const safeBoundary = inputManager.isPaused() || worldLoading;
    const commit = (settings: GroundInteractionSettingsV1) => {
      groundStore.set(settings);
      if (safeBoundary) applyGroundBoundary();
      else applyGroundRuntime();
    };
    const report = (error: string | null, success: string) => {
      groundMessage = error ? { text: error, error: true } : { text: success, error: false };
    };
    switch (action.type) {
      case "set": commit(patchGroundSettings(groundStore.settings, action.patch)); break;
      case "lock":
        commit(patchGroundSettings(groundStore.settings, { locked: { ...groundStore.settings.locked, [action.key]: action.locked } }));
        break;
      case "keep-experiment": {
        const patch: Partial<GroundInteractionSettingsV1> = {};
        if (wheelExperiment.rotation !== null) patch.rotation = wheelExperiment.rotation;
        if (wheelExperiment.tireSound !== null) patch.tireAudio = wheelExperiment.tireSound ? "slip" : "off";
        groundStore.set(patchGroundSettings(groundStore.settings, patch));
        // Already running, so keeping it is not a mid-flight change.
        if (wheelExperiment.rotation !== null) appliedGroundBoundary = { ...appliedGroundBoundary, rotation: wheelExperiment.rotation };
        wheelExperiment = { rotation: null, tireSound: null };
        applyGroundRuntime();
        report(null, "Experiment choices saved to Ground interaction.");
        break;
      }
      case "discard-experiment":
        wheelExperiment = { rotation: null, tireSound: null };
        applyGroundRuntime();
        break;
    }
  };
  // The flight in progress, saved for the next session to resume: every
  // osfs.start.saveInterval seconds of flight, on pause, after a placement,
  // and when the page is hidden or left. A faulted or loading flight is not
  // one to come back to, so the previous save stands.
  let savingFlight = true;
  let flightSaveRefused = false;
  let lastSavedFlight: SavedFlight | null = resumeFlight;
  let secondsSinceSave = 0;
  const saveFlight = (): void => {
    secondsSinceSave = 0;
    if (benchmarkRoute || engineTest || !savingFlight || worldLoading || physicsLoop.getFault() || !parameters.get("osfs.start.resume")) return;
    const flight = captureSavedFlight(jsbsim.sdk, aircraftId, inputManager.isPaused());
    if (!flight) return;
    if (savedFlights.write(flight)) {
      lastSavedFlight = flight;
      flightSaveRefused = false;
    } else if (!flightSaveRefused) {
      flightSaveRefused = true;
      flightLog.warn("sim", "The flight could not be saved: the browser refused its storage. The next session starts at the start position.");
    }
  };
  /** Discards the saved flight and reloads, so the flight starts again at the start position. */
  const startNewFlight = (): void => {
    if (engineTest) { window.location.reload(); return; }
    externalTankVisuals?.resetDetached();
    storeVisuals?.resetDetached();
    savingFlight = false;
    savedFlights.clear();
    lastSavedFlight = null;
    try {
      window.location.reload();
    } catch {
      savingFlight = true;
    }
  };
  stopWatching.push(parameters.watch("osfs.start.resume", resume => {
    if (engineTest) return;
    if (resume) {
      saveFlight();
    } else {
      savedFlights.clear();
      lastSavedFlight = null;
    }
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
  }));
  const createPanelSnapshot = (flightState = initialState): FlightControlPanelSnapshot => {
    const tanks = readFuelTanks(jsbsim.sdk);
    const groundOnly = parameters.get(REARM_GROUND_ONLY);
    // The wheels matter to the Fuel tab only when rearm is ground only.
    const onGround = groundOnly ? aircraftOnGround() : undefined;
    return {
      flightState,
      fps: runtime.engine.getFps(),
      paused: displayPaused(),
      aircraftSwitching,
      savedFlight: lastSavedFlight === null ? null : {
        savedAtMs: lastSavedFlight.savedAtMs, latDeg: lastSavedFlight.latDeg, lonDeg: lastSavedFlight.lonDeg,
      },
      viewMode: aircraft?.getViewMode() ?? "third",
      runtimeStatus: { ...runtime.status },
      rendererMode: runtime.renderer.mode,
      aircraftId,
      generationId: aircraftGenerationId,
      lodId: aircraftLodId,
      modelStatus: modelState.status,
      modelActiveLodId: modelState.activeLodId,
      modelTriangles: modelState.triangles,
      modelError: modelState.error,
      collisionDebugEnabled,
      collisionLegend: collisionDebugEnabled ? collisionDebugOverlay?.legend() ?? null : null,
      wheelSpinMode,
      tireSoundEnabled,
      tireAudioStatus: tireAudio.getStatus(),
      sound: flightAudio.getStatus(),
      wheelSpinStates: wheelSpinMode === "off" ? [] : wheelSpin.getStates().map(wheel => ({ ...wheel })),
      groundInteraction: {
        settings: groundStore.settings,
        resolution: groundResolution,
        capabilities: groundCapabilities,
        readOnlyReason: groundStore.readOnlyReason,
        message: groundMessage,
        experimentOverride: describeWheelExperiment(),
        hapticDevices: {
          gamepad: gamepadHaptics.describe(),
          phone: phoneSession ? "Uses the phone's Haptics switch where its browser supports vibration" : "Not paired",
        },
      },
      autopilot: {
        settings: autopilotSettings,
        engaged: lastApResult.engaged,
        owners: lastApResult.owners,
        ardupilot: ardupilotStatus,
        blockedReason: autopilotBlockReason(),
        readOnlyReason: autopilotStore.readOnlyReason,
      },
      fuel: { familyId: getAircraftFamilyForAircraft(aircraftId).id, tanks, groundOnly, onGround },
      armament: storeMirror ? {
        load: storeMirror.load,
        groundOnly,
        onGround: onGround ?? aircraftOnGround(),
        masterArm: storeMirror.masterArm,
        bayCmd: storeMirror.bayCmd,
        bayPos: storeMirror.bayPos,
        bayQueued: [bayInterlock?.queued(0) ?? false, bayInterlock?.queued(1) ?? false],
        tankOnStation: attachedTankStations(tanks.flatMap(tank => tank.attached ? [tank.index] : [])),
        selectedStation: weaponStation(storeMirror.load, selectedWeaponKey),
        selectedWeaponKey,
      } : undefined,
      logging: loggingSnapshot(),
      damage: damage.snapshot(),
      sharedSettings: { ...sharedSettingsState, values: { ...sharedSettingsState.values } },
    };
  };

  /** Back to the last valid pre-fault state, with terrain contact judging the ground afresh. */
  const recoverFromFault = (): void => {
    wakeFromRest("recovery");
    try {
      physicsLoop.reset();
    } catch (error) {
      // A failed reset is exactly the case where the aircraft cannot be
      // recovered without repositioning.
      flightLog.error("sim", "Resume failed: physics could not be reset", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    terrainContact.reset();
    visibleMeshCollision.reset();
    resetWheelSpin("fault");
  };
  /**
   * Something can move a resting aircraft again: step physics and draw frames
   * again. Also called on every pause, placement and recovery, so rest is
   * judged afresh afterwards; it does nothing to an aircraft not resting.
   */
  function wakeFromRest(reason: string): void {
    if (!aircraftRest.wake()) return;
    restSettings = null;
    flightLog.info("sim", "Woken from rest", { reason });
    flightAudio.setHeld(false, "rest");
    // Do not integrate the time spent resting.
    skipResumeDelta = true;
    runtime.setSimRunning(!inputManager.isPaused() && !worldLoading);
    runtime.requestRender();
  }
  const syncSimulationPaused = (paused: boolean): void => {
    wakeFromRest(paused ? "pause" : "resume");
    // Sample again on resume: a binding may have been pressed while ticking stopped.
    cancelArmament();
    // All input routes, including keyboard, gamepad and phone, share this boundary.
    if (!paused && (aircraftSwitching || sharedSettingsBlocked() || damage.snapshot().destroyed || rootElement.ownerDocument.querySelector(".flight-panel__aircraft-dialog[open]"))) {
      inputManager.setPaused(true);
      return;
    }
    // A pending terrain proposal keeps holding physics after resume: only its
    // own card's choices answer it, never a pause toggle around another prompt.
    const priorFault = physicsLoop.getFault();
    flightLog.info("sim", paused ? "Paused" : "Resume requested",
      priorFault ? { clearingFault: priorFault } : undefined);
    // Resume is a recovery action as well as a pause toggle; teleport is not
    // required merely to clear a transient terrain-contact fault.
    if (!paused && priorFault) {
      if (priorFault === HARD_GROUND_IMPACT_FAULT) flyOnFromImpact();
      else recoverFromFault();
    }
    // Pausing discards partial feedback windows and is a safe settings boundary.
    if (paused) {
      wheelCues.invalidate("pause");
      applyGroundBoundary();
      saveFlight();
    }
    phoneSession?.cancelHandoff();
    physicsLoop.setPaused(paused || worldLoading);
    tireAudio.setPaused(paused || worldLoading);
    flightAudio.setHeld(paused, "pause");
    runtime.setSimRunning(!paused && !worldLoading);
    engineMonitor.update(jsbsim.sdk, paused || worldLoading);
    const armament = armamentState();
    if (armament) armamentWidget?.update(armament);
    skipResumeDelta = !paused;
    const state = physicsLoop.getLatestState() ?? initialState;
    controlPanel?.update(createPanelSnapshot(state));
    hudBar?.update(state, runtime.status, measuredFps, paused, groundHeightUnder(state));
    phoneSession?.syncStatus();
  };
  const setSimulationPaused = (paused: boolean): void => inputManager.setPaused(paused);
  /** A terrain question is holding physics until the pilot answers it. */
  const heldByTerrainQuestion = (): boolean =>
    terrainBlockedReason === "relocation" && terrainContact.getRelocationProposal() !== null;
  /** The hard ground impact physics is holding on until the pilot answers its card. */
  const pendingImpact = (): GroundImpact | null =>
    physicsLoop.getFault() === HARD_GROUND_IMPACT_FAULT ? physicsLoop.getGroundImpact() : null;
  /** What the pause buttons show: paused whenever the aircraft is not moving because of any of these. */
  const displayPaused = (): boolean => inputManager.isPaused() || heldByTerrainQuestion() || pendingImpact() !== null;
  /** The pilot keeps this position: the card's Stay here, or play while the card holds physics. */
  const stayInsideTerrain = (): void => {
    const pending = terrainContact.getRelocationProposal();
    if (pending) terrainContact.declineRelocation(pending.id);
    else if (!terrainContact.isTerrainIgnored()) return;
    visibleMeshCollision.setTerrainOverlapIgnored(true);
    setSimulationPaused(false);
    runtime.requestRender();
  };
  /**
   * Fly on from a hard ground impact, from where it stopped: the floor is held
   * under the lowest contact until the aircraft is clear of the surface, so the
   * next step does not stop on the same impact again.
   */
  function flyOnFromImpact(): void {
    const impact = pendingImpact();
    if (!impact) return;
    wakeFromRest("impact");
    try {
      terrainContact.flyOnFromImpact();
      physicsLoop.reset();
    } catch (error) {
      flightLog.error("sim", "Could not fly on from the impact", { reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    flightLog.info("sim", "Flying on from a hard impact", { depthMeters: Number(impact.depthMeters.toFixed(3)) });
    visibleMeshCollision.reset();
    visibleMeshCollision.setTerrainOverlapIgnored(true);
    resetWheelSpin("fault");
  }
  /** The impact card's Resume, or play while only the impact holds physics. */
  const resumeFromImpact = (): void => {
    flyOnFromImpact();
    setSimulationPaused(false);
    updateTerrainOverlap();
    runtime.requestRender();
  };
  /** A pause button pressed: play while only a card holds physics answers that card. */
  const requestPaused = (paused: boolean, apply: (paused: boolean) => void): void => {
    if (!paused && !inputManager.isPaused() && pendingImpact()) { resumeFromImpact(); return; }
    if (!paused && !inputManager.isPaused() && heldByTerrainQuestion()) { stayInsideTerrain(); return; }
    apply(paused);
  };

  const applyWeather = (nextWeather: FlightWeatherState): void => {
    wakeFromRest("weather");
    weather.windDirectionDeg = nextWeather.windDirectionDeg;
    weather.windSpeedKts = nextWeather.windSpeedKts;
    const directionRad = (nextWeather.windDirectionDeg * Math.PI) / 180;
    const speedFps = nextWeather.windSpeedKts * 1.68781;
    jsbsim.sdk.setPropertyValue("atmosphere/wind-north-fps", -Math.cos(directionRad) * speedFps);
    jsbsim.sdk.setPropertyValue("atmosphere/wind-east-fps", -Math.sin(directionRad) * speedFps);
  };

  const placeAircraftAtLocation = (location: FlightLocation, terrainHeightMeters: number | undefined): FlightState => {
    const placed = engineTest
      ? resetFlightLocation(jsbsim.sdk, location, terrainHeightMeters, aircraftId, { holdDown: true })
      : resetFlightLocation(jsbsim.sdk, location, terrainHeightMeters, aircraftId, { preserveRequestedAltitude: true });
    refreshStores();
    return placed;
  };

  let destinationRequest = 0;
  const describeDestination = (location: FlightLocation, altitude: number) =>
    `${location.latDeg.toFixed(5)}, ${location.lonDeg.toFixed(5)} at ${altitude.toFixed(1)} m`;
  const teleportToLocation = (location: FlightLocation, clearanceMeters = 0): void => {
    const request = ++destinationRequest;
    const wasPaused = inputManager.isPaused();
    setSimulationPaused(true);
    const altitude = location.flightPreset?.mode === "departure"
      ? location.flightPreset.groundElevationMeters + getFdmProfile(aircraftId).stance.staticMeters + 0.17
      : location.altMeters ?? (physicsLoop.getLatestState() ?? initialState).altMeters;
    void placement.request({
      destination: describeDestination(location, altitude),
      reason: location.flightPreset ? `Move to the selected ${location.flightPreset.mode} position.` : "Move to your selected destination.",
    }).then(accepted => {
      if (disposed || request !== destinationRequest) return;
      if (accepted) performLocationPlacement({ ...location, altMeters: altitude }, clearanceMeters);
      setSimulationPaused(wasPaused);
    });
  };
  const performLocationPlacement = (location: FlightLocation, clearanceMeters = 0): void => {
    if (disposed) return;
    cancelArmament();
    arrivalCamera?.dispose(); arrivalCamera = null;
    overlapNotice.update(null);
    placementAbort.abort();
    const abort = placementAbort = new AbortController();
    wakeFromRest("placement");
    worldLoading = true;
    tireAudio.setPaused(true);
    flightAudio.setHeld(true, "loading");
    resetWheelSpin("teleport");
    applyGroundBoundary();
    physicsLoop.setPaused(true);
    runtime.setSimRunning(false);
    engineMonitor.update(jsbsim.sdk, true);
    // Detached stores use scene coordinates; clear them before the preview rebase,
    // including when destination terrain preparation fails or is cancelled.
    externalTankVisuals?.resetDetached();
    storeVisuals?.resetDetached();
    externalTankStepSeconds = 0;
    clearGVision();
    floatingOrigin?.aircraftRoot.setEnabled(false);
    phoneSession?.reset();
    inputManager.adoptControls(inputManager.getControls());
    loading.show({ title: "Preparing your destination", reset: true });
    for (const phase of ["app", "world", "flight", "assets"] as const) loading.setPhase(phase, { state: "ready" });
    const prior = physicsLoop.getLatestState() ?? initialState;
    // The destination's motion for its forward cone: placement keeps the
    // ground speed along the new heading, and a departure starts stopped.
    const headingRad = (location.flightPreset?.headingDeg ?? location.headingDeg ?? prior.headingRad / RADIANS_PER_DEGREE) * RADIANS_PER_DEGREE;
    const groundSpeedFps = location.flightPreset?.mode === "departure" ? 0 : Math.hypot(prior.northVelocityFps, prior.eastVelocityFps);
    const preview: FlightState = { ...prior, latDeg: location.latDeg, lonDeg: location.lonDeg,
      altMeters: location.altMeters ?? prior.altMeters, headingRad,
      northVelocityFps: groundSpeedFps * Math.cos(headingRad), eastVelocityFps: groundSpeedFps * Math.sin(headingRad),
      verticalSpeedFps: location.flightPreset ? 0 : prior.verticalSpeedFps };
    floatingOrigin?.apply(preview);
    runtime.setSimViewState({ ...location, zoomMeters: zoomMetersFromAltitude(preview.altMeters) });
    // The destination's own demand exists before the camera reads readiness:
    // the previous region's readiness says nothing about this one.
    const prepared = regionPreparation.prepare(runtime, preview, abort.signal, { aircraftAltitudeMeters: prior.altMeters });
    startArrivalCamera(preview);
    void prepared.then(async terrain => {
      finishArrivalForOverride(terrain.overridden);
      await waitForArrival(abort.signal);
      if (disposed || abort.signal.aborted) return;
      const destination = { ...location, altMeters: terrain.altitudeMeters };
      const state = placeAircraftAtLocation(destination, terrain.groundHeightMeters);
      aircraftModel?.updateGearVisibility(readControlSurfaceState(jsbsim.sdk, aircraftId).gearDownNorm, true);
      followControlLaw();
      // An override waives only the map wait: terrain that later appears
      // through the aircraft still asks before anything moves it.
      terrainContact.reset();
      visibleMeshCollision.reset();
      visibleMeshCollision.setTerrainOverlapIgnored(terrainContact.isTerrainIgnored());
      if (!engineTest && location.flightPreset) {
        inputManager.resetControls(state.throttleNorm);
        inputManager.replaceFlaps(getFdmProfile(aircraftId).runwayPresets[location.flightPreset.mode].flapsNorm);
        inputManager.setGearDown(true);
        if (location.flightPreset.mode === "departure") setSimulationPaused(true);
      }
      appliedControls = inputManager.getControls();
      physicsLoop.reset();
      // A reposition is a discontinuity: new timeline, cleared queues, a fade.
      flightAudio.beginEpoch();
      engineVisuals.resetSmoke();
      applyWeather(weather);
      pitchAutoTrim = createAutoTrimState(pitchAutoTrim.enabled);
      rollAutoTrim = createAutoTrimState(rollAutoTrim.enabled);
      arbiterState = resetArbiterHold(arbiterState);
      lastApResult = { ...lastApResult, owners: idleAutopilotOwners() };
      floatingOrigin?.apply(state);
      runtime.setSimViewState({
        latDeg: state.latDeg, lonDeg: state.lonDeg,
        zoomMeters: zoomMetersFromAltitude(state.altMeters - (terrain.groundHeightMeters ?? 0)),
        headingDeg: state.headingRad * 180 / Math.PI,
      });
      worldLoading = false;
      cancelArmament();
      floatingOrigin?.aircraftRoot.setEnabled(true);
      aircraft?.setViewMode(aircraft.getViewMode());
      physicsLoop.setPaused(inputManager.isPaused());
      tireAudio.setPaused(inputManager.isPaused());
      flightAudio.setHeld(false, "loading");
      runtime.setSimRunning(!inputManager.isPaused());
      skipResumeDelta = true;
      actualFlaps = readActualFlaps();
      actualControls = controlPositionReader.read();
      phoneSession?.syncStatus();
      lastLocalFlapsRevision = inputManager.getFlapsInputRevision();
      lastRemoteFlaps = null;
      syncNativeAutoFlaps();
      flightHud.update(state, inputManager.getControls(), inputManager.getGearDownNorm() > 0, {
        pitch: pitchAutoTrim.enabled, roll: rollAutoTrim.enabled,
      }, hudMasterAp(), attitudeView());
      saveFlight();
      controlPanel?.update(createPanelSnapshot(state));
      hudBar?.update(state, runtime.status, measuredFps, inputManager.isPaused(), groundHeightUnder(state));
      loading.hide();
      runtime.requestRender();
    }).catch((error: unknown) => {
      if (disposed || abort.signal.aborted) return;
      loading.fail("The destination terrain is not ready. Check your connection and map access, then retry.", {
        retry: () => teleportToLocation(location, clearanceMeters), cause: error,
        ...(error instanceof TerrainRecoveryError ? { actions: [{ label: "Use OpenStreetMap", onClick() {
          setMapSourcePreference("osm-standard", settings);
          teleportToLocation(location, clearanceMeters);
        } }] } : {}),
      });
    });
  };

  /** 3 cm, 0.9 m, 12.4 m: a move short enough to read at a glance. */
  const formatShortDistance = (meters: number): string => {
    const size = Math.abs(meters);
    return size < 1 ? `${Math.max(1, Math.round(size * 100))} cm` : `${size.toFixed(1)} m`;
  };
  /** After the aircraft was moved: physics, contact and the world carry on from where it is now. */
  const carryOnAfterMove = (): void => {
    physicsLoop.reset();
    visibleMeshCollision.reset();
    visibleMeshCollision.setTerrainOverlapIgnored(false);
    const state = readFlightState(jsbsim.sdk);
    floatingOrigin?.apply(state);
    regionPreparation.update(state, aircraftBodyRadius, true);
    flightAudio.beginEpoch();
    saveFlight();
  };
  /**
   * A hard impact asks on the card at the bottom, clear of the aircraft:
   * Resume flies on from there, and the move lifts the lowest contact out of
   * the floor it hit.
   */
  const showImpact = (impact: GroundImpact): void => {
    const lift = impact.depthMeters + IMPACT_LIFT_MARGIN_METERS;
    overlapNotice.update({
      title: "Hard impact",
      message: `Stopped ${formatShortDistance(impact.depthMeters)} into the ground.`,
      resumeLabel: "Resume",
      onResume: resumeFromImpact,
      teleportLabel: `Move up ${formatShortDistance(lift)}`,
      onTeleport: () => {
        const pose = readFlightState(jsbsim.sdk);
        const signal = placementAbort.signal;
        // The impact already holds physics; nothing moves while asked.
        void placement.request({ destination: describeDestination(pose, pose.altMeters + lift),
          reason: `Move up ${formatShortDistance(lift)} out of the ground.`,
          signal,
        }).then(accepted => {
          // Only the impact that was shown may be answered: Resume may have come first.
          if (disposed || signal.aborted || !accepted || pendingImpact() !== impact) return;
          wakeFromRest("impact");
          try {
            terrainContact.liftFromImpact(lift);
          } catch (error) {
            flightLog.error("sim", "Could not move up out of the impact", { reason: error instanceof Error ? error.message : String(error) });
            return;
          }
          flightLog.info("sim", "Moved up out of a hard impact", { liftMeters: Number(lift.toFixed(3)) });
          carryOnAfterMove();
          resetWheelSpin("fault");
          updateTerrainOverlap();
          runtime.requestRender();
        });
      },
    });
  };
  const updateTerrainOverlap = (): void => {
    const impact = pendingImpact();
    if (impact) { showImpact(impact); return; }
    const proposal = terrainContact.getRelocationProposal();
    const ignored = terrainContact.isTerrainIgnored();
    visibleMeshCollision.setTerrainOverlapIgnored(ignored);
    if (!proposal && !ignored) { overlapNotice.update(null); return; }
    const current = physicsLoop.getLatestState() ?? initialState;
    const ground = groundHeightUnder(current);
    const clearance = getFdmProfile(aircraftId).stance.staticMeters + 0.17;
    // A pending proposal is the question; once the pilot chose to fly on,
    // only a status and an upward recovery move remain until the aircraft is clear.
    const teleportAltitude = proposal ? proposal.altitudeMeters
      : ground !== null && ground + clearance > current.altMeters + 0.01 ? ground + clearance : null;
    const up = !proposal || proposal.deltaMeters >= 0;
    overlapNotice.update({
      compact: !proposal,
      title: up ? "Inside terrain" : "Ground moved",
      message: proposal
        ? `Ground is ${formatShortDistance(proposal.deltaMeters)} ${up ? "above" : "below"} you.`
        : ground === null ? "Inside terrain. Ground height unknown."
        : "Inside terrain. Contact resumes once you're clear.",
      teleportLabel: up ? "Move up" : "Move down",
      onResume: stayInsideTerrain,
      ...(teleportAltitude === null ? {} : { onTeleport: () => {
        const pose = readFlightState(jsbsim.sdk);
        const pending = terrainContact.getRelocationProposal();
        const surface = ground;
        const altitude = pending?.altitudeMeters ?? teleportAltitude;
        const signal = placementAbort.signal;
        // A pending proposal already holds physics; pausing and resuming
        // around it would decline it. Flight inside terrain holds still while asked.
        const wasPaused = inputManager.isPaused();
        if (!pending) setSimulationPaused(true);
        const move = altitude - pose.altMeters;
        void placement.request({ destination: describeDestination(pose, altitude),
          reason: `Move ${move >= 0 ? "up" : "down"} ${formatShortDistance(move)} onto the ground.`,
          signal,
        }).then(accepted => {
          if (disposed || signal.aborted) return;
          // Only the exact situation that was shown may be applied.
          const moved = accepted && (pending
            ? terrainContact.acceptRelocation(pending.id)
            : !terrainContact.getRelocationProposal() && terrainContact.isTerrainIgnored() && surface !== null);
          if (moved) {
            if (!pending) {
              const snapshot = captureSimulation(jsbsim.sdk);
              snapshot.initial["ic/h-sl-ft"] = altitude / 0.3048;
              snapshot.initial["ic/terrain-elevation-ft"] = surface! / 0.3048;
              restoreSimulation(jsbsim.sdk, snapshot);
              terrainContact.reset();
            }
            carryOnAfterMove();
          }
          // No keeps the position and the card's choices.
          if (!pending) setSimulationPaused(wasPaused);
          updateTerrainOverlap();
          runtime.requestRender();
        });
      } }),
    });
  };

  /**
   * Pairing loads with the Remote Control tab, not with the flight: PeerJS and
   * the QR encoder are fetched only for a pilot who opens it. The session is
   * made once and outlives the tab, so switching tabs keeps the phone.
   */
  const multiplayerInvitation = takeMultiplayerInvitation();
  let multiplayer: ReturnType<typeof createMultiplayerFeature> | null = null;
  let multiplayerLoading: Promise<MountMultiplayer> | null = null;
  const applySharedSettingsView = (next: SharedSettingsPanelState): void => {
    if (disposed) return;
    const changed = damage.setImplementation(next.values.damageImplementation);
    sharedSettingsState = next;
    if (changed || !next.ready) setSimulationPaused(true);
    hudBar?.setResumeBlocked?.(aircraftSwitching || sharedSettingsBlocked() || damage.snapshot().destroyed);
    controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    runtime.requestRender();
  };
  const loadMultiplayer = (): Promise<MountMultiplayer> => multiplayerLoading ??= import("./multiplayer/createMultiplayerFeature").then(({ createMultiplayerFeature }) => {
    if (disposed) throw new Error("The flight has closed.");
    const feature = multiplayer ??= createMultiplayerFeature({
      scene: runtime.scene,
      initialSharedSettings: { ...sharedSettingsState.values },
      onSharedSettingsChange: applySharedSettingsView,
      requestRender: () => runtime.requestRender(),
      getRenderFrame: () => {
        const origin = floatingOrigin?.getOriginEcef();
        const frame = floatingOrigin?.getWorldFromEcef();
        return origin && frame ? { origin, m: frame.m } : null;
      },
      getLocal: () => ({
        pose: {
          ...(physicsLoop.getLatestState() ?? initialState), aircraftId,
          rollRateRadPerSec: jsbsim.sdk.getPropertyValue("velocities/p-rad_sec"),
          pitchRateRadPerSec: jsbsim.sdk.getPropertyValue("velocities/q-rad_sec"),
          yawRateRadPerSec: jsbsim.sdk.getPropertyValue("velocities/r-rad_sec"),
          gearDown: inputManager.getGearDownNorm() > 0,
          flapsNorm: Math.max(0, Math.min(1, actualFlaps)), afterburner: engineVisuals.afterburnerActive() ?? false,
          nozzleNorm: engineVisuals.nozzlePositionNorm(),
          health: damage.implementation === "health-v1" ? damage.snapshot().health : undefined,
        },
        held: inputManager.isPaused() || worldLoading || Boolean(physicsLoop.getFault()),
      }),
      onSpawn: (pose, location) => {
        if (location) { setSimulationPaused(true); teleportToLocation(location); return; }
        // The normal destination path prepares terrain and keeps this pilot's aircraft.
        // A small lateral separation avoids spawning both models at one point.
        const longitudeStep = 50 / (111_320 * Math.max(0.01, Math.cos(pose.latDeg * Math.PI / 180)));
        setSimulationPaused(true);
        teleportToLocation({ latDeg: pose.latDeg, lonDeg: ((pose.lonDeg + longitudeStep + 540) % 360) - 180,
          altMeters: pose.altMeters, headingDeg: pose.headingRad * 180 / Math.PI, airspeedKts: Math.max(0, pose.airspeedKts) }, 0);
      },
      baseUrl: new URL(appHref("fly", new URL(window.location.origin)),
        (window as Window & { __OSFS_LAN_ORIGIN__?: string }).__OSFS_LAN_ORIGIN__ ?? window.location.origin).href,
      invitation: multiplayerInvitation,
      invitationControls: {
        aircraftId,
        initialLocation: physicsLoop.getLatestState() ?? initialState,
        searchProvider: flightLocation.searchProvider,
      },
      prepareJoin: (href, start) => {
        if (start.aircraftId && start.aircraftId !== aircraftId) {
          // Load the requested flight model through the normal app startup path.
          // Keep the invitation so the guest can join once that aircraft is ready.
          const destination = new URL(window.location.href);
          const invitation = new URL(href);
          destination.searchParams.delete("set.osfs.aircraft.id");
          destination.searchParams.set(AIRCRAFT_URL_NAME, start.aircraftId);
          destination.hash = invitation.hash;
          const key = invitation.searchParams.get("gkey");
          if (key) destination.searchParams.set("gkey", key);
          window.location.assign(destination.href);
          return false;
        }
        return true;
      },
      getGoogleKey: () => settings.get<string>("map.source.googleKey")?.trim() || mapConfig.googleApiKey || null,
      onCombat: (message: CombatMessage) => { engagement.ingest(message); wakeFromRest("combat"); runtime.requestRender(); },
      share: {
        settings,
        getSource: () => {
          const state = physicsLoop.getLatestState();
          if (!state) return null;
          const family = getAircraftFamilyForAircraft(aircraftId);
          const variant = family.variants.find(item => item.id === aircraftGenerationId);
          return {
            state,
            groundHeightMeters: groundHeightUnder(state),
            selection: { aircraftId, generationId: aircraftGenerationId, lodId: aircraftLodId },
            aircraftLabel: variant && family.variants.length > 1 ? `${family.label} ${variant.label}` : family.label,
          };
        },
      },
    });
    return (host: HTMLElement) => feature.mount(host);
  }).catch((error: unknown) => { multiplayerLoading = null; throw error; });

  const loadPhonePairing = (): Promise<MountPhonePairing> => phonePairing ??= Promise.all([
    import("@0sfs/rc/createPhoneControlSession"), import("@0sfs/rc/createPhonePairingPanel"),
  ]).then(([{ createPhoneControlSession }, { createPhonePairingPanel }]): MountPhonePairing => {
    if (disposed) throw new Error("The flight has closed.");
    const session = phoneSession ??= createPhoneControlSession({
      getStatus: () => {
        const state = physicsLoop.getLatestState() ?? initialState;
        return {
          owner: phoneSession?.getSnapshot().owner ?? "local",
          paused: inputManager.isPaused(), viewMode: aircraft?.getViewMode() ?? "third",
          // Blending, the levers are where the pilots put them, before automation: what both sets of levers show.
          controls: phoneSession?.getSnapshot().owner === "phone"
            ? { ...appliedControls, ...controlBlend?.levers() } : inputManager.getControls(),
          actualControls,
          controlCapabilities,
          // Until sea level there is known, the height the globe flies at.
          airspeedKts: state.airspeedKts, altitudeFt: feetAboveSeaLevel(state) ?? state.altMeters / 0.3048,
          headingDeg: (state.headingRad * 180 / Math.PI + 360) % 360,
          // Presence of this field is what tells the phone it may offer a G button.
          ...(controlCapabilities.landingGear ? { gearDown: inputManager.getGearDownNorm() > 0 } : {}),
          // The flaps lever's AUTO, as the HUD's: moving the phone's flaps turns it off.
          ...(controlCapabilities.flaps ? { autoFlaps: parameters.get("osfs.assist.autoFlaps") } : {}),
          // The HUD's AUTO TRIM corner.
          ...(controlCapabilities.pitchTrim || controlCapabilities.rollTrim ? {
            autoTrim: { pitch: parameters.get("osfs.assist.autoTrim"), roll: parameters.get("osfs.assist.autoRollTrim") },
          } : {}),
          // The same reading the HUD's engine chip is drawing from, so both
          // screens show one engine rather than two sampled at two times.
          engine: (() => {
            const reading = toEngineStatus(engineMonitor.getReading(), engineControl.reading());
            const refusal = droneRefusal();
            if (!refusal) return reading;
            return reading ? { ...reading, blocked: refusal.replace(/°/g, "").slice(0, 60) } : reading;
          })(),
          ...(isDroneAircraftId(aircraftId) ? { drone: (droneTelemetry() ?? { available: true as const }) as unknown as AircraftStatus["drone"] } : {}),
          ...(droneAircraft ? { droneMotors: toDroneMotorStatus(droneMotorTelemetry(), {
            fps: parameters.get("osfs.engineMonitor.orbFps"),
            turnsPerSecond: parameters.get("osfs.engineMonitor.orbTurnsPerSecond"),
            maxPatternStep: parameters.get("osfs.engineMonitor.orbMaxPatternStep"),
            pixelRatio: parameters.get("osfs.engineMonitor.orbPixelRatio"),
            renderer: parameters.get("osfs.renderer.engineOrbs"),
          }) } : {}),
          throttleBrakeRange: initialAircraftId === "f-35b",
          keepSliderBrakes: parameters.get("osfs.input.keepSliderBrakes"),
          afterburnerDetent: afterburnerDetent() ?? undefined,
        };
      },
      hasActiveLocalInput: () => inputManager.hasActiveFlightInput() || localStartHeld || flightHud.isPilotHolding(),
      getLocalInputRevision: () => localInputRevision,
      isPageVisible: () => !document.hidden,
      getSharing: () => controlSharing,
      setPriority: priority => { parameters.set("osfs.remote.blendPriority", priority); },
      onOwnershipChange: (owner, controls, blend) => {
        // Blending, this computer's controls stay live and mix with the phone's,
        // so a phone joining or leaving changes only where the levers are.
        if (blend) inputManager.adoptLevers(controls);
        else inputManager.adoptControls(controls);
        inputManager.setRemoteOwned(owner === "phone" && !blend);
        controlBlend = owner === "phone" && blend ? createControlBlend(controls, inputManager.getFlapsInputRevision()) : null;
        lastLocalFlapsRevision = inputManager.getFlapsInputRevision();
        lastRemoteFlaps = owner === "phone" ? controls.flaps : null;
        appliedControls = { ...controls };
        runtime.requestRender();
      },
      setPaused: setSimulationPaused,
      setViewMode: mode => { arrivalCamera?.dispose(); arrivalCamera = null; aircraft?.setViewMode(mode); runtime.requestRender(); },
      // A paused simulation renders only on request; keep frames coming while
      // the phone is orbiting, the way a mouse drag does.
      onCameraAim: () => runtime.requestRender(),
      getCameraTuning: () => phoneCameraTuning,
      phoneSettings: {
        get: () => readPhoneControllerSettings(parameters),
        set: settings => { parameters.setMany(phoneControllerSettingsValues(settings)); },
      },
      ...(phoneCameraTrace ? { trace: phoneCameraTrace } : {}),
      // Same path the HUD's G button and the G key take, so the three stay in step.
      setGearDown: controlCapabilities.landingGear
        ? down => { inputManager.setGearDown(down); flightHud.setGearDown(down); runtime.requestRender(); } : undefined,
      setAutoFlaps: controlCapabilities.flaps ? enabled => { parameters.set("osfs.assist.autoFlaps", enabled); } : undefined,
      // The same settings the HUD's AUTO TRIM corner turns.
      setAutoTrim: controlCapabilities.pitchTrim || controlCapabilities.rollTrim ? (axis, enabled) => {
        if (axis === "pitch" ? controlCapabilities.pitchTrim : controlCapabilities.rollTrim)
          parameters.set(axis === "pitch" ? "osfs.assist.autoTrim" : "osfs.assist.autoRollTrim", enabled);
      } : undefined,
      onPhoneInput: () => { hostFlightUi.notePhoneInput(); wakeFromRest("phone"); },
      // The same path the HUD lever's ring takes.
      shutdownEngine: () => engineControl.shutdown(),
    });
    session.subscribe(hostFlightUi.sync);
    return (host, panelOptions) => createPhonePairingPanel(host, session, panelOptions);
  }).catch((error: unknown) => { phonePairing = null; throw error; });
  const onVisibilityChange = () => {
    if (!document.hidden) return;
    cancelArmament();
    haptics.cancel();
    phoneSession?.onHidden();
    saveFlight();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const onArmamentBlur = () => { armamentFocused = false; focusedKeys.clear(); cancelArmament(); refreshArmament(); };
  const onArmamentFocus = () => { armamentFocused = true; cancelArmament(); refreshArmament(); };
  window.addEventListener("blur", onArmamentBlur);
  window.addEventListener("focus", onArmamentFocus);
  // Leaving or reloading the page, where a browser does not hide it first.
  window.addEventListener("pagehide", saveFlight);

  // The renderer and basemap choices each have a tab; their HUD chips toggle it.
  // The choice is renderer.backend, which the runtime reads when it starts.
  const rendererStorage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
  };
  // A start on WebGL says why in the log, with how to get WebGPU where it can be had.
  const rendererAdvice = reportRendererStart(log, runtime.renderer, runtime.engine, window, rendererStorage);
  const rendererPanel = createRendererPanel({
    ui: ui.renderer,
    renderer: runtime.renderer,
    onChange: force => applyRendererChoice(force, settings, window.location, rendererStorage),
    settings,
    advice: rendererAdvice,
  });
  // The sky is seen from the flight's camera; before the first frame, the Sun and its times of day are the aircraft's place's.
  const skyPlace = () => runtime.sky.getEnvironment()?.illumination.observer ?? physicsLoop.getLatestState() ?? initialState;
  const skyPanel = createSkyPanel({ document, ui: ui.publicUi, refresh: ui.refresh, panelStorage: ui.storage, now: Date.now, settings, getPlace: skyPlace, openDateTime: () => controlPanel?.openOrSelectTab("time") });
  // The civil clock follows the aircraft, including when the camera flies elsewhere.
  const timePanel = createDateTimePanel({ document, ui: ui.publicUi, refresh: ui.refresh, panelStorage: ui.storage, now: Date.now, settings, getPlace: () => physicsLoop.getLatestState() ?? initialState });
  // A switch between Google and a 2D basemap, or of elevation provider, changes
  // the ground under the aircraft, so its terrain is prepared again. One 2D
  // basemap for another changes imagery only. A switch can come from the Map
  // tab, Show all parameters or an import; the runtime reports each one.
  const mapGround = (status: Pick<BabylonRuntime["status"], "mode" | "terrainSource">): string | null =>
    status.mode === "raster-basemap" ? `raster:${status.terrainSource?.id ?? ""}`
      : status.mode === "google-tiles" ? "google" : null;
  let preparedGround = mapGround(runtime.status);
  stopWatching.push(runtime.subscribeStatus(status => {
    const ground = mapGround(status);
    if (ground === null || ground === preparedGround) return;
    preparedGround = ground;
    // The active preparation owns provider recovery while loading. Starting a
    // second teleport here cancels it, including during the initial spawn.
    if (worldLoading) return;
    regionPreparation.update(physicsLoop.getLatestState() ?? initialState, undefined, true);
  }));
  let detailPanelCount = 0;
  const mapPanel = createMapSourcePanel({
    document, InputElement: HTMLInputElement, ui: ui.publicUi, refresh: ui.refresh, panelStorage: ui.storage,
    // The runtime's own cache; a failure is the section's to report, as the old section's promises were.
    cache: { inspect: () => Promise.resolve().then(inspectMapCache), clear: () => Promise.resolve().then(clearMapCache), nowMs: () => performance.now(), refreshIntervalMs: () => settings.get<number>("map.cache.inspectInterval"), rowLimit: () => settings.get<number>("map.cache.rowsShown") },
    detailPanel: { createTrack: ui.createTrack, idSuffix: () => String(++detailPanelCount) },
    settings,
    detail: mapDetail ?? undefined,
    rasterSources: RASTER_BASE_MAP_SOURCES,
    terrainSources: TERRAIN_SOURCES,
    // Saving a choice switches the map: the runtime follows map.source.*.
    onMapSourceChange: selected => {
      const unchanged = settings.get("map.source.basemap") === selected;
      setMapSourcePreference(selected, settings);
      // Automatic recovery preserves the Google preference. Reselecting that
      // same preference must still start a fresh attempt at the provider.
      if (unchanged && selected === "google") runtime.setMapSource("google");
    },
    onTerrainSourceChange: selected => setTerrainSourcePreference(selected, settings),
  });
  // The map of the view is the shared one. The predicted path is this flight's,
  // so another app that mounts the same map does not load it.
  const overviewMap = createOverviewMap({
    document, sources: RASTER_BASE_MAP_SOURCES, settings,
    basemap: () => ({ mode: runtime.status.mode, source: runtime.status.mode === "raster-basemap" ? runtime.status.rasterBaseMap : null }),
    subscribeBasemap: listener => runtime.subscribeStatus(() => listener()),
    view: () => runtime.getViewState(),
    frames: { subscribe(listener) {
      const observer = runtime.scene.onAfterRenderObservable.add(listener);
      return () => { runtime.scene.onAfterRenderObservable.remove(observer); };
    } },
    overlay: createFlightPathOverlay(() => physicsLoop.getLatestState()),
    // A fitted globe makes a sectional a speck. Start close enough to read the chart and the path.
    initialZoomOffset: 9,
  });
  // Settings holds what spans every tab, the presets and the saved record; the
  // Interface tab the position readout, the log and place search, which the
  // flight uses as the globe does. The globe's toolbar and theme are not the
  // flight's, so they stay out.
  const presetsSection = createPresetsSection(settings);
  const savedSettingsSection = createSavedSettingsSection(settings);
  let flightTicks = 0;
  let lastFlightTickAtMs: number | null = null;
  diagnostics.checkpoint?.("component-execution.txt", JSON.stringify(earthWasmCores(runtime) ?? [], null, 2), true);
  diagnostics.addState(() => `Component execution: ${JSON.stringify(earthWasmCores(runtime) ?? [])}`);
  diagnostics.addState(() => `Compute scheduling: ${JSON.stringify(earthComputeScheduling(runtime))}`);
  diagnostics.addState(() => `Isolation: ${describeIsolation(window)}`);
  diagnostics.addState(() => `Aircraft: ${aircraftId}; generation ${aircraftGenerationId ?? "default"}; LOD ${aircraftLodId}; model ${modelState.status}; active LOD ${modelState.activeLodId ?? "none"}; ${modelState.triangles} triangles.`);
  diagnostics.addState(() => {
    const current = physicsLoop.getFault();
    const sentence = (fault: string): string => fault.replace(/\.$/, "");
    const flight = `Flight: ${worldLoading ? "loading" : inputManager.isPaused() ? "paused" : "running"}; view ${aircraft?.getViewMode() ?? "third"}; physics fault ${current ? sentence(current) : "none"}.`;
    // The fault that took the aircraft out of the pilot's hands may have cleared by now; the report still says what it was.
    const { last, impact } = faultHistory;
    const history = last === null ? ""
      : ` Faults this visit: ${faultHistory.count}; the last ${((performance.now() - faultHistory.atMs) / 1000).toFixed(1)} s ago${last === current ? "" : `, ${sentence(last)}`}.`;
    const depth = impact ? ` Last impact ${impact.depthMeters.toFixed(3)} m into the floor at ${impact.floorMeters.toFixed(2)} m, at ${impact.contact ?? "no reported contact"}.` : "";
    const card = overlapNotice.describe();
    return flight + history + depth + (card ? ` On screen: ${card}` : "");
  });
  diagnostics.addState(() => `Flight progress: ${JSON.stringify({ ticks: flightTicks,
    lastTickAgeMs: lastFlightTickAtMs === null ? null : Math.max(0, performance.now() - lastFlightTickAtMs),
    nativeTimeSeconds: jsbsim.sdk.getSimTime(), physics: physicsLoop.getTimeAccounting(),
  })}`);
  diagnostics.addState(() => {
    const build = jsbsim.identity?.build;
    return build ? `JSBSim: ${build.package.name} ${build.package.version}; native ${build.native.commit}${build.native.dirty ? "-dirty" : ""}; SDK ${build.sdk.commit}${build.sdk.dirty ? "-dirty" : ""}.` : "JSBSim: build identity unavailable.";
  });
  const diagnosticsSource = {
    report: () => diagnostics.report({ allSettings: true }),
    previous: () => diagnostics.previous(),
    reportSecrets: () => reportSecrets(settings),
    copy: ui.copy,
  };
  const diagnosticsSection = createDiagnosticsSection(diagnosticsSource, { document, reportOnlyHref: reportOnlyAddress(window.location.href) });
  const bugReportPanel = createBugReportPanel(diagnosticsSource, { document, now: () => new Date(), downloads: browserReportDownloads(URL), issueReporter: issueReporterFromBuild() });
  const makeTestFeedback = () => createTestFeedbackPanel({ document, href: window.location.href, now: () => new Date(),
    downloads: browserReportDownloads(URL), secrets: () => reportSecrets(settings), providers: {
      diagnostics: diagnosticsSource.report,
      flight: () => createPanelSnapshot(),
      armament: armamentState,
      damage: () => damage.snapshot(),
      multiplayer: () => multiplayer?.diagnostics() ?? { status: "idle" },
      remote: () => {
        const current = phoneSession?.getSnapshot();
        return {
          // Pairing URLs contain a credential; feedback needs only the state.
          session: current ? { phase: current.phase, owner: current.owner, message: current.message, returning: current.returning } : null,
          sharing: { ...controlSharing }, localInputRevision,
          actualControls: { ...actualControls },
          activeLocalInput: inputManager.hasActiveFlightInput() || localStartHeld || flightHud.isPilotHolding(),
          pageVisible: !document.hidden,
          connection: phoneSession?.log.report() ?? null,
        };
      },
    } });
  let testFeedback = makeTestFeedback();
  let testFeedbackHash = window.location.hash;
  const syncTestFeedbackUrl = (): void => {
    if (testFeedbackHash === window.location.hash) return;
    testFeedbackHash = window.location.hash;
    // Removing a fragment is a same-document navigation: retire its session
    // and its tab instead of keeping the initial checklist on the plain URL.
    testFeedback?.destroy();
    testFeedback = makeTestFeedback();
    controlPanel?.setTestFeedbackTab(testFeedback?.element);
  };
  window.addEventListener("hashchange", syncTestFeedbackUrl);
  window.addEventListener("popstate", syncTestFeedbackUrl);
  stopWatching.push(() => {
    window.removeEventListener("hashchange", syncTestFeedbackUrl);
    window.removeEventListener("popstate", syncTestFeedbackUrl);
  });
  const diagnosticsParameters = ui.section(settings, { tab: "settings", section: "diagnostics", footer: diagnosticsSection.element });
  const interfaceParameterSections = (["scale", "hud", "position", "log"] as const)
    .map(section => ({ section, handle: ui.section(settings, { tab: "interface", section }) }));
  // The flight retains its existing controls. The bug shortcut alone follows
  // the shared Auto fit choice, with its priority in the same Toolbar home,
  // and the busy chips' outline is the shared choice.
  const toolbarParameters = ui.section(settings, {
    tab: "interface", section: "toolbar", showAll: false,
    covers: settings.list({ tab: "interface", section: "toolbar" })
      .filter(spec => spec.id !== "interface.toolbar.bugReport" && spec.id !== TOOLBAR_EDIT_PRIORITIES_ID && spec.id !== TOOLBAR_ACTIVITY_OUTLINE_ID)
      .map(spec => spec.id),
  });
  // Component execution: editable settings and the running component status.
  const wasmParameters: { destroy(): void }[] = [];
  const wasm = createWasmSections({
    document, settings, reload: url => window.location.assign(url),
    section: (section, content) => {
      const handle = ui.section(settings, { tab: "wasm", section, ...content });
      wasmParameters.push(handle);
      return handle.element;
    },
    report: () => earthWasmCores(runtime) ?? [],
    computeReport: () => earthComputeScheduling(runtime),
    timers: { set: (callback, delayMs) => window.setTimeout(callback, delayMs), clear: handle => window.clearTimeout(handle as number) },
  });
  const settingsSections: PanelSection[] = [
    { id: "presets", title: "Presets", element: presetsSection.element },
    { id: "saved-settings", title: "Saved settings", element: savedSettingsSection.element },
    { id: "diagnostics", title: settings.getSectionTitle("settings", "diagnostics"), element: diagnosticsParameters.element, defaultOpen: false },
  ];
  // Which version runs, and everything it is built from, read from the page itself.
  const about = createAboutPanel({ site: __REPOSITORY_SLUG__ || undefined });
  void ensureModsSession().then(loaded => appendModDependencyTree(about.element, modAboutParts(loaded)));
  const browserData = createBrowserDataPanel(document);
  const interfaceParameterPanels = interfaceParameterSections.map(({ section, handle }) => ({
    id: section, title: settings.getSectionTitle("interface", section), element: handle.element,
  }));
  // The scale and the instruments' layout first: they change the most of the screen.
  const interfaceSections: PanelSection[] = [
    ...interfaceParameterPanels.slice(0, 2),
    { id: "toolbar", title: settings.getSectionTitle("interface", "toolbar"), element: toolbarParameters.element },
    ...interfaceParameterPanels.slice(2),
  ];
  // The Location tab's lookup, airport choice and saved form, owned by the flight;
  // the lookup's `search.*` limits sit under the form, as on the globe.
  const locationSearchParameters = ui.section(settings, { tab: "location", section: "search" });
  const flightLocation = createFlightLocation(settings, {
    storage: preferenceStorage(), fetch: (url, init) => window.fetch(url, init), nowMs: Date.now,
    createAbortController: () => new AbortController(),
    timers: { setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: handle => window.clearTimeout(handle as number) },
  }, options.locationSearchProvider);
  let deviceLocationMarker: DeviceLocationMarker | null = null;
  const showDeviceLocation = (fix: DeviceLocationFix | null): void => {
    if (disposed) return;
    if (!fix) { deviceLocationMarker?.show(null); return; }
    deviceLocationMarker ??= createSceneDeviceLocationMarker(runtime, createCanvasTextureDevicePorts({
      scene: runtime.scene,
      createCanvas(width, height) {
        const surface = document.createElement("canvas");
        surface.width = width;
        surface.height = height;
        return surface;
      },
      transfer: (_bytes, _label, submit) => submit(),
    }));
    deviceLocationMarker.show(fix);
  };
  controlPanel = createFlightControlPanel(panelRoot, createPanelSnapshot(), {
    createSection: ui.section,
    settings,
    parameters,
    meshInspector,
    overviewTab: overviewMap.element,
    mapTab: mapPanel.element,
    rendererTab: rendererPanel.element,
    skyTab: skyPanel.element,
    timeTab: timePanel.element,
    settingsSections,
    wasmSections: wasm.sections,
    headsetTab: headsetPanel?.element,
    aboutTab: about.element,
    accountTab: account.panel,
    browserDataTab: browserData.element,
    bugReportTab: bugReportPanel.element,
    testFeedbackTab: testFeedback?.element,
    cameraTab: isDroneAircraftId(aircraftId) ? droneCameraTab() ?? undefined : undefined,
    onBugReportShow: () => bugReportPanel.show(),
    interfaceSections,
    initialWeather: weather,
    gamepadBindings,
    onLocationApply: teleportToLocation,
    onDeviceLocation: showDeviceLocation,
    location: flightLocation,
    locationSearchSection: { id: "search", title: settings.getSectionTitle("location", "search"), element: locationSearchParameters.element, defaultOpen: false },
    onWeatherChange: applyWeather,
    onPausedChange: (paused) => requestPaused(paused, setSimulationPaused),
    onNewFlight: startNewFlight,
    onSharedSettingsPatch: patch => {
      setSimulationPaused(true);
      try {
        if (multiplayer) multiplayer.setSharedSettings(patch);
        else {
          // Local damage choices do not load PeerJS or create multiplayer renderers.
          if (patch.settingsEditors !== undefined) throw new Error("Host a flight before changing multiplayer permissions.");
          applySharedSettingsView({ ...sharedSettingsState, values: { ...sharedSettingsState.values, ...patch }, error: null });
        }
      } catch (error) {
        sharedSettingsState = { ...sharedSettingsState, pending: false, error: error instanceof Error ? error.message : "Could not change shared settings." };
        hudBar?.setResumeBlocked?.(aircraftSwitching || sharedSettingsBlocked() || damage.snapshot().destroyed);
        controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      }
    },
    onDamageAction: action => {
      if (action.type === "repair") damage.reset();
      else damage.applyImpact({ points: 25 });
      const state = damage.snapshot();
      hudBar?.setResumeBlocked?.(aircraftSwitching || sharedSettingsBlocked() || state.destroyed);
      if (state.destroyed) setSimulationPaused(true);
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    onViewModeChange: (mode) => { arrivalCamera?.dispose(); arrivalCamera = null; aircraft?.setViewMode(mode); phoneSession?.syncStatus(); runtime.requestRender(); },
    onAircraftApply: async (selection) => {
      const next = normalizeAircraftSelection(selection);
      if (next.aircraftId !== aircraftId) return session.onAircraftSwitch(next);
      const saveError = writeAircraftSelection(parameters, next);
      if (saveError) return redactIssueReport([
        saveError, await diagnostics.report({ allSettings: true }).catch(() => ""),
      ].join("\n"), reportSecrets(settings));
      followAircraftPresentation();
      return null;
    },
    onCollisionDebugChange: (enabled) => {
      collisionDebugEnabled = enabled;
      syncCollisionDebugOverlay();
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    // Debug A/B remains immediate and session-only; Settings can keep it explicitly.
    onWheelSpinModeChange: (mode) => {
      wheelExperiment = { rotation: mode, tireSound: mode === "off" ? false : wheelExperiment.tireSound };
      resetWheelSpin("mode");
      applyGroundRuntime();
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    onTireSoundChange: (enabled) => {
      // Synchronous inside the checkbox gesture so audio can unlock.
      wheelExperiment = { ...wheelExperiment, tireSound: enabled && wheelSpinMode !== "off" };
      applyGroundRuntime();
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    onSoundAction: (action) => {
      // Synchronous inside the control's gesture so audio can unlock.
      switch (action.type) {
        case "enable": flightAudio.setEnabled(action.enabled); break;
        case "quality": flightAudio.setQuality(action.quality); break;
        case "settings": flightAudio.patchSettings(action.patch); break;
        case "retest": flightAudio.retest(); break;
      }
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    onGroundInteractionAction: (action) => {
      handleGroundAction(action);
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    onAutopilotSettingsChange: (settings) => {
      applyAutopilotSettings(settings);
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    },
    onAutopilotEngageChange: (engaged) => {
      setAutopilotEngaged(engaged);
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    },
    onFuelChange: (contentsLbs) => {
      if (rearmWaitsForWheels()) return;
      writeFuelTanks(jsbsim.sdk, contentsLbs);
      // A paused flight is saved again only when it resumes; keep the new load now.
      if (inputManager.isPaused()) saveFlight();
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
    },
    onFuelAttachmentChange: (index, attached) => {
      // Respawn is a rearm; jettison never waits.
      if (attached && rearmWaitsForWheels()) return;
      const station = attached ? stationForFuelTank(index) : null;
      let clearedWeapon = false;
      if (station && storeMirror?.load[station]) {
        cancelArmament();
        writeStation(jsbsim.sdk, station, null);
        const load = storeMirror.load.slice();
        load[station] = null;
        storeMirror = { ...storeMirror, load };
        storeVisuals?.sync(storeMirror);
        clearedWeapon = true;
      }
      if (!setExternalFuelTankAttached(jsbsim.sdk, aircraftId, index, attached)) {
        if (clearedWeapon) {
          saveFlight();
          refreshArmament();
        }
        return;
      }
      if (!attached) externalTankVisuals?.jettison(index, releaseVelocity());
      externalTankVisuals?.sync(readExternalFuelTanks(jsbsim.sdk, aircraftId));
      saveFlight();
      refreshArmament();
    },
    onArmamentLoad: (next) => {
      if (!storeMirror || rearmRefusal(next, {
        groundOnly: parameters.get(REARM_GROUND_ONLY),
        onGround: aircraftOnGround(),
        masterArm: storeMirror.masterArm,
        tankOnStation: attachedTankStations(readExternalFuelTanks(jsbsim.sdk, aircraftId).flatMap(tank => tank.attached ? [tank.index] : [])),
      })) return;
      cancelArmament();
      let gunRounds = storeMirror.gunRounds;
      const load = storeMirror.load.slice();
      for (let station = 1; station <= 11; station++) {
        if ((next[station] ?? null) === load[station]) continue;
        const written = writeStation(jsbsim.sdk, station, next[station] ?? null);
        load[station] = next[station] ?? null;
        if (written.gunRounds !== null) gunRounds = written.gunRounds;
      }
      storeMirror = { ...storeMirror, load, gunRounds };
      selectedWeaponKey ??= initialWeapon(load, gunRounds);
      storeVisuals?.sync(storeMirror);
      saveFlight();
      refreshArmament();
    },
    onArmamentJettison: (station) => {
      // Armed or safe, in the air or not: jettison sheds weight; it is not a rearm.
      if (!storeMirror?.load[station]) return;
      cancelArmament();
      storeVisuals?.jettison(station, releaseVelocity());
      const written = writeStation(jsbsim.sdk, station, null);
      const load = storeMirror.load.slice();
      load[station] = null;
      storeMirror = { ...storeMirror, load, gunRounds: written.gunRounds ?? storeMirror.gunRounds };
      storeVisuals?.sync(storeMirror);
      saveFlight();
      refreshArmament();
    },
    onArmamentDoor: (bay, open) => {
      if (!storeMirror || !bayInterlock) return;
      if (fireControl.getPending()?.bay === bay) cancelArmament();
      // Writes the command now, or queues an open until the gear rests.
      bayInterlock.requestBay(bay, open);
      saveFlight();
      refreshArmament();
    },
    onArmamentMasterArm: setMasterArm,
    onArmamentSelect: (station) => {
      const key = storeMirror?.load[station];
      if (key) selectWeapon(key);
    },
    onArmamentSelectWeapon: selectWeapon,
    attachEngineDetails: (host, settingsContent) => engineMonitor.attachDetails(host, settingsContent),
    engineModel,
    onReloadFlight: () => {
      saveFlight();
      window.location.reload();
    },
    // The HUD bar is built later in this same synchronous setup, and the tab
    // only renders once opened, so the bar exists by the time this runs.
    attachInputMethod: (host) => hudBar?.mountInputMethod(host) ?? (() => {}),
    onLoggingAction: handleLoggingAction,
    flightRecorder,
    loadPhonePairing,
    loadMultiplayer,
    // A clean /rc/: nothing the simulator was opened with means anything there.
    onUseAsRemote: () => window.location.assign(appHref("rc", new URL(window.location.origin))),
  });
  audioPanelReady = true;
  if (multiplayerInvitation) controlPanel.openOrSelectTab("multiplayer");
  // On a headset's browser the VR tab opens once, to show the way in.
  if (headset) stopWatching.push(offerHeadsetTab(headset, () => controlPanel?.openOrSelectTab("vr"), preferenceStorage()));
  hudBar = createFlightHudBar(shellRoot, {
    renderActivity: runtime,
    rendererMode: runtime.renderer.mode,
    runtimeStatus: runtime.status,
    onInputModeChange: (mode) => { inputMode = mode; },
    onInputSensitivityChange: (settings) => { inputSensitivity = settings; },
    onPausedChange: (paused) => requestPaused(paused, setSimulationPaused),
    mapDetail: mapDetail!,
    onSettingsClick: () => panelRoot.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')?.click(),
    onBugReportClick: () => controlPanel?.toggleTab("bug-report"),
    onDebugClick: () => controlPanel?.toggleTab("debug"),
    onInputMethodClick: () => controlPanel?.toggleTab("controls"),
    onRendererClick: () => controlPanel?.toggleTab("renderer"),
    onMapClick: () => controlPanel?.toggleTab("map"),
    onStatusClick: () => controlPanel?.toggleTab("location"),
    seaLevel,
    onLogToggle: () => {
      // Below the two-window width FOSS Earth's windows hold the log in a Log tab.
      if (document.documentElement.dataset.logVisible === "false") {
        // The Log tab is the overlay's own, outside the flight's tab ids.
        controlPanel?.toggleTab("log" as FlightOverlayTab);
        return true;
      }
      log.setOpen(!log.isOpen());
      return log.isOpen();
    },
  });
  hudBar?.setResumeBlocked?.(aircraftSwitching || sharedSettingsBlocked() || damage.snapshot().destroyed);
  // Interface → Flight instruments → Layout: Compact moves the load, gear and
  // autopilot into the toolbar, so it waits for the toolbar.
  const applyHudLayout = (): void => {
    const layout = parameters.get("osfs.hud.layout");
    hudBar?.setLayout(layout);
    flightHud.setLayout(layout, hudBar?.instrumentSlot);
    runtime.requestRender();
  };
  applyHudLayout();
  stopWatching.push(parameters.watch("osfs.hud.layout", applyHudLayout));
  // Interface → Scale → UI scale: flight.css zooms the layers over the view.
  const flightAppElement = rootElement.querySelector<HTMLElement>(".flight-app");
  const applyUiScale = (): void => {
    flightAppElement?.style.setProperty("--flight-ui-scale", String(parameters.get("osfs.ui.scale")));
  };
  applyUiScale();
  stopWatching.push(parameters.watch("osfs.ui.scale", applyUiScale));
  statusOverlay = createFlightStatusOverlay(statusRoot, {
    onResume: () => setSimulationPaused(false),
  });

  /** Reasons recorded alongside the most recent physics fault. */
  const latestFaultReasons = (): string[] => {
    const entry = flightLog.entries().find(
      (candidate) => candidate.level === "error" && candidate.source === "physics",
    );
    const failed = entry?.detail?.failed;
    return Array.isArray(failed) ? failed.map(String) : [];
  };

  const updateStatusOverlay = (fault: string | null, nowMs: number): void => {
    let state: FlightStatusOverlayState = null;
    if (fault) {
      state = { kind: "fault", message: fault, failed: latestFaultReasons() };
    } else if (terrainBlockedSinceMs !== null) {
      const heldSeconds = (nowMs - terrainBlockedSinceMs) / 1000;
      // Single-frame misses are normal while tiles stream in; only say
      // something once the aircraft has actually stopped moving.
      if (heldSeconds >= 0.4) {
        state = terrainBlockedReason === "relocation" ? null
          : terrainBlockedReason === "coarse"
          ? {
              kind: "waiting", message: "World detail is too coarse for flight", heldSeconds,
              detail: `Flight requires World detail 2^${Math.log2(parameters.get("osfs.flight.minimum")).toFixed(2)} or finer. Choose finer World detail on the rail or in Map → Detail, or allow coarser terrain for this session there.`,
            }
          : {
              kind: "waiting", message: "Waiting for terrain height data", heldSeconds,
              detail: "No reliable terrain height is available under the aircraft yet, so the simulation is holding rather than guessing one.",
            };
      }
    }
    statusOverlay?.update(state);
  };

  hudBar.update(initialState, runtime.status, measuredFps, inputManager.isPaused(), groundHeightUnder(initialState));
  mapPanel.update(runtime.status);

  const ensureWorld = (): void => {
    mountFlightWorld();
  };

  const stepCombat = (dt: number, state: NonNullable<ReturnType<typeof physicsLoop.getLatestState>>): void => {
    if (!storeMirror) {
      if (gunFiring) { gunFiring = false; writeGunFiring(jsbsim.sdk, false); }
      return;
    }
    const clock = multiplayer?.combatClock();
    const nowMs = clock?.nowMs ?? performance.now();
    const connected = clock?.connected === true && Boolean(clock.selfId);
    const shooterId = connected && clock ? clock.selfId : "local";
    if (clock) engagement.track(clock.remotes, nowMs);
    const kinematics = kinematicsFromState(state, nowMs);
    const blocked = dt <= 0 || gearPipelineWarmup || damage.snapshot().destroyed || document.hidden || !armamentFocused || aircraftSwitching || !storeMirror.masterArm;
    if (blocked) cancelArmament();
    const trigger = weaponTrigger.read(inputManager.getWeaponRelease() > 0.5);
    const output = fireControl.step({
      dt, held: !blocked && trigger.held, pressed: !blocked && trigger.pressed, armed: storeMirror.masterArm,
      paused: blocked,
      rounds: storeMirror.gunRounds, gunPod: storeMirror.load[6] === "gau-22-pod",
      load: storeMirror.load, bayPos: storeMirror.bayPos, selectedWeaponKey,
      shooterId, kinematics, missileSpeedMps: 0,
      target: clock && clock.remotes.length ? bestTarget(kinematics, clock.remotes) : null,
    });
    const stoppedFiring = gunFiring && !output.firing;
    if (output.rounds !== storeMirror.gunRounds) {
      writeGunRounds(jsbsim.sdk, output.rounds);
      storeMirror = { ...storeMirror, gunRounds: output.rounds };
    }
    if (output.firing !== gunFiring) {
      gunFiring = output.firing;
      writeGunFiring(jsbsim.sdk, gunFiring);
    }
    if (output.door?.open) {
      const bay = output.door.bay;
      if (storeMirror.bayCmd[bay] < 0.5 && !bayInterlock?.queued(bay)) launchOwnedBay = bay;
      bayInterlock?.requestBay(bay, true);
    } else if (output.door && launchOwnedBay === output.door.bay) {
      bayInterlock?.requestBay(output.door.bay, false);
      launchOwnedBay = null;
    }
    if (output.consumedStation !== null) {
      const station = output.consumedStation;
      const written = writeStation(jsbsim.sdk, station, null);
      const load = storeMirror.load.slice();
      load[station] = null;
      storeMirror = { ...storeMirror, load, gunRounds: written.gunRounds ?? storeMirror.gunRounds };
      storeVisuals?.sync(storeMirror);
    }
    const send = (message: CombatMessage): void => {
      engagement.ingest(message);
      if (connected) multiplayer?.publishCombat(message);
    };
    for (const burst of output.bursts) send({ type: "fire", burst });
    for (const launch of output.launches) send({ type: "launch", launch });
    const result = engagement.step(nowMs, shooterId, damage.implementation === "health-v1");
    for (const claim of result.claims) if (connected) multiplayer?.publishCombat({ type: "hit", hit: claim });
    if (result.damage.length) {
      for (const points of result.damage) damage.applyImpact({ points });
      const health = damage.snapshot();
      hudBar?.setResumeBlocked?.(aircraftSwitching || sharedSettingsBlocked() || health.destroyed);
      if (health.destroyed) setSimulationPaused(true);
    }
    if (result.damage.length || stoppedFiring || output.launches.length || output.consumedStation !== null || output.door) {
      controlPanel?.update(createPanelSnapshot(state));
    }
    if (output.launches.length || output.consumedStation !== null) saveFlight();
    projectiles ??= createProjectileView(runtime.scene);
    const origin = floatingOrigin?.getOriginEcef();
    const frame = floatingOrigin?.getWorldFromEcef();
    projectiles.update(result.draw, origin && frame ? { origin, m: frame.m } : null);
    if (result.draw.length) runtime.requestRender();
  };

  const jsbsimEngines = engineIndices(jsbsim.sdk);
  /** Nothing turns: a drone's motors, or every engine and its propeller, spooled down. */
  const enginesStill = (surfaces: ControlSurfaceState): boolean => {
    const motors = droneMotorTelemetry()?.motors;
    if (motors) return motors.every(motor => Math.abs(motor.rpm) < 1);
    // A drone's JSBSim model has no engines to read: without its motors' telemetry, nothing says they stopped.
    if (droneAircraft) return false;
    return !(surfaces.propellerRadPerSec >= 0.1) && engineControl.reading().state !== "starting"
      && !enginesTurning(jsbsim.sdk, jsbsimEngines);
  };
  /** Wheels and structure contacts alike: a drone stands on structure contacts, which have no gear/unit WOW. */
  const contactPrefixes = (): readonly string[] => {
    try { return groundContactUnits(jsbsim.sdk).map(unit => unit.prefix); }
    catch { return ["gear/unit[0]/", "gear/unit[1]/", "gear/unit[2]/"]; }
  };
  /**
   * Once a frame, with the flight time physics advanced: an aircraft that has
   * stayed still on the ground with nothing turning and nobody flying it
   * rests, until wakeFromRest.
   */
  const observeRest = (surfaces: ControlSurfaceState, dtSeconds: number): void => {
    if (aircraftRest.isResting()) return;
    const eligible = !engineTest && !benchmarkRouteRun && !worldLoading && !inputManager.isPaused()
      && terrainContact.getRelocationProposal() === null && !lastApResult.engaged && !pilot.isOut()
      && !(inputManager.hasActiveFlightInput() || localStartHeld || flightHud.isPilotHolding())
      && touchingGround(jsbsim.sdk, contactPrefixes()) && enginesStill(surfaces);
    const pose = [surfaces.aileronLeftRad, surfaces.aileronRightRad, surfaces.elevatorRad, surfaces.rudderRad,
      surfaces.ruddervatorLeftRad, surfaces.ruddervatorRightRad, surfaces.flapRad, surfaces.gearDownNorm,
      surfaces.stovlPositionNorm ?? 0, surfaces.nozzlePitchRad ?? 0, surfaces.nozzleYawRad ?? 0];
    if (!aircraftRest.observe({ eligible, ...readAircraftMotion(jsbsim.sdk), pose }, dtSeconds)) return;
    flightLog.info("sim", "At rest: drawing frames only on demand until something moves the aircraft");
    restSettings = new Map(settings.list().filter(spec => spec.id.startsWith("osfs.")).map(spec => [spec.id, settingValue(spec.id)]));
    physicsLoop.setPaused(true);
    tireAudio.setPaused(true);
    flightAudio.setHeld(true, "rest");
    saveFlight();
    runtime.setSimRunning(false);
  };
  runtime.setSimTick((deltaSeconds) => {
    if (disposed) return;
    if (worldLoading) {
      const aim = applyPhoneCameraAim();
      if (aim) arrivalCamera?.takeover();
      localGlide.step(performance.now());
      phoneGlide.step(performance.now());
      // The arrival camera comes down only once a gliding orbit has stopped too.
      setOrbitInputActive("glide", localGlide.isActive("orbit") || phoneGlide.isActive("orbit"));
      cockpitLook.step();
      return;
    }
    flightTicks++;
    lastFlightTickAtMs = performance.now();
    flightSurface.beginFrame();
    const frameIntervalMs = deltaSeconds * 1000;
    // The runtime has closed the previous frame; this tick and Babylon's render of it land in the new one.
    const flightTickStarted = frameProfiler.clock();
    let sectionStarted = flightTickStarted;
    // Do not integrate the time spent idle when resuming the simulation.
    deltaSeconds = skipResumeDelta ? 0 : Math.min(deltaSeconds, 0.1);
    skipResumeDelta = false;
    const phoneAimAt = phoneCameraTrace ? performance.now() : 0;
    const phoneAim = applyPhoneCameraAim();
    // A glide moves only the chase camera: one begun in the cockpit would otherwise turn it on the way back out.
    if (aircraft?.getViewMode() !== "third") { localGlide.cancel(); phoneGlide.cancel(); }
    // Paced playout draws over several frames; a paused view renders only on request.
    if (phoneSession?.hasPendingCameraAim()) runtime.requestRender();
    // So does a glide, which moves the camera over the frames after its input.
    const glideAt = performance.now();
    const localGliding = localGlide.step(glideAt);
    const phoneGliding = phoneGlide.step(glideAt);
    if (localGliding || phoneGliding) runtime.requestRender();
    // A gliding orbit is still the pilot's: it returns only once it stops.
    setOrbitInputActive("glide", localGlide.isActive("orbit") || phoneGlide.isActive("orbit"));
    recenterOrbit(deltaSeconds);
    // Before this frame draws: entering the cockpit looks ahead in it at once.
    cockpitLook.sync();
    cockpitLook.step();
    cockpitScreen.update();

    fpsSampleFrames += 1;
    const frameNow = performance.now();
    const fpsSampleElapsedMs = frameNow - fpsSampleStartedMs;
    if (fpsSampleElapsedMs >= 500) {
      measuredFps = (fpsSampleFrames * 1000) / fpsSampleElapsedMs;
      fpsSampleStartedMs = frameNow;
      fpsSampleFrames = 0;
    }

    ensureWorld();

    // Spawn preparation is the only terrain-readiness gate. Once it has
    // placed the aircraft on known ground, streaming may update contact but
    // can never pause an already-running flight.
    const googleTiles = runtime.status.mode === "google-tiles";
    frameProfiler.add("flight/camera", sectionStarted);
    sectionStarted = frameProfiler.clock();
    if (!engineTest && !physicsLoop.getFault()
      && terrainContact.update(false, googleTiles, true, true) === "reset") {
      physicsLoop.reset();
      visibleMeshCollision.reset();
      wheelCues.setGroundRevision(++groundRevision);
      wakeFromRest("ground moved");
    }
    // A question about the ground needs physics: a standing aircraft keeps flying while it is asked.
    if (terrainContact.getRelocationProposal()) wakeFromRest("terrain question");
    updateTerrainOverlap();
    frameProfiler.add("flight/terrain", sectionStarted);

    sectionStarted = frameProfiler.clock();
    const physicsHeld = gearPipelineWarmup || inputManager.isPaused() || aircraftRest.isResting();
    physicsLoop.setPaused(physicsHeld);
    if (flightGamepadPolling.claimFlightFrame()) flightGamepadSource.tick();
    const controls = inputManager.poll(deltaSeconds);
    // A manual key/controller move also takes over while physics is paused.
    noticeLocalFlaps();
    frameProfiler.add("flight/input", sectionStarted);
    let terrainBlocked = false;
    const physicsStarted = frameProfiler.clock();
    const displayState = physicsLoop.update(deltaSeconds, () => {
      if (benchmarkRouteRun && benchmarkRouteRun.status !== "running") return false;
      const contactStarted = frameProfiler.clock();
      const contact = engineTest ? true : terrainContact.update(false, googleTiles, true, true);
      frameProfiler.add("flight/physics/terrain contact", contactStarted);
      if (contact === false) {
        terrainBlocked = true;
        terrainBlockedReason = terrainContact.getBlockReason();
        return false;
      }
      visibleMeshCollision.setTerrainOverlapIgnored(terrainContact.isTerrainIgnored());
      // A terrain correction is a placement, not a swept flight trajectory.
      // Discard the old probe positions before testing the next movement.
      // Surface refinement adjusts placement but must preserve tire momentum.
      if (contact === "reset") {
        visibleMeshCollision.reset();
        wheelCues.setGroundRevision(++groundRevision);
      }
      const collisionStarted = frameProfiler.clock();
      const collisionReset = !engineTest && visibleMeshCollision.update();
      frameProfiler.add("flight/physics/collision", collisionStarted);
      // Terrain/collision work can consume the remaining input lease. Check
      // authority immediately before allowing this step to advance physics.
      const fromPhone = phoneSession?.beforeStep(controls) ?? controls;
      if (fromPhone === false || inputManager.isPaused()) return false;
      const blended = controlBlend && phoneSession?.isBlending()
        ? controlBlend.step(fromPhone, controls, inputManager.getFlapsInputRevision(), controlSharing.priority) : fromPhone;
      // This computer's levers continue from where the two pilots left them.
      if (controlBlend && phoneSession?.isBlending()) inputManager.adoptLevers(blended);
      // A pilot who has passed out lets go of the stick, the pedals and the brakes.
      const selected = pilot.isOut() ? { ...blended, elevator: 0, aileron: 0, rudder: 0, brake: 0 } : blended;
      if (collisionReset) { resetWheelSpin("reset"); return "reset"; }
      if (phoneSession?.getSnapshot().owner === "phone") noticeRemoteFlaps(selected.flaps);
      else noticeLocalFlaps();
      const ap = engineTest ? { ...lastApResult, engaged: false, controls: selected, owners: idleAutopilotOwners() } : syncArbiter(selected);
      if (benchmarkRouteRun?.status === "failed") { inputManager.setPaused(true); return false; }
      const onGround = aircraftOnGround();
      const qbarPsf = jsbsim.sdk.getPropertyValue("aero/qbar-psf");
      const vtFps = jsbsim.sdk.getPropertyValue("velocities/vt-fps");
      const trimTuning = readAutoTrimTuning(parameters);
      const commanded = { ...ap.controls };
      // Gear and weapon-bay doors never move together. Nothing waiting, this reads nothing.
      if (ap.gearDownNorm !== armamentGearCommand) {
        armamentGearCommand = ap.gearDownNorm;
        // A gear request shuts the bays; it must not leave a launch waiting for an abandoned open.
        if (fireControl.getPending()) cancelArmament();
      }
      const gearDownNorm = bayInterlock ? bayInterlock.gearCommand(ap.gearDownNorm) : ap.gearDownNorm;
      const profile = getFdmProfile(aircraftId);
      // The pilot's roll rate shapes the stick only; an autopilot flies the source gradient.
      const fullStickRollRate = profile.fullStickRollRate && {
        property: profile.fullStickRollRate.property,
        degPerSec: ap.owners.roll === "pilot"
          ? parameters.get("osfs.aircraft.fullStickRollRate") : profile.fullStickRollRate.sourceDegPerSec,
      };
      // A fly-by-wire roll-rate law holds bank itself, and there roll trim commands a roll rate.
      const lawHoldsBank = !!fullStickRollRate && !!profile.controlLaw
        && jsbsim.sdk.getPropertyValue(profile.controlLaw.enabledProperty) > 0.5;
      // An engine that is off holds the throttle at idle until the lever is held to start it.
      const engine = engineControl.step(phoneSession?.getSnapshot().owner === "phone"
        ? phoneSession.isStarterHeld() || (localStartHeld && phoneSession.isBlending()) : localStartHeld);
      if (engine.state === "stopped") {
        commanded.throttle = 0;
        inputManager.replaceThrottle(0);
      }
      if (!engineTest && ap.owners.pitch === "pilot") {
        const pusher = getFdmProfile(aircraftId).sf50VariantId
          ? jsbsim.sdk.getPropertyValue("fcs/pusher-cmd-norm") : 0;
        const pitched = stepPitchAutoTrim(pitchAutoTrim, {
          dt: physicsDt,
          pitchAccelRad: jsbsim.sdk.getPropertyValue("accelerations/qdot-rad_sec2"),
          pitchRateRad: jsbsim.sdk.getPropertyValue("velocities/q-rad_sec"),
          elevator: selected.elevator + (Number.isFinite(pusher) ? pusher : 0),
          pitchTrim: commanded.pitchTrim,
          qbarPsf,
          vtFps,
          onGround,
        }, trimTuning);
        pitchAutoTrim = pitched.state;
        commanded.pitchTrim = pitched.pitchTrim;
        inputManager.replacePitchTrim(pitched.pitchTrim);
      }
      if (lawHoldsBank) {
        // Waiting: the assist adopts the wheel again if the law lets go.
        if (rollAutoTrim.trim !== null) rollAutoTrim = createAutoTrimState(rollAutoTrim.enabled);
      } else if (!engineTest && ap.owners.roll === "pilot") {
        const rolled = stepRollAutoTrim(rollAutoTrim, {
          dt: physicsDt,
          rollAccelRad: jsbsim.sdk.getPropertyValue("accelerations/pdot-rad_sec2"),
          rollRateRad: jsbsim.sdk.getPropertyValue("velocities/p-rad_sec"),
          aileron: selected.aileron,
          rollTrim: commanded.rollTrim,
          qbarPsf,
          vtFps,
          onGround,
        }, trimTuning);
        rollAutoTrim = rolled.state;
        commanded.rollTrim = rolled.rollTrim;
        inputManager.replaceRollTrim(rolled.rollTrim);
      }
      const autoFlapsEnabled = !engineTest && parameters.get("osfs.assist.autoFlaps") && ap.owners.flaps === "pilot";
      if (autoFlapsEnabled && profile.automaticFlaps.kind === "assist") {
        commanded.flaps = automaticFlapCommand(profile.automaticFlaps, {
          airspeedKts: jsbsim.sdk.getPropertyValue("velocities/vc-kts"),
          throttleNorm: commanded.throttle,
          gearDown: gearDownNorm > 0.5,
          onGround,
          currentCommand: appliedControls.flaps,
        });
      }
      const phoneDrone = phoneSession?.getDroneCommand() ?? null;
      if (phoneDrone && isDroneAircraftId(phoneDrone.droneId) && phoneDrone.droneId !== (aircraftId as string) && phoneDrone.droneId !== requestedDroneId) {
        requestedDroneId = phoneDrone.droneId;
        void session.onAircraftSwitch({ aircraftId: phoneDrone.droneId as AircraftId, lodId: "auto" });
      }
      droneHooks()?.beforeStep({
        dtSeconds: physicsDt,
        sdk: jsbsim.sdk,
        command: currentDroneCommand(phoneDrone, { ...selected, climb: pilot.isOut() ? 0 : inputManager.getClimbRateCommand() }),
        terrainMeters: terrainContact.isTerrainIgnored() ? null : latestTerrainMeters,
      });
      applyFlightControls(
        jsbsim.sdk,
        commanded,
        gearDownNorm,
        profile.rudderSign,
        profile.stovl ? {
          commandProperty: profile.stovl.commandProperty,
          commandNorm: parameters.get("osfs.aircraft.stovlConversion"),
        } : undefined,
        profile.controlLaw ? {
          commandProperty: profile.controlLaw.commandProperty,
          mode: parameters.get("osfs.aircraft.controlLaw"),
        } : undefined,
        profile.automaticFlaps.kind === "native" ? {
          commandProperty: profile.automaticFlaps.commandProperty,
          enabled: autoFlapsEnabled,
        } : undefined,
        fullStickRollRate,
        parameters.get("osfs.aircraft.rollTrimRange"),
      );
      appliedControls = { ...commanded };
      return contact;
    });
    frameProfiler.add("flight/physics", physicsStarted);
    sectionStarted = frameProfiler.clock();
    const feedbackHeld = inputManager.isPaused() || terrainBlocked || !!physicsLoop.getFault() || aircraftRest.isResting();
    tireAudio.setPaused(feedbackHeld);
    const slipPowerWatts = slipAudio.takeMeanPowerWatts();
    if (slipPowerWatts !== null) tireAudio.update(slipPowerWatts);
    haptics.tick(performance.now(), !feedbackHeld && !document.hidden);
    frameProfiler.add("flight/feedback", sectionStarted);

    const tickNowMs = performance.now();
    if (terrainBlocked) {
      if (terrainBlockedSinceMs === null) {
        terrainBlockedSinceMs = tickNowMs;
        flightLog.warn("terrain", terrainBlockedReason === "coarse"
          ? "Holding: World detail is below the flight requirement"
          : "Holding: no terrain height under the aircraft", {
          latDeg: Number(displayState.latDeg.toFixed(5)),
          lonDeg: Number(displayState.lonDeg.toFixed(5)),
          mapMode: runtime.status.mode,
        });
      }
    } else if (terrainBlockedSinceMs !== null) {
      flightLog.info("terrain", "Terrain height available again; physics resuming", {
        heldSeconds: Number(((tickNowMs - terrainBlockedSinceMs) / 1000).toFixed(2)),
      });
      terrainBlockedSinceMs = null;
      terrainBlockedReason = null;
    }

    const fault = physicsLoop.getFault();
    if (fault !== faultHistory.shown) {
      faultHistory.shown = fault;
      if (fault) {
        faultHistory.last = fault;
        faultHistory.atMs = tickNowMs;
        faultHistory.count += 1;
        faultHistory.impact = fault === HARD_GROUND_IMPACT_FAULT ? physicsLoop.getGroundImpact() : null;
      }
    }
    // A hard impact asks on its own card at the bottom, clear of the aircraft,
    // and holds physics and its sound until answered; it does not pause.
    const impact = fault === HARD_GROUND_IMPACT_FAULT;
    flightAudio.setHeld(impact, "fault");
    updateStatusOverlay(impact ? null : fault, tickNowMs);
    if (fault) {
      benchmarkRouteRun?.fail(fault);
      runtime.status.lastError = fault;
      runtime.status.message = fault;
      if (!impact && !inputManager.isPaused()) {
        // The fault detail was logged where it was raised; this records that
        // the fault is what took the simulator out of the user's hands.
        flightLog.warn("sim", "Pausing: physics reported a fault", { fault });
        setSimulationPaused(true);
      }
    }
    if (!feedbackHeld) {
      secondsSinceSave += deltaSeconds;
      if (secondsSinceSave >= parameters.get("osfs.start.saveInterval")) saveFlight();
    }

    sectionStarted = frameProfiler.clock();
    const sampledSurfaceHeight = flightSurface.sample(displayState.latDeg, displayState.lonDeg)?.heightMeters ?? null;
    latestTerrainMeters = sampledSurfaceHeight;
    const surfaceHeight = sampledSurfaceHeight ?? 0;
    frameProfiler.add("flight/terrain", sectionStarted);
    regionPreparation.update(displayState, aircraftBodyRadius);
    sectionStarted = frameProfiler.clock();
    runtime.setSimViewState({
      latDeg: displayState.latDeg,
      lonDeg: displayState.lonDeg,
      zoomMeters: zoomMetersFromAltitude(displayState.altMeters - surfaceHeight),
      headingDeg: (displayState.headingRad * 180) / Math.PI,
    });

    // The tick's surface queries end here: the floating origin is about to move the world.
    flightSurface.endFrame();
    floatingOrigin?.apply(displayState);
    if (floatingOrigin) droneHooks()?.afterView({
      paused: inputManager.isPaused(),
      terrainMeters: terrainContact.isTerrainIgnored() ? null : sampledSurfaceHeight,
      state: displayState,
      scene: runtime.scene,
      aircraftRoot: floatingOrigin.aircraftRoot,
      requestRender: () => runtime.requestRender(),
      rendererMode: runtime.renderer.mode,
    });
    stepCombat(inputManager.isPaused() || worldLoading || terrainBlocked || Boolean(physicsLoop.getFault()) ? 0 : deltaSeconds, displayState);
    externalTankVisuals?.sync(readExternalFuelTanks(jsbsim.sdk, aircraftId));
    externalTankVisuals?.update(externalTankStepSeconds);
    // Returns at once while nothing falls: a hung load adds no reads here.
    storeVisuals?.update(externalTankStepSeconds);
    externalTankStepSeconds = 0;
    // Two property reads, and only while a bay door is still moving.
    if (storeVisuals && storeMirror && !doorsSettled) {
      readBayDoorPositionsInto(jsbsim.sdk, storeMirror.bayPos);
      doorsSettled = storeVisuals.poseDoors(storeMirror.bayPos, storeMirror.bayCmd);
    }
    applyChaseFrame(displayState, deltaSeconds);
    flightCompass?.update(runtime.scene.activeCamera);
    const audioCamera = runtime.scene.activeCamera;
    if (aircraft && audioCamera && flightAudio.isEngineActive()) {
      flightAudio.updateView({
        camera: audioCamera,
        cockpitCamera: aircraft.firstPersonCamera,
        aircraftRoot: aircraft.root,
        exterior: aircraft.getViewMode() === "third" ? 1 : 0,
        // Unknown terrain switches the ground reflection off rather than guessing it.
        heightAboveGroundM: sampledSurfaceHeight === null ? null : displayState.altMeters - sampledSurfaceHeight,
      });
    }
    if (collisionDebugEnabled) collisionDebugOverlay?.update();
    forcesDebugOverlay?.update(true);
    if (collisionDebugEnabled && wheelSpinMode !== "off") wheelSpinDebugOverlay?.update();
    engineVisuals.read();
    const rig = aircraftModel?.getRig();
    if (aircraftModel) {
      const surfaceState = readControlSurfaceState(jsbsim.sdk, aircraftId, {
        nozzlePositionNorm: engineVisuals.nozzlePositionNorm(),
      });
      if (rig) applyAircraftRig(rig, surfaceState, deltaSeconds, {
        simulationHeld: feedbackHeld,
        propellerDiscs: parameters.get("osfs.aircraft.propellerDiscs"),
      });
      aircraftModel.updateGearVisibility(surfaceState.gearDownNorm, true);
      observeRest(surfaceState, physicsHeld || terrainBlocked || !!physicsLoop.getFault() ? 0 : deltaSeconds);
    }
    engineVisuals.updateRig(rig ?? null, true);
    frameProfiler.add("flight/view", sectionStarted);
    sectionStarted = frameProfiler.clock();
    const phoneOwned = phoneSession?.getSnapshot().owner === "phone";
    actualFlaps = readActualFlaps();
    actualControls = controlPositionReader.read();
    if (parameters.get("osfs.assist.autoFlaps") && lastApResult.owners.flaps === "pilot") {
      inputManager.replaceFlaps(appliedControls.flaps);
    }
    const hudControls = phoneOwned || lastApResult.engaged || pilot.isOut() ? appliedControls : controls;
    const hudAttitudeView = attitudeView();
    flightHud.update(
      displayState,
      hudControls,
      lastApResult.engaged ? lastApResult.gearDownNorm > 0 : inputManager.getGearDownNorm() > 0,
      { pitch: pitchAutoTrim.enabled, roll: rollAutoTrim.enabled },
      hudMasterAp(),
      hudAttitudeView,
    );
    frameProfiler.add("flight/hud", sectionStarted);
    const now = performance.now();
    if (now - lastPanelUpdateMs >= 100) {
      sectionStarted = frameProfiler.clock();
      lastPanelUpdateMs = now;
      controlPanel?.update(createPanelSnapshot(displayState));
      const armament = armamentState();
      if (armament) armamentWidget?.update(armament);
      hudBar?.update(displayState, runtime.status, measuredFps, displayPaused(), sampledSurfaceHeight);
      mapPanel.update(runtime.status);
      frameProfiler.add("flight/panels", sectionStarted);
    }
    sectionStarted = frameProfiler.clock();
    flightRecorder.sample(jsbsim.sdk);
    evaluationInstruments.update(jsbsim.sdk);
    // The pilot has followed each step already; the indicator shows the last.
    const shownPilotG = gIndicatorShown ? steppedPilotG ?? readPilotG(jsbsim.sdk) : null;
    if (shownPilotG !== null) gMeter.update(shownPilotG);
    steppedPilotG = null;
    const aoaDeg = evaluationInstruments.aoaDeg();
    const tints = readingTints(instrumentBands, {
      iasKt: displayState.airspeedKts, aoaDeg, g: shownPilotG,
      vsFpm: displayState.verticalSpeedFps * 60, flaps: actualFlaps,
      weightLb: jsbsim.sdk.getPropertyValue("inertia/weight-lbs"), onGround: aircraftOnGround(),
      jetBorne: vtolProfile !== undefined && jsbsim.sdk.getPropertyValue(vtolProfile.positionProperty) > 0.01,
    });
    flightHud.setReadingTints(tints);
    // The phone's pitch/roll pad draws the instrument this HUD does, from the
    // same frame, with the readings Compact writes on its corners.
    if (phoneSession?.isConnected() && parameters.get("osfs.phone.attitude")) {
      phoneSession.setAttitude(phoneAttitude(displayState, hudControls, hudAttitudeView, {
        iasKt: displayState.airspeedKts, altitudeFt: feetAboveSeaLevel(displayState), aoaDeg, tints,
      }));
    }
    // Every frame: a change of camera view changes what is drawn without a step.
    showGVision();
    engineMonitor.update(jsbsim.sdk, feedbackHeld || worldLoading);
    frameProfiler.add("flight/instruments", sectionStarted);
    phoneCameraTrace?.renderFrame({
      at: phoneAimAt, intervalMs: frameIntervalMs,
      dxPx: (phoneAim?.yaw ?? 0) * 1000, dyPx: (phoneAim?.pitch ?? 0) * 1000, zoom: phoneAim?.zoom ?? 1,
      gestureActive: phoneSession?.isCameraActive() ?? false,
      orbitYaw: orbitStateYaw, orbitPitch: orbitStatePitch, variant: phoneCameraVariant,
      rollDeg: displayState.rollRad * 180 / Math.PI, pitchDeg: displayState.pitchRad * 180 / Math.PI,
      headingDeg: displayState.headingRad * 180 / Math.PI,
      viewMode: aircraft?.getViewMode() ?? "third",
      mapDownloadBytesPerSecond: runtime.getMapDownloadBytesPerSecond(),
    });
    frameProfiler.add("flight", flightTickStarted);
    if (flightPerformance) {
      const tileMetrics = runtime.getTileMetrics();
      flightPerformance.record({
        frameIntervalMs,
        flightTickCpuMs: frameProfiler.current("flight"),
        terrainQueryCpuMs: frameProfiler.current("flight/terrain") + frameProfiler.current("flight/physics/terrain contact"),
        collisionCpuMs: frameProfiler.current("flight/physics/collision"),
        physicsLoopCpuMs: frameProfiler.current("flight/physics"),
        streamingTiles: runtime.isStreamingTiles(),
        mapDownloadBytesPerSecond: runtime.getMapDownloadBytesPerSecond(),
        visibleTiles: tileMetrics?.visibleTiles ?? null,
        activeTiles: tileMetrics?.activeTiles ?? null,
      });
    }
  });

  const revealAircraft = (state: ReturnType<typeof readFlightState>): void => {
    floatingOrigin?.apply(state);
    aircraftModel?.updateGearVisibility(readControlSurfaceState(jsbsim.sdk, aircraftId).gearDownNorm, true);
    floatingOrigin?.aircraftRoot.setEnabled(true);
    aircraft?.setViewMode(aircraft.getViewMode());
  };
  let preserveLoadingScreen = false;
  const app: FlightSessionHandle = {
    runtime, canvas,
    get alive() { return !disposed; },
    suspend() {
      cancelArmament();
      aircraftSwitching = true;
      hudBar?.setResumeBlocked?.(true);
      inputManager.setPaused(true);
      const state = physicsLoop.getLatestState() ?? readFlightState(jsbsim.sdk);
      let position: { x: number; y: number } | undefined;
      const camera = runtime.scene.activeCamera;
      if (camera && floatingOrigin && typeof floatingOrigin.aircraftRoot.getAbsolutePosition === "function") {
        const viewport = camera.viewport.toGlobal(runtime.renderer.engine.getRenderWidth(), runtime.renderer.engine.getRenderHeight());
        const projected = Vector3.Project(floatingOrigin.aircraftRoot.getAbsolutePosition(), Matrix.IdentityReadOnly, runtime.scene.getTransformMatrix(), viewport);
        const bounds = canvas.getBoundingClientRect();
        const x = projected.x * bounds.width / viewport.width;
        const y = projected.y * bounds.height / viewport.height;
        if ([x, y, projected.z].every(Number.isFinite) && projected.z >= 0 && projected.z <= 1
          && x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height) {
          position = { x: bounds.left + x, y: bounds.top + y };
        }
      }
      floatingOrigin?.aircraftRoot.setEnabled(false);
      controlPanel?.update(createPanelSnapshot(state));
      runtime.requestRender();
      return { state, flight: captureSavedFlight(jsbsim.sdk, aircraftId, true), health: damage.snapshot().health, damageImplementation: damage.implementation, weather: { ...weather },
        viewMode: aircraft?.getViewMode() ?? "third", selection: { aircraftId, generationId: aircraftGenerationId, lodId: aircraftLodId }, position };
    },
    finishSwitch() {
      aircraftSwitching = false;
      hudBar?.setResumeBlocked?.(sharedSettingsBlocked() || damage.snapshot().destroyed);
      floatingOrigin?.aircraftRoot.setEnabled(true);
      inputManager.setPaused(true);
      saveFlight();
      controlPanel?.update(createPanelSnapshot(physicsLoop.getLatestState() ?? initialState));
      runtime.requestRender();
    },
    report: () => diagnostics.report({ allSettings: true }),
    destroy(preserveWorld = false): void {
      if (disposed) return;
      cancelArmament();
      disposed = true;
      setDroneRemovalSwitch(null);
      startupAbort.abort();
      placementAbort.abort();
      regionPreparation.dispose();
      arrivalCamera?.dispose();
      placement.dispose();
      overlapNotice.dispose();
      if (!preserveLoadingScreen) {
        loading.destroy();
        if (!options.log) log.destroy();
      }
      phoneSession?.destroy();
      multiplayer?.dispose();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onArmamentBlur);
      window.removeEventListener("focus", onArmamentFocus);
      window.removeEventListener("keydown", onFocusKeyDown, { capture: true });
      window.removeEventListener("keyup", onFocusKeyUp, { capture: true });
      window.removeEventListener("pagehide", saveFlight);
      unbindRecorderMark();
      runtime.setSimTick(null);
      window.removeEventListener("keydown", onViewKeyDown, { capture: true });
      projectiles?.dispose();
      window.removeEventListener("keydown", hostFlightUi.noteKey, { capture: true });
      flightGamepadSource.stop();
      detachGamepadProfileInput();
      flightGamepadRuntime.dispose();
      flightGamepadSource.dispose();
      detachCameraInput();
      cockpitLook.dispose();
      cockpitScreen.dispose();
      detachInput();
      if (flightPerformance) setActiveFlightPerformanceCapture(null);
      if (benchmarkRouteRun && window.osfsFlightRoute === benchmarkRouteRun) delete window.osfsFlightRoute;
      for (const stop of stopWatching.splice(0)) stop();
      inputManager.dispose();
      unbindFrameProfile();
      setActiveFrameProfile(null);
      if (phoneCameraTrace) setActivePhoneCameraTrace(null);
      hudBar?.destroy();
      statusOverlay?.destroy();
      controlPanel?.destroy();
      deviceLocationMarker?.destroy();
      flightLocation.dispose();
      locationSearchParameters.destroy();
      presetsSection.destroy();
      savedSettingsSection.destroy();
      diagnosticsParameters.destroy();
      wasm.destroy();
      for (const handle of wasmParameters) handle.destroy();
      diagnosticsSection.destroy();
      bugReportPanel.destroy();
      testFeedback?.destroy();
      diagnostics.destroy();
      about.dispose();
      browserData.destroy();
      for (const { handle } of interfaceParameterSections) handle.destroy();
      toolbarParameters.destroy();
      mapPanel.destroy();
      overviewMap.destroy();
      disconnectMapDetail();
      mapDetail?.dispose();
      rendererPanel.destroy();
      skyPanel.destroy();
      timePanel.destroy();
      evaluationInstruments.destroy();
      gMeter.destroy();
      gVisionOverlay.destroy();
      engineMonitor.destroy();
      armamentWidget?.destroy();
      flightHud.destroy();
      flightCompass?.destroy();
      collisionDebugOverlay?.dispose();
      wheelSpinDebugOverlay?.dispose();
      forcesDebugOverlay?.dispose();
      meshInspector.dispose();
      haptics.dispose();
      gamepadHaptics.dispose();
      wheelCues.invalidate("dispose");
      tireAudio.dispose();
      // Before jsbsim.dispose(): the audio adapter's and the hull collision's property batches must not outlive the SDK.
      flightAudio.dispose();
      visibleMeshCollision.dispose();
      externalTankVisuals?.dispose();
      storeVisuals?.dispose();
      aircraftLights?.dispose();
      runtime.sky.setGroundLightReceiver(null);
      aircraftModel?.dispose();
      aircraft?.dispose();
      floatingOrigin?.dispose();
      jsbsim.dispose();
      if (!preserveWorld) runtime.destroy();
      if (terrainPerformanceCapture && debugWindow.fossTerrainPerformance === terrainPerformanceCapture) delete debugWindow.fossTerrainPerformance;
      if (!preserveWorld) rootElement.innerHTML = "";
    },
  };
  try {
    mountFlightWorld();
    startArrivalCamera(regionPreparation.target() ?? startupPreview);
    const terrain = await terrainReady;
    finishArrivalForOverride(terrain.overridden);
    await waitForArrival(startupAbort.signal);
    if (session.switching) {
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 120_000;
        const check = () => {
          if (disposed || session.signal?.aborted) { reject(new Error("Aircraft loading was cancelled.")); return; }
          const state = aircraftModel?.getState();
          if (state?.status === "ready") { resolve(); return; }
          if (state?.status === "error" || state?.status === "placeholder") {
            reject(new Error(state.error ?? "The selected aircraft has no usable model.")); return;
          }
          if (performance.now() > deadline) { reject(new Error("Aircraft model loading timed out after 120 seconds.")); return; }
          setTimeout(check, 25);
        };
        check();
      });
    }
    let state: FlightState | null = null;
    if (resumeFlight && terrain) {
      try {
        state = restoreSavedFlight(jsbsim.sdk, { ...resumeFlight, altMeters: terrain.altitudeMeters }, aircraftId, {
          ...terrain, groundHeightMeters: terrain.groundHeightMeters ?? terrain.altitudeMeters - 10000,
        }, getFdmProfile(aircraftId).stance);
        refreshStores();
        controlPanel?.update(createPanelSnapshot(state));
      } catch (error) {
        flightLog.warn("sim", "The saved flight could not be restored; it starts level where it was", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!state && terrain) state = placeAircraftAtLocation({
      ...spawn, ...startAttitude, altMeters: engineTest ? terrain.groundHeightMeters ?? terrain.altitudeMeters : terrain.altitudeMeters,
    }, terrain.groundHeightMeters);
    if (!state) throw new Error("Missing initial engine or flight state.");
    if (session.resume) applyWeather(weather);
    followControlLaw();
    // RunIC/saved restoration may restore the native scheduler flag. The
    // persisted assist request owns it, while feedback remains observational.
    noticeLocalFlaps();
    syncNativeAutoFlaps();
    actualFlaps = readActualFlaps();
    actualControls = controlPositionReader.read();
    const restoredFlapCommand = jsbsim.sdk.getPropertyValue("fcs/flap-cmd-norm");
    if (parameters.get("osfs.assist.autoFlaps") && lastApResult.owners.flaps === "pilot" && Number.isFinite(actualFlaps)) {
      inputManager.replaceFlaps(actualFlaps);
    } else if (Number.isFinite(restoredFlapCommand)) inputManager.replaceFlaps(restoredFlapCommand);
    lastLocalFlapsRevision = inputManager.getFlapsInputRevision();
    flightHud.update(state, inputManager.getControls(), inputManager.getGearDownNorm() > 0, {
      pitch: pitchAutoTrim.enabled, roll: rollAutoTrim.enabled,
    }, hudMasterAp(), attitudeView());
    // Overriding the map wait does not acknowledge terrain that later appears
    // through the aircraft; that still asks before anything moves it.
    terrainContact.reset();
    visibleMeshCollision.reset();
    visibleMeshCollision.setTerrainOverlapIgnored(terrainContact.isTerrainIgnored());
    physicsLoop.reset();
    revealAircraft(state);
    runtime.setSimViewState({ ...spawn, zoomMeters: zoomMetersFromAltitude(state.altMeters - (terrain?.groundHeightMeters ?? 0)) });
    worldLoading = false;
    cancelArmament();
    physicsLoop.setPaused(inputManager.isPaused());
    tireAudio.setPaused(inputManager.isPaused());
    flightAudio.setHeld(inputManager.isPaused(), "pause");
    flightAudio.setHeld(false, "loading");
    runtime.setSimRunning(!inputManager.isPaused());
    // F-35B starts gear-up, so its wheels are hidden before they are ever drawn.
    // Compiling them on the extend frame freezes the sim; do it under this screen.
    // mountFlightWorld assigns this, and the checker does not follow that call,
    // so the binding is still the initial null here.
    const gearModel = aircraftModel as AircraftModelHandle | null;
    const warmHiddenGear = gearModel?.warmHiddenGear;
    const hiddenGearPrepared = gearModel?.hiddenGearPrepared;
    if (warmHiddenGear && hiddenGearPrepared && !hiddenGearPrepared()) {
      gearPipelineWarmup = true;
      physicsLoop.setPaused(true);
      const deadline = performance.now() + 2000;
      try {
        while (!hiddenGearPrepared() && performance.now() < deadline) {
          engineVisuals.read();
          const rig = gearModel?.getRig() ?? null;
          if (rig) engineVisuals.updateRig(rig, true);
          warmHiddenGear();
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      } finally {
        gearPipelineWarmup = false;
        physicsLoop.setPaused(inputManager.isPaused());
      }
    }
    if (benchmarkRoute && runtime.status.mode !== "google-tiles") {
      throw new Error("A W0 benchmark route requires Google 3D Tiles; a fallback map cannot validate this route.");
    }
    // The page's content: the aircraft in its world, from the first frame without the loading screen.
    markBootOnFrame("boot:content", { onFrame(listener) {
      const observer = runtime.scene.onAfterRenderObservable.add(listener);
      return () => { runtime.scene.onAfterRenderObservable.remove(observer); };
    } }, () => true);
    diagnostics.checkpoint?.("component-execution.txt", JSON.stringify(earthWasmCores(runtime) ?? [], null, 2), true);
    loading.hide();
    if (benchmarkRoute) {
      const recordedSettings = Object.fromEntries(settings.list()
        .filter(spec => !spec.sensitive && !/key|token|password|secret/i.test(spec.id))
        .map(spec => [spec.id, settings.get(spec.id)]));
      benchmarkRouteRun = createBenchmarkRouteController(benchmarkRoute, state, terrain.groundHeightMeters ?? 0, physicsDt, recordedSettings);
      window.osfsFlightRoute = benchmarkRouteRun;
      frameProfile.configure({ windowFrames: 65_536 });
      frameProfiler.reset();
      setAutopilotEngaged(true);
      inputManager.setPaused(false);
    }
    if (engineTest) controlPanel?.openOrSelectTab("engine");
    runtime.requestRender();
    return app;
  } catch (error) {
    preserveLoadingScreen = true;
    // Diagnostics owns the log. Print recovery actions before destroy retires
    // that writer, or a failed start records an error without showing its UI.
    loading.fail("Flight could not start safely. Check your connection and map access, then retry.", {
      cause: error,
      ...(error instanceof TerrainRecoveryError ? { actions: [{ label: "Use OpenStreetMap", onClick() {
        const target = new URL(window.location.href);
        target.searchParams.delete("tiles");
        target.searchParams.delete("set.map.source.basemap");
        target.searchParams.set("mapSource", "osm-standard");
        window.location.assign(target.href);
      } }] } : {}),
    });
    app.destroy(Boolean(session.runtime));
    throw error;
  }
}
