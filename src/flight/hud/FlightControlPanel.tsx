import "foss-earth/windowing.css";

import type { FlightSectionFactory } from "../earthUiHost";
import { ChoiceTrack, closeHelpTooltipWithin, createHelpTooltip, createParameterControl, createParameterSection, HelpTip, IconButton, MeshInspectorPanel, ParameterSettings, Resettable, WindowOverlay, type PanelSection, type WindowOverlayHandle } from "foss-earth/shell";
import type { MeshInspectorHandle } from "foss-earth/diagnosticDrawing";
import type { SettingsRegistry } from "foss-earth/settings";
import {
  type GeodeticLocation,
  type WindowTabDefinition,
} from "foss-earth/windowing";
import type { FlightLocationPanel } from "../location/flightLocation";
import {
  Blocks,
  Bug,
  CloudSun,
  Camera,
  Crosshair,
  Fan,
  Flame,
  Fuel,
  Gauge,
  Navigation,
  ScrollText,
  Smartphone,
  Plane,
  Volume2,
  Weight,
  Users,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BabylonRuntimeStatus, DeviceLocationFix, RendererMode } from "foss-earth/runtime";
import type { FlightViewMode } from "@0sfs/aircraft/createPlaceholderAircraft";
import {
  AIRCRAFT_CATALOG,
  AIRCRAFT_FAMILIES,
  getAircraftDefinition,
  getAircraftFamilyForAircraft,
  normalizeAircraftSelection,
  subscribeAircraftCatalog,
  isAircraftFamilyId,
  type AircraftSelection,
  type AircraftId,
  type AircraftLodId,
} from "@0sfs/aircraft/aircraftCatalog";
import type { AircraftModelStatus } from "@0sfs/aircraft/createAircraftModel";
import { getFdmProfile, resolveEngineModel, type EngineModelId } from "../jsbsim/fdmProfiles";
import { JSBSIM_PACKAGE_VERSION } from "../jsbsim/jsbsimBuildIdentity";
import { AircraftSelectionPanel } from "@0sfs/aircraft/AircraftSelectionPanel";
import { GamepadBindingsPanel, type GamepadBindingsMount } from "@0sfs/controls/GamepadBindingsPanel";
import { flightLog, type FlightLogEntry } from "@0sfs/logging/flightLog";
import {
  getActiveFlightPerformanceCapture,
  type FlightPerformanceSummary,
} from "@0sfs/logging/flightPerformanceCapture";
import type { FlightState } from "@0sfs/ground-contact/flightState";
import type { CollisionDebugLegend } from "@0sfs/ground-contact/createCollisionDebugOverlay";
import { KEY_PAIRS, KEYBOARD_AXES, keyboardAxisParameterId, readKeyboardAxes } from "@0sfs/controls/keyboardAxisBindings";
import {
  KEYBOARD_STICK_PARAMETER_IDS,
  readKeyboardStickSettings,
  type KeyboardStickSettings,
} from "@0sfs/controls/keyboardStickSettings";
import { flightParameterSpec, type FlightParameterStore } from "../settings/flightParameters";
import { WHEEL_SPIN_CONFIGS, type WheelSpinMode, type WheelSpinState } from "@0sfs/ground-contact/wheelSpin";
import {
  GroundInteractionSettingsPanel,
  type GroundInteractionAction,
  type GroundInteractionPanelState,
} from "@0sfs/ground-contact/GroundInteractionSettingsPanel";
import { AutopilotPanel, type AutopilotPanelState } from "@0sfs/autopilot/AutopilotPanel";
import { FuelPanel, type FuelPanelState } from "@0sfs/fuel/FuelPanel";
import { ArmamentPanel, type ArmamentPanelState } from "@0sfs/stores/ArmamentPanel";
import { SoundSettingsPanel, type SoundAction } from "@0sfs/sound/SoundSettingsPanel";
import { AUDIO_PARAMETER_IDS } from "@0sfs/sound/audioSettings";
import { FrameBudgetPanel } from "./FrameBudgetPanel";
import { GResponsePreview, GVisionHint, PassOutHint } from "./GResponsePreview";
import { RemoteControlTab, type MountPhonePairing } from "@0sfs/rc/RemoteControlTab";
import { PhoneCameraTuningPanel } from "@0sfs/rc/PhoneCameraTuningPanel";
import { LoggingPanel, type LoggingAction, type LoggingPanelState } from "@0sfs/logging/LoggingPanel";
import { allowCloseLoggingTab } from "@0sfs/logging/loggingTab";
import type { FlightAudioStatus } from "@0sfs/sound/createFlightAudio";
import { AUTOPILOT_PARAMETER_IDS, type AutopilotSettingsV1 } from "@0sfs/autopilot/autopilotSettings";
import { GROUND_PARAMETER_IDS } from "@0sfs/ground-contact/groundInteractionSettings";
import type { FlightRecorder } from "@0sfs/logging/flightRecorder";
import { MultiplayerTab, type MountMultiplayer } from "../multiplayer/MultiplayerTab";
import { DamagePanel } from "../damage/DamagePanel";
import type { DamageAction } from "../damage/aircraftHealth";
import type { AircraftDamageSnapshot } from "../damage/aircraftDamage";
import { SharedSettingsPanel, type SharedSettingsPanelState } from "../multiplayer/SharedSettingsPanel";
import type { SharedSettingsPatch } from "@0sfs/multiplayer/sharedSettings";
import { ModsTab } from "../mods/ModsTab";

export type FlightPanelTab = "weather" | "aircraft" | "camera" | "fuel" | "armament" | "damage" | "shared-settings" | "autopilot" | "controls" | "remote" | "multiplayer" | "sound" | "exhaust" | "engine" | "gforces" | "logging" | "mods" | "debug";

const TAB_DEFINITIONS: readonly WindowTabDefinition<FlightPanelTab>[] = [
  { id: "weather", label: "Weather" },
  { id: "aircraft", label: "Aircraft" },
  { id: "camera", label: "Camera" },
  { id: "fuel", label: "Fuel" },
  { id: "armament", label: "Armament" },
  { id: "damage", label: "Damage" },
  { id: "shared-settings", label: "Shared settings" },
  { id: "autopilot", label: "Autopilot" },
  { id: "controls", label: "Controls" },
  { id: "remote", label: "Remote Control" },
  { id: "multiplayer", label: "Multiplayer" },
  { id: "sound", label: "Sound" },
  { id: "exhaust", label: "Exhaust" },
  { id: "engine", label: "Engine" },
  { id: "gforces", label: "G-forces" },
  { id: "logging", label: "Logging" },
  { id: "mods", label: "Mods" },
  { id: "debug", label: "Debug" },
];

const TAB_ICONS = {
  weather: CloudSun,
  aircraft: Plane,
  camera: Camera,
  fuel: Fuel,
  armament: Crosshair,
  damage: Crosshair,
  "shared-settings": Users,
  autopilot: Navigation,
  controls: Gauge,
  remote: Smartphone,
  multiplayer: Users,
  sound: Volume2,
  exhaust: Flame,
  engine: Fan,
  gforces: Weight,
  logging: ScrollText,
  mods: Blocks,
  debug: Bug,
} satisfies Record<FlightPanelTab, typeof Plane>;

const SOUND_PANEL_PARAMETER_IDS = AUDIO_PARAMETER_IDS.filter(id => id !== "osfs.sound.afterburnerVolume");

export interface FlightWeatherState {
  windDirectionDeg: number;
  windSpeedKts: number;
}

export interface FlightControlPanelSnapshot {
  flightState: FlightState;
  fps: number;
  paused: boolean;
  /** The flight the next session resumes, or null when none is saved. */
  savedFlight: { savedAtMs: number; latDeg: number; lonDeg: number } | null;
  viewMode: FlightViewMode;
  runtimeStatus: BabylonRuntimeStatus;
  rendererMode: RendererMode;
  aircraftId: AircraftId;
  generationId?: string;
  lodId: AircraftLodId;
  modelStatus: AircraftModelStatus;
  /** Level actually in the scene; differs from lodId while "Auto" is selected. */
  modelActiveLodId: AircraftLodId | null;
  modelTriangles: number | null;
  modelError: string | null;
  /** A complete aircraft is being prepared; resuming is blocked until it is ready. */
  aircraftSwitching?: boolean;
  collisionDebugEnabled: boolean;
  /** What the collision geometry shows for this aircraft, once shown. */
  collisionLegend?: CollisionDebugLegend | null;
  wheelSpinMode: WheelSpinMode | "off";
  tireSoundEnabled: boolean;
  tireAudioStatus: string | null;
  /** The shared sound runtime: engine sound and the tire cue. */
  sound: FlightAudioStatus;
  wheelSpinStates: readonly WheelSpinState[];
  groundInteraction: GroundInteractionPanelState;
  autopilot: AutopilotPanelState;
  fuel: FuelPanelState;
  /** Present when the loaded flight model has weapon stations. */
  armament?: ArmamentPanelState;
  damage: AircraftDamageSnapshot;
  sharedSettings: SharedSettingsPanelState;
  logging: LoggingPanelState;
}

/** Every tab the panel can show: the flight's own, and the shared globe tabs. */
export type FlightOverlayTab = "location" | "overview" | "map" | "renderer" | "sky" | "time" | "vr" | "bug-report" | "test-feedback" | "account" | "browser-data" | FlightPanelTab;

export interface FlightControlPanelOptions {
  /** The app's settings registry, whose sections the tabs draw. */
  settings: SettingsRegistry;
  /** Builds the tabs' settings sections with the page's refresh; FOSS Earth's compat one only follows settings changes. */
  createSection?: FlightSectionFactory;
  /** The flight's own parameters in it. */
  parameters: FlightParameterStore;
  /** The current aircraft hierarchy; the controller updates independently of flight telemetry. */
  meshInspector?: MeshInspectorHandle;
  /** The shared map of the view. Flight-only marks are drawn by the host that builds it. */
  overviewTab?: HTMLElement;
  /** The shared Basemap tab's contents, from `createMapSourcePanel`. */
  mapTab: HTMLElement;
  /** The shared Renderer tab's contents, from `createRendererPanel`. */
  rendererTab: HTMLElement;
  /** The shared Sky tab's contents, from `createSkyPanel`: where the Sun is, the atmosphere, the ground under it and exposure. */
  skyTab?: HTMLElement;
  /** The shared Date and time tab's contents, from `createDateTimePanel`: the dials that set the time the Sun is placed for. */
  timeTab?: HTMLElement;
  /** The shared Settings tab: presets and the saved record. */
  settingsSections: readonly PanelSection[];
  /** The shared Component execution tab: the startup WASM selection and what each converted core ran. */
  wasmSections?: readonly PanelSection[];
  /** The shared VR tab, from `createHeadsetPanel`: entering a headset session, and its controls. */
  headsetTab?: HTMLElement;
  /** The shared About tab, from `createAboutPanel`: which version runs, and what it is built from. */
  aboutTab?: HTMLElement;
  /** Sign in, and the signed-in account's Google 3D Tiles budget. */
  accountTab?: HTMLElement;
  /** Clears this website's saved browser state, preserving API keys by default. */
  browserDataTab?: HTMLElement;
  /** The shared Bug report tab, separate from the activity-trail settings. */
  bugReportTab?: HTMLElement;
  testFeedbackTab?: HTMLElement;
  /** The active aircraft camera controls, supplied by its lazy feature. */
  cameraTab?: HTMLElement;
  onBugReportShow?(): void;
  /** The shared Interface tab: the log and place search. */
  interfaceSections: readonly PanelSection[];
  initialWeather: FlightWeatherState;
  gamepadBindings?: GamepadBindingsMount;
  onLocationApply(location: GeodeticLocation): void;
  /** A device fix while GPS is on, or null when it stops. Draws the blue dot and accuracy disc. */
  onDeviceLocation?(fix: DeviceLocationFix | null): void;
  /** The flight's Location lookup, airport choice and saved form. */
  location?: FlightLocationPanel;
  /** The lookup's `search.*` limits, under the Location form. */
  locationSearchSection?: PanelSection;
  onWeatherChange(weather: FlightWeatherState): void;
  onPausedChange(paused: boolean): void;
  /** Discards the saved flight and starts again at the start position. */
  onNewFlight(): void;
  onDamageAction(action: DamageAction): void;
  onSharedSettingsPatch(patch: SharedSettingsPatch): void;
  onViewModeChange(mode: FlightViewMode): void;
  /** Activate an aircraft or presentation choice; resolves when ready, or with an error report. */
  onAircraftApply(selection: AircraftSelection): string | null | Promise<string | null>;
  onCollisionDebugChange(enabled: boolean): void;
  onWheelSpinModeChange(mode: WheelSpinMode | "off"): void;
  onTireSoundChange(enabled: boolean): void;
  /** Must act synchronously: the control's gesture is what unlocks audio. */
  onSoundAction(action: SoundAction): void;
  onGroundInteractionAction(action: GroundInteractionAction): void;
  onAutopilotSettingsChange(settings: AutopilotSettingsV1): void;
  onAutopilotEngageChange(engaged: boolean): void;
  /** New contents in pounds, by JSBSim tank number; tanks not listed keep theirs. */
  onFuelChange(contentsLbs: ReadonlyMap<number, number>): void;
  onFuelAttachmentChange?(index: number, attached: boolean): void;
  onArmamentLoad?(load: readonly (string | null)[]): void;
  onArmamentJettison?(station: number): void;
  onArmamentDoor?(bay: 0 | 1, open: boolean): void;
  onArmamentMasterArm?(armed: boolean): void;
  onArmamentSelect?(station: number): void;
  onArmamentSelectWeapon?(key: string): void;
  /** Hosts Engine's two sections, with the registry controls inside Settings. */
  attachEngineDetails(host: HTMLElement, settingsContent?: HTMLElement): () => void;
  /** The engine model this flight loaded, on an aircraft that offers a choice. */
  engineModel?: EngineModelId | null;
  /** Saves the flight and loads it again, so a newly chosen engine model flies. */
  onReloadFlight?(): void;
  /** Hosts the Input method section, shared with FOSS Earth, in the Controls tab. */
  attachInputMethod(host: HTMLElement): () => void;
  onLoggingAction(action: LoggingAction): void;
  flightRecorder: FlightRecorder;
  /** Pairing for the Remote Control tab, loaded the first time the tab opens. */
  loadPhonePairing(): Promise<MountPhonePairing>;
  loadMultiplayer?(): Promise<MountMultiplayer>;
  /** Leaves the simulator for the phone controller page on this device. */
  onUseAsRemote(): void;
}

export interface FlightControlPanelHandle {
  /** Test feedback is available only while the current URL requests it. */
  setTestFeedbackTab(element: HTMLElement | undefined): void;
  update(snapshot: FlightControlPanelSnapshot): void;
  openOrSelectTab(tabId: FlightOverlayTab): void;
  /** For a HUD button: shows the tab, or closes it when it is already showing. */
  toggleTab(tabId: FlightOverlayTab): void;
  destroy(): void;
}

interface FlightControlPanelProps extends FlightControlPanelOptions {
  snapshot: FlightControlPanelSnapshot;
  overlayApiRef: { current: WindowOverlayHandle<FlightPanelTab> | null };
}

function getTabLabel(tabId: FlightPanelTab): string {
  return TAB_DEFINITIONS.find((definition) => definition.id === tabId)?.label ?? tabId;
}

/**
 * Touch on a touchscreen, then the mouse or trackpad choice where there is a
 * pointer. The toolbar's input-method button opens this tab; it has no popup.
 */
export function InputMethodSettings({ attach }: { attach: (host: HTMLElement) => () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    return attach(host);
  }, [attach]);
  return (
    <fieldset className="flight-panel__fieldset">
      <legend>Input method</legend>
      <div ref={ref} />
    </fieldset>
  );
}

/**
 * Engine → Simulation: which engine model is flying, and, once another is
 * chosen, that it flies after a reload.
 */
function EngineModelStatus({ aircraftId, running, parameters, onReload }: {
  aircraftId: AircraftId;
  running: EngineModelId | null | undefined;
  parameters: FlightParameterStore;
  onReload?: () => void;
}) {
  const watch = useCallback((onChange: () => void) => parameters.watch("osfs.engine.model", onChange), [parameters]);
  const chosen = useSyncExternalStore(watch, () => parameters.get("osfs.engine.model"));
  const flying = running ? resolveEngineModel(aircraftId, running) : null;
  const next = resolveEngineModel(aircraftId, chosen);
  const helpHost = useRef<HTMLSpanElement>(null);
  const modelSummary = flying?.summary;
  useEffect(() => {
    if (!helpHost.current || !modelSummary) return;
    const content = document.createElement("p"); content.textContent = modelSummary;
    const help = createHelpTooltip({ label: "Flying engine model help", content });
    helpHost.current.append(help.element);
    return () => help.destroy();
  }, [modelSummary]);
  if (!flying) return null;
  return <>
    <p className="flight-panel__hint">
      <strong>Flying: {flying.label}</strong> · JSBSim {JSBSIM_PACKAGE_VERSION} <span ref={helpHost} />
    </p>
    {next && next.id !== flying.id && <p className="flight-panel__hint" role="status">
      {next.label} flies after the flight reloads.{" "}
      {onReload && <button type="button" className="flight-panel__command" onClick={onReload}>Reload now</button>}
    </p>}
  </>;
}

function EngineDetailsHost({ attach, children }: {
  attach: (host: HTMLElement, settingsContent?: HTMLElement) => () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The monitor owns the two persisted section shells. React still owns each
  // setting, including live applicability and the save-before-reload control.
  const [settingsContent] = useState(() => document.createElement("div"));
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    return attach(host, settingsContent);
  }, [attach, settingsContent]);
  return <>{createPortal(children, settingsContent)}<div className="flight-engine-host" ref={ref} /></>;
}

/** `Label [switch]`: the shared switch, label first, with the native checkbox inside, and a reset on it while it is not `defaultChecked`. */
function Switch({ label, accessibleLabel, checked, defaultChecked, disabled, onChange }: {
  label: string; accessibleLabel: string; checked: boolean; defaultChecked: boolean; disabled?: boolean; onChange(checked: boolean): void;
}) {
  return <label className="flight-panel__switch">
    <span>{label}</span>
    <Resettable changed={!disabled && checked !== defaultChecked} label={`Reset ${accessibleLabel} to the default: ${defaultChecked ? "on" : "off"}`}
      onReset={() => onChange(defaultChecked)}>
      <span className="foss-earth-choice foss-earth-switch">
        <input type="checkbox" aria-label={accessibleLabel} checked={checked} disabled={disabled}
          onChange={event => onChange(event.target.checked)} />
        <span className="foss-earth-switch__knob" aria-hidden="true" />
      </span>
    </Resettable>
  </label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flight-panel__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Calm, as a flight without a saved one starts. */
const DEFAULT_WEATHER: FlightWeatherState = { windDirectionDeg: 0, windSpeedKts: 0 };

function WeatherPanel({
  initialWeather,
  onWeatherChange,
}: Pick<FlightControlPanelProps, "initialWeather" | "onWeatherChange">) {
  const [weather, setWeather] = useState(initialWeather);

  const updateWeather = (partial: Partial<FlightWeatherState>) => {
    const next = { ...weather, ...partial };
    setWeather(next);
    onWeatherChange(next);
  };

  return (
    <div className="flight-panel__content">
      <label className="flight-panel__field">
        <span>Wind direction <output>{weather.windDirectionDeg.toFixed(0)}°</output></span>
        <Resettable changed={weather.windDirectionDeg !== DEFAULT_WEATHER.windDirectionDeg}
          label={`Reset Wind direction to the default: ${DEFAULT_WEATHER.windDirectionDeg}°`}
          onReset={() => updateWeather({ windDirectionDeg: DEFAULT_WEATHER.windDirectionDeg })}>
          <input
            type="range"
            min="0"
            max="359"
            value={weather.windDirectionDeg}
            onChange={(event) => updateWeather({ windDirectionDeg: Number(event.target.value) })}
          />
        </Resettable>
      </label>
      <label className="flight-panel__field">
        <span>Wind speed <output>{weather.windSpeedKts.toFixed(0)} kt</output></span>
        <Resettable changed={weather.windSpeedKts !== DEFAULT_WEATHER.windSpeedKts}
          label={`Reset Wind speed to the default: ${DEFAULT_WEATHER.windSpeedKts} kt`}
          onReset={() => updateWeather({ windSpeedKts: DEFAULT_WEATHER.windSpeedKts })}>
          <input
            type="range"
            min="0"
            max="50"
            value={weather.windSpeedKts}
            onChange={(event) => updateWeather({ windSpeedKts: Number(event.target.value) })}
          />
        </Resettable>
      </label>
      <button className="flight-panel__command" type="button" aria-label="Calm: clear the wind" title="Clear the wind"
        onClick={() => updateWeather({ windDirectionDeg: 0, windSpeedKts: 0 })}>
        Calm
      </button>
    </div>
  );
}

/**
 * One section of a tab, drawn by FOSS Earth from the settings registry: the
 * section's own controls (`children`, when it has any), a control for each
 * main-level parameter they do not cover, and Show all parameters.
 */
const SectionFactory = createContext<FlightSectionFactory>(createParameterSection);

function ParameterSection({ settings, tab, section, covers, children, afterControls = false }: {
  settings: SettingsRegistry;
  tab: string;
  section: string;
  /** Parameters `children` already edit, which the section should not draw again. */
  covers?: readonly string[];
  children?: ReactNode;
  afterControls?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [main] = useState(() => document.createElement("div"));
  const hasMain = children !== undefined;
  // Ids joined, so a new array with the same ids does not rebuild the section.
  const coverKey = covers?.join(" ") ?? "";
  const createSection = useContext(SectionFactory);
  useLayoutEffect(() => {
    const handle = createSection(settings, {
      tab,
      section,
      main: hasMain && !afterControls ? main : undefined,
      footer: hasMain && afterControls ? main : undefined,
      covers: coverKey === "" ? undefined : coverKey.split(" "),
    });
    host.current?.append(handle.element);
    return () => handle.destroy();
  }, [createSection, settings, tab, section, main, coverKey, hasMain, afterControls]);
  return <>
    <div className="flight-panel__parameter-section" ref={host} />
    {children !== undefined && createPortal(children, main)}
  </>;
}

interface AircraftPanelProps extends FlightControlPanelProps {
  aircraftSelection: AircraftSelection;
  onAircraftSelectionChange(selection: AircraftSelection): void;
  onAircraftFamilyChange(familyId: string): void;
}

function AircraftPanel({
  settings,
  parameters,
  meshInspector,
  snapshot,
  onPausedChange,
  onNewFlight,
  onViewModeChange,
  onAircraftApply,
  onGroundInteractionAction,
  aircraftSelection,
  onAircraftSelectionChange,
  onAircraftFamilyChange,
}: AircraftPanelProps) {
  const [switchMode, setSwitchMode] = useState(false);
  return (
    <div className="flight-panel__content">
      <AircraftSelectionPanel
        snapshot={snapshot}
        selection={aircraftSelection}
        onSelectionChange={onAircraftSelectionChange}
        onFamilyChange={onAircraftFamilyChange}
        onApply={onAircraftApply}
        switching={snapshot.aircraftSwitching}
        onSwitchModeChange={setSwitchMode}
      />
      <div className="flight-panel__aircraft-edit" hidden={switchMode}>
        <RegistryControls settings={settings} ids={["osfs.aircraft.propellerDiscs"]} />
        <ParameterSection settings={settings} tab="aircraft" section="camera">
          {/* "View [Cockpit / Chase] ?" */}
          <ChoiceTrack heading="View" value={snapshot.viewMode} defaultValue="third" onChange={mode => onViewModeChange(mode as FlightViewMode)}
            choices={[{ id: "first", label: "Cockpit" }, { id: "third", label: "Chase" }]}
            help="Cockpit shows the view from the pilot's seat. Chase follows the aircraft from outside." />
          {/* FOSS Earth's Glide, which its own Controls → Camera holds: the chase camera's zoom and the phone's swipes glide with it. */}
          <RegistryControls settings={settings} ids={["camera.inertiaDecay"]} />
        </ParameterSection>
        {/* "[Ⅱ] W/S Pitch  A/D Roll  Q/E Rudder  ⇧/⌃ Throttle": the keymap wraps as a paragraph. */}
        <div className="flight-panel__row">
          <IconButton icon={snapshot.paused ? "play" : "pause"} label={snapshot.paused ? "Resume simulation" : "Pause simulation"}
            disabled={snapshot.aircraftSwitching || snapshot.damage?.destroyed}
            onClick={() => onPausedChange(!snapshot.paused)} />
          <div className="flight-panel__keymap" aria-label="Flight controls">
            <KeyboardAxisHint parameters={parameters} climbRate={getAircraftDefinition(snapshot.aircraftId).controls?.vertical === "climb-rate"} />
          </div>
        </div>
        {/* The control law's own ? explains Auto, Manual and Fly-by-wire. */}
        {getFdmProfile(snapshot.aircraftId).controlLaw &&
          <ParameterSection settings={settings} tab="aircraft" section="flight-controls" />}
        <ParameterSection settings={settings} tab="aircraft" section="assists" />
        <ParameterSection settings={settings} tab="aircraft" section="ground" covers={GROUND_PARAMETER_IDS}>
          <GroundInteractionSettingsPanel state={snapshot.groundInteraction} onAction={onGroundInteractionAction} />
        </ParameterSection>
        <ParameterSection settings={settings} tab="aircraft" section="start">
          <div className="flight-panel__row">
            <p className="flight-panel__hint">{describeSavedFlight(snapshot.savedFlight)}</p>
            <button className="flight-panel__command" type="button" onClick={onNewFlight}
              aria-label="New flight: discard the saved flight and start again at the start position"
              title="Discard the saved flight and start again at the start position">
              New flight
            </button>
          </div>
        </ParameterSection>
        <details className="flight-panel__aircraft-inspector">
          <summary>Model inspection</summary>
          <ParameterSection settings={settings} tab="aircraft" section="mesh-inspector" afterControls>
            <MeshInspectorPanel inspector={meshInspector ?? null} />
          </ParameterSection>
        </details>
      </div>
    </div>
  );
}

function describeSavedFlight(flight: FlightControlPanelSnapshot["savedFlight"]): string {
  if (!flight) return "No flight saved. The next session starts at the start position.";
  const latitude = `${Math.abs(flight.latDeg).toFixed(4)}°${flight.latDeg >= 0 ? "N" : "S"}`;
  const longitude = `${Math.abs(flight.lonDeg).toFixed(4)}°${flight.lonDeg >= 0 ? "E" : "W"}`;
  return `Last saved ${new Date(flight.savedAtMs).toLocaleTimeString()}, at ${latitude} ${longitude}.`;
}

function formatDetail(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join("; ")}`;
      if (value && typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${String(value)}`;
    })
    .join("\n");
}

function EventLog() {
  const [entries, setEntries] = useState<readonly FlightLogEntry[]>(flightLog.entries());
  useEffect(() => flightLog.subscribe(setEntries), []);

  if (entries.length === 0) {
    return <p className="flight-panel__hint">No events yet. Automatic pauses and faults appear here.</p>;
  }

  return (
    <ol className="flight-panel__log">
      {entries.slice(0, 40).map((entry) => (
        <li key={entry.id} data-level={entry.level}>
          <div className="flight-panel__log-head">
            <span>{(entry.atMs / 1000).toFixed(1)}s</span>
            <strong>{entry.source}</strong>
            <span>{entry.message}</span>
          </div>
          {entry.detail ? <pre>{formatDetail(entry.detail)}</pre> : null}
        </li>
      ))}
    </ol>
  );
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)} ms`;
}

function FlightPerformancePanel() {
  const [summary, setSummary] = useState<FlightPerformanceSummary | null>(
    () => getActiveFlightPerformanceCapture()?.snapshot() ?? null,
  );
  useEffect(() => {
    const refresh = () => setSummary(getActiveFlightPerformanceCapture()?.snapshot() ?? null);
    refresh();
    const interval = window.setInterval(refresh, 500);
    return () => window.clearInterval(interval);
  }, []);

  if (!summary) {
    return <p className="flight-panel__hint">Open the simulator with <code>flightPerf=1</code> in the URL to capture stutters.</p>;
  }

  const copyTrace = (): void => {
    const capture = getActiveFlightPerformanceCapture();
    if (!capture || !navigator.clipboard) return;
    void navigator.clipboard.writeText(JSON.stringify(capture.exportTrace()));
  };

  return (
    <fieldset className="flight-panel__fieldset">
      <legend>Stutter trace</legend>
      <div className="flight-panel__metrics">
        <Metric label="Samples" value={summary.sampleCount.toLocaleString()} />
        <Metric label="Frame p95" value={formatMilliseconds(summary.frame.p95Ms)} />
        <Metric label="Frame p99" value={formatMilliseconds(summary.frame.p99Ms)} />
        <Metric label="Worst frame" value={formatMilliseconds(summary.frame.maxMs)} />
        <Metric label="Physics p95" value={formatMilliseconds(summary.physicsLoop.p95Ms)} />
        <Metric label="Terrain p95" value={formatMilliseconds(summary.terrainQuery.p95Ms)} />
        <Metric label="Collision p95" value={formatMilliseconds(summary.collision.p95Ms)} />
        <Metric label="Tick p95" value={formatMilliseconds(summary.flightTick.p95Ms)} />
      </div>
      <div className="flight-panel__row">
        <p className="flight-panel__hint">
          {`${summary.slowFrames.over50Ms} over 50 ms · ${summary.slowFrames.over100Ms} over 100 ms · ${summary.streamingFrames} streamed tiles`}
        </p>
        <IconButton icon="copy" label="Copy performance trace" onClick={copyTrace} />
        <HelpTip label="Explain the stutter trace">
          <p>Frames slower than 50 and 100 ms, and how many frames streamed map tiles. The same trace is available in DevTools as <code>window.osfsFlightPerformance</code>.</p>
        </HelpTip>
      </div>
    </fieldset>
  );
}

function KeyboardAxisHint({ parameters, climbRate }: { parameters: FlightParameterStore; climbRate: boolean }) {
  const [axes, setAxes] = useState(() => readKeyboardAxes(parameters));
  useEffect(() => {
    const stops = KEYBOARD_AXES.map(axis => parameters.watch(keyboardAxisParameterId(axis), () => setAxes(readKeyboardAxes(parameters))));
    return () => stops.forEach(stop => stop());
  }, [parameters]);
  return <>{KEYBOARD_AXES.map(axis => <span key={axis}><kbd>{KEY_PAIRS[axes[axis]].label}</kbd> {{ pitch: "Pitch", roll: "Roll", yaw: "Yaw", power: climbRate ? "Climb" : "Throttle" }[axis]}</span>)}</>;
}

const KEYBOARD_STICK_MODES = flightParameterSpec("osfs.input.keyboard.mode").choices;

/** The keyboard stick as its parameters stand, following every change. */
function useKeyboardStickSettings(parameters: FlightParameterStore): KeyboardStickSettings {
  const [settings, setSettings] = useState(() => readKeyboardStickSettings(parameters));
  useEffect(() => {
    const update = () => setSettings(readKeyboardStickSettings(parameters));
    const stops = KEYBOARD_STICK_PARAMETER_IDS.map(id => parameters.watch(id, update));
    update();
    return () => { for (const stop of stops) stop(); };
  }, [parameters]);
  return settings;
}

/** The parameters each response mode reads; expo applies to every mode. */
const KEYBOARD_MODE_PARAMETERS: Record<KeyboardStickSettings["mode"], readonly string[]> = {
  direct: [],
  smooth: ["smoothResponseSec", "smoothReturnSec"],
  rate: ["rateTimeToFull", "rateTimeToCenter", "rateAccelAfterSec", "rateAccelMultiplier", "rateMaxDeflection"],
  assist: ["assistRollRateDeg", "assistPitchRateDeg", "assistYawRateDeg", "assistKp", "assistKi", "assistKd", "assistMaxDeflection"],
};

/** Shared parameter controls for these ids, following the registry. */
function RegistryControls({ settings, ids }: { settings: SettingsRegistry; ids: readonly string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const key = ids.join(" ");
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent || key === "") return;
    const handles = key.split(" ").map(id => createParameterControl(settings, id));
    parent.replaceChildren(...handles.map(handle => handle.element));
    const stop = settings.subscribe(() => { for (const handle of handles) handle.update(); });
    return () => { stop(); for (const handle of handles) handle.destroy(); };
  }, [settings, key]);
  return <div className="foss-earth-choices flight-panel__registry-controls" ref={host} />;
}

/**
 * Controls → Keyboard response: the section draws Response mode from the
 * registry, then this draws the parameters that mode uses with the same
 * shared controls. Show all parameters lists every one, with its reset.
 */
function KeyboardModeParameters({ settings, parameters }: { settings: SettingsRegistry; parameters: FlightParameterStore }) {
  const { mode } = useKeyboardStickSettings(parameters);
  const fields = KEYBOARD_STICK_MODES.some(choice => choice.id === mode) ? KEYBOARD_MODE_PARAMETERS[mode] : [];
  return <RegistryControls settings={settings} ids={[...fields, "expo"].map(field => `osfs.input.keyboard.${field}`)} />;
}

const countOf = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

function DebugPanel({ snapshot, settings, onCollisionDebugChange, onWheelSpinModeChange, onTireSoundChange }: Pick<FlightControlPanelProps,
  "snapshot" | "settings" | "onCollisionDebugChange" | "onWheelSpinModeChange" | "onTireSoundChange">) {
  return (
    <div className="flight-panel__content">
      <div className="flight-panel__metrics">
        <Metric label="Frame rate" value={`${Math.round(snapshot.fps)} fps`} />
        <Metric label="Renderer" value={snapshot.rendererMode.toUpperCase()} />
        <Metric label="Map runtime" value={snapshot.runtimeStatus.mode} />
        <Metric label="Camera" value={snapshot.viewMode} />
      </div>
      <ParameterSection settings={settings} tab="debug" section="aircraft-visuals" />
      <ParameterSection settings={settings} tab="debug" section="forces" afterControls>
        {/* A terse colour key; what the arrows mean is behind ?. */}
        <p className="flight-panel__hint">
          Green lift · red drag · purple side · amber thrust · blue weight · white total · yellow net{" "}
          <HelpTip label="Explain the force arrows">
            <p>
              Native forces at their observed application points: green lift, red drag, purple side force,
              amber propulsion, blue weight, white applied total and yellow net including gravity.
              Labels show actual kN even when arrow lengths are capped. Arrows point in the force direction;
              an upward thrust arrow shows the force on the aircraft, opposite the exhaust.
              Aerodynamic coefficients and individual parts are not inferred.
            </p>
          </HelpTip>
        </p>
      </ParameterSection>
      <fieldset className="flight-panel__fieldset">
        <legend>Collision geometry</legend>
        {/* "Show [switch] ?" */}
        <div className="flight-panel__row">
          <Switch label="Show" accessibleLabel="Show aircraft collision geometry" checked={snapshot.collisionDebugEnabled} defaultChecked={false}
            onChange={onCollisionDebugChange} />
          <HelpTip label="Explain collision geometry">
            <p>Visible through the aircraft in either camera view. Off by default; resets when the game reloads.</p>
            <p>
              These are contact points, not a solid collision mesh. Marker sizes and lines from the centre
              are visual guides. Body probes sweep between physics steps near the ground.
            </p>
            <p>Shows the flight model's points for the aircraft you are flying, which is what the physics touches the ground with.</p>
            <p>Each contact is a spring that sinks into the ground under the aircraft's weight, so a resting contact sits a little below its drawn wheel or foot.</p>
          </HelpTip>
        </div>
        {snapshot.collisionDebugEnabled &&
          <div className="flight-panel__metrics" aria-label="Collision geometry legend">
            {!!snapshot.collisionLegend?.bodyProbes &&
              <Metric label="Cyan" value={countOf(snapshot.collisionLegend.bodyProbes, "swept body probe")} />}
            {!!snapshot.collisionLegend?.wheels &&
              <Metric label="Amber" value={countOf(snapshot.collisionLegend.wheels, "wheel contact")} />}
            {!!snapshot.collisionLegend?.structures &&
              <Metric label="Purple" value={countOf(snapshot.collisionLegend.structures, "structural contact")} />}
            <Metric label="White" value="Centre of gravity" />
          </div>}
      </fieldset>
      <fieldset className="flight-panel__fieldset">
        <legend>Wheel spin experiment</legend>
        {/* "[Off / A / B] ?  Tire sound [switch]" */}
        <div className="flight-panel__row">
          <ChoiceTrack heading="Wheel spin experiment" hideHeading value={snapshot.wheelSpinMode} defaultValue="off"
            onChange={mode => onWheelSpinModeChange(mode as WheelSpinMode | "off")}
            choices={[
              { id: "off", label: "Off" },
              { id: "instant", label: "A · Instant rolling", shortLabel: "A" },
              { id: "inertia", label: "B · Gradual spin-up", shortLabel: "B" },
            ]}
            help={<>
              <p>A rolls the wheels at once; B spins them up gradually.</p>
              <p>
                Compare wheel rotation and touchdown sound. Aircraft handling and braking stay the same.
                Changing modes resets the wheels; compare from an airborne approach. These choices are a
                session-only override of Aircraft → Ground handling, which can keep them.
              </p>
              <p>
                Enable collision geometry above to see tire outlines and rotating spokes.
                The outlines show estimated tire size; amber dots remain the contact references.
                Spin-up sound fades as the tread matches ground speed.
              </p>
            </>} />
          <Switch label="Tire sound" accessibleLabel="Enable tire sound" checked={snapshot.tireSoundEnabled} defaultChecked={false}
            disabled={snapshot.wheelSpinMode === "off"} onChange={onTireSoundChange} />
        </div>
        {snapshot.tireAudioStatus && <p className="flight-panel__hint" role="status">{snapshot.tireAudioStatus}</p>}
        {snapshot.wheelSpinMode !== "off" && <>
          <div className="flight-panel__metrics" aria-label="Wheel spin telemetry">
            {snapshot.wheelSpinStates.map((wheel, index) => <Metric key={index}
              label={WHEEL_SPIN_CONFIGS[index].name.replaceAll("_", " ")}
              value={`${Math.round(wheel.omegaRadSec * 60 / (2 * Math.PI))} rpm · ${wheel.slipMetersSec.toFixed(1)} m/s slip${wheel.onGround ? " · contact" : " · air"}`} />)}
          </div>
        </>}
      </fieldset>
      <div className="flight-panel__debug-status">
        <Gauge size={18} aria-hidden="true" />
        <span>{snapshot.runtimeStatus.lastError ?? snapshot.runtimeStatus.message}</span>
      </div>
      <FrameBudgetPanel />
      <FlightPerformancePanel />
      <fieldset className="flight-panel__fieldset">
        <legend>Event log</legend>
        <EventLog />
        <IconButton icon="trash" label="Clear log" onClick={() => flightLog.clear()} />
      </fieldset>
    </div>
  );
}

/** Mount an owned DOM panel without destroying its state when its tab closes. */
function ElementTab({ element }: { element: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host.current?.append(element);
    return () => { closeHelpTooltipWithin(element); element.remove(); };
  }, [element]);
  return <div ref={host} />;
}

export function FlightControlPanel(props: FlightControlPanelProps) {
  const hasArmament = Boolean(props.snapshot.armament);
  const additionalTabs = useMemo(() => TAB_DEFINITIONS.filter(tab =>
    (tab.id !== "armament" || hasArmament) && (tab.id !== "camera" || props.cameraTab)),
    [hasArmament, props.cameraTab]);
  // Keep drafts above the tabs so visiting another tab does not discard them.
  // Each family remembers its own generation and model choices for this session.
  const [selectedAircraftFamily, setSelectedAircraftFamily] = useState<string>(
    () => getAircraftFamilyForAircraft(props.snapshot.aircraftId).id,
  );
  const [aircraftSelections, setAircraftSelections] = useState<AircraftSelection[]>(() => {
    const activeFamily = getAircraftFamilyForAircraft(props.snapshot.aircraftId);
    return AIRCRAFT_FAMILIES.map(family => normalizeAircraftSelection(
      family.id === activeFamily.id ? props.snapshot : {
        aircraftId: family.defaultAircraftId,
        lodId: props.snapshot.lodId,
      },
    ));
  });
  useEffect(() => subscribeAircraftCatalog(() => {
    setAircraftSelections(previous => {
      const live = previous.filter(entry => AIRCRAFT_CATALOG.some(item => item.id === entry.aircraftId));
      const byFamily = new Map(live.map(entry => [getAircraftFamilyForAircraft(entry.aircraftId).id, entry]));
      return AIRCRAFT_FAMILIES.map(family => normalizeAircraftSelection(
        byFamily.get(family.id) ?? { aircraftId: family.defaultAircraftId, lodId: props.snapshot.lodId },
      ));
    });
    setSelectedAircraftFamily(current => {
      if (AIRCRAFT_FAMILIES.some(family => family.id === current)) return current;
      const next = AIRCRAFT_FAMILIES[0]?.id;
      return next && isAircraftFamilyId(next) ? next : current;
    });
  }), [props.snapshot.lodId]);
  const aircraftSelection = aircraftSelections.find(
    selection => getAircraftFamilyForAircraft(selection.aircraftId).id === selectedAircraftFamily,
  ) ?? normalizeAircraftSelection(props.snapshot);
  const onAircraftSelectionChange = (selection: AircraftSelection) => {
    const familyId = getAircraftFamilyForAircraft(selection.aircraftId).id;
    setAircraftSelections(previous => previous.map(entry =>
      getAircraftFamilyForAircraft(entry.aircraftId).id === familyId ? selection : entry,
    ));
    setSelectedAircraftFamily(familyId);
  };

  return (
    // Hand-drawn controls of registry parameters reset against the registry ParameterSettings provides.
    <SectionFactory.Provider value={props.createSection ?? createParameterSection}><ParameterSettings.Provider value={props.settings}>
      <WindowOverlay<FlightPanelTab>
        overlayApiRef={props.overlayApiRef}
        overviewTab={props.overviewTab}
        mapTab={props.mapTab}
        rendererTab={props.rendererTab}
        skyTab={props.skyTab}
        timeTab={props.timeTab}
        settingsSections={props.settingsSections}
        wasmSections={props.wasmSections}
        interfaceSections={props.interfaceSections}
        headsetTab={props.headsetTab}
        aboutTab={props.aboutTab}
        accountTab={props.accountTab}
        browserDataTab={props.browserDataTab}
        bugReportTab={props.bugReportTab}
        testFeedbackTab={props.testFeedbackTab}
        onBugReportShow={props.onBugReportShow}
        getViewState={() => props.snapshot.flightState}
        setViewState={props.onLocationApply}
        onDeviceLocation={props.onDeviceLocation}
        locationSearchProvider={props.location?.searchProvider}
        locationContribution={props.location?.contribution}
        locationHostDataCodec={props.location?.hostDataCodec}
        locationDraft={props.location?.draft}
        locationSearchSection={props.locationSearchSection}
        additionalTabs={additionalTabs}
        onBeforeCloseTab={(tabId) => {
          if (tabId !== "logging") return;
          if (!allowCloseLoggingTab(props.flightRecorder)) return false;
        }}
        renderAdditionalTab={(tabId) => {
          const Icon = TAB_ICONS[tabId];
          return <>
            {tabId !== "controls" && <div className="flight-panel__title">
              <Icon size={17} aria-hidden="true" />
              <span>{getTabLabel(tabId)}</span>
            </div>}
            {tabId === "weather" ? <WeatherPanel initialWeather={props.initialWeather} onWeatherChange={props.onWeatherChange} />
              : tabId === "aircraft" ? <AircraftPanel {...props}
                aircraftSelection={aircraftSelection}
                onAircraftSelectionChange={onAircraftSelectionChange}
                onAircraftFamilyChange={setSelectedAircraftFamily} />
                // One "Rearm on the ground only" setting, drawn in both tabs it governs.
                : tabId === "fuel" ? <ParameterSection settings={props.settings} tab="fuel" section="rearm" afterControls>
                  <FuelPanel state={props.snapshot.fuel} onChange={props.onFuelChange}
                    onAttachmentChange={props.onFuelAttachmentChange} />
                </ParameterSection>
                : tabId === "armament" && props.snapshot.armament ? <ParameterSection settings={props.settings} tab="fuel"
                  section="rearm" afterControls>
                  <div className="flight-panel__content">
                    <ArmamentPanel state={props.snapshot.armament}
                      onLoad={props.onArmamentLoad ?? (() => {})}
                      onJettison={props.onArmamentJettison ?? (() => {})}
                      onDoor={props.onArmamentDoor ?? (() => {})}
                      onMasterArm={props.onArmamentMasterArm ?? (() => {})}
                      onSelect={props.onArmamentSelect}
                      onSelectWeapon={props.onArmamentSelectWeapon} />
                  </div>
                </ParameterSection>
                : tabId === "damage" ? <DamagePanel state={props.snapshot.damage} onAction={props.onDamageAction} />
                : tabId === "shared-settings" ? <SharedSettingsPanel state={props.snapshot.sharedSettings} onChange={props.onSharedSettingsPatch} />
                : tabId === "autopilot" ? <ParameterSection settings={props.settings} tab="autopilot" section="package"
                  covers={AUTOPILOT_PARAMETER_IDS}>
                  <AutopilotPanel
                    state={props.snapshot.autopilot}
                    onSettingsChange={props.onAutopilotSettingsChange}
                    onEngageChange={props.onAutopilotEngageChange} />
                </ParameterSection>
                : tabId === "controls" ? <div className="flight-panel__content">
                  {props.snapshot.aircraftId === "f-35b" &&
                    <ParameterSection settings={props.settings} tab="controls" section="braking" />}
                  {getAircraftDefinition(props.snapshot.aircraftId).afterburner &&
                    <ParameterSection settings={props.settings} tab="controls" section="afterburner" />}
                  {getFdmProfile(props.snapshot.aircraftId).stovl &&
                    <ParameterSection settings={props.settings} tab="controls" section="stovl">
                      <p className="flight-panel__hint">Use the VTOL lever beside THR: 0% conventional flight; 100% lift fan and downward nozzle. Conversion takes time. Experimental STOVL handling.</p>
                    </ParameterSection>}
                  <InputMethodSettings attach={props.attachInputMethod} />
                  {props.gamepadBindings
                    ? <GamepadBindingsPanel mount={props.gamepadBindings} />
                    : <p className="flight-panel__hint">Controller bindings are unavailable in this session.</p>}
                  <ParameterSection settings={props.settings} tab="controls" section="gamepad">
                    <p className="flight-panel__hint">
                      Polling and response apply across binding profiles, and are saved on this device.
                      They do not change keyboard, on-screen stick, or phone response.
                    </p>
                  </ParameterSection>
                  <ParameterSection settings={props.settings} tab="controls" section="keys" />
                  <ParameterSection settings={props.settings} tab="controls" section="keyboard" afterControls>
                    <KeyboardModeParameters settings={props.settings} parameters={props.parameters} />
                  </ParameterSection>
                  <ParameterSection settings={props.settings} tab="controls" section="orbit" />
                  <ParameterSection settings={props.settings} tab="controls" section="feedback" />
                </div>
                : tabId === "remote" ? <RemoteControlTab loadPhonePairing={props.loadPhonePairing} onUseAsRemote={props.onUseAsRemote}
                  sharing={<ParameterSection settings={props.settings} tab="remote" section="control" />}
                  phoneSettings={<ParameterSection settings={props.settings} tab="remote" section="phone" />}
                  cameraTuning={<ParameterSection settings={props.settings} tab="remote" section="camera">
                    <PhoneCameraTuningPanel parameters={props.parameters} />
                  </ParameterSection>} />
                : tabId === "multiplayer" ? props.loadMultiplayer
                  ? <MultiplayerTab load={props.loadMultiplayer} /> : <p>Multiplayer is unavailable.</p>
                : tabId === "sound" ? <ParameterSection settings={props.settings} tab="sound" section="sound" covers={SOUND_PANEL_PARAMETER_IDS}>
                  <SoundSettingsPanel state={props.snapshot.sound} onAction={props.onSoundAction} />
                </ParameterSection>
                : tabId === "exhaust" ? <div className="flight-panel__content">
                  <fieldset className="flight-panel__fieldset">
                    <legend>{props.settings.getSectionTitle("exhaust", "gas")}</legend>
                    <ParameterSection settings={props.settings} tab="exhaust" section="gas" />
                  </fieldset>
                  <fieldset className="flight-panel__fieldset">
                    <legend>{props.settings.getSectionTitle("exhaust", "smoke")}</legend>
                    <ParameterSection settings={props.settings} tab="exhaust" section="smoke" />
                  </fieldset>
                  {getAircraftDefinition(props.snapshot.aircraftId).afterburner &&
                    <fieldset className="flight-panel__fieldset">
                      <legend>{props.settings.getSectionTitle("exhaust", "afterburner")}</legend>
                      <ParameterSection settings={props.settings} tab="exhaust" section="afterburner" />
                    </fieldset>}
                </div>
                : tabId === "engine" ? <EngineDetailsHost attach={props.attachEngineDetails}>
                  {getFdmProfile(props.snapshot.aircraftId).engineModels &&
                    <fieldset className="flight-panel__fieldset">
                      <legend>{props.settings.getSectionTitle("engine", "simulation")}</legend>
                      <ParameterSection settings={props.settings} tab="engine" section="simulation">
                        <EngineModelStatus aircraftId={props.snapshot.aircraftId} running={props.engineModel}
                          parameters={props.parameters} onReload={props.onReloadFlight} />
                      </ParameterSection>
                    </fieldset>}
                  <ParameterSection settings={props.settings} tab="engine" section="engine" />
                  <ParameterSection settings={props.settings} tab="engine" section="history" />
                  <ParameterSection settings={props.settings} tab="engine" section="test" />
                </EngineDetailsHost>
                : tabId === "gforces" ? <div className="flight-panel__content">
                  <ParameterSection settings={props.settings} tab="gforces" section="indicator" />
                  <ParameterSection settings={props.settings} tab="gforces" section="pilot" afterControls>
                    <GResponsePreview parameters={props.parameters} />
                  </ParameterSection>
                  <ParameterSection settings={props.settings} tab="gforces" section="vision">
                    <GVisionHint parameters={props.parameters} />
                  </ParameterSection>
                  <ParameterSection settings={props.settings} tab="gforces" section="pass-out">
                    <PassOutHint parameters={props.parameters} />
                  </ParameterSection>
                </div>
                : tabId === "logging" ? <LoggingPanel state={props.snapshot.logging} onAction={props.onLoggingAction} />
                : tabId === "camera" ? props.cameraTab && <ElementTab element={props.cameraTab} />
                : tabId === "mods" ? <ModsTab />
                : <DebugPanel snapshot={props.snapshot} settings={props.settings} onCollisionDebugChange={props.onCollisionDebugChange}
                  onWheelSpinModeChange={props.onWheelSpinModeChange} onTireSoundChange={props.onTireSoundChange} />}
          </>;
        }}
      />
    </ParameterSettings.Provider></SectionFactory.Provider>
  );
}
