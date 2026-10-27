import type { HudInputMode, InputSensitivitySettings } from "foss-earth/input";
import { attachParameterReset, checkChoice, createChoiceGroup, createExternalLinkIcon } from "@foss-earth/ui/browser";
import "foss-earth/shell.css";
import "foss-earth/input-mode.css";

import { attachFullscreenButton, attachMapDownloadSpeed, attachRendererActivity, attachTileStreamingActivity, createInputModeHud, createHudBar, createMapSourceHud, createPositionReadout, fitHudBar, getRendererLabel, setMapSourceLabel, surfaceHeightDatum, type HudBarFitItem, type HudBarHandle, type InputModeHudOptions, type MapDetailController, type PositionSeaLevelPort, type RenderActivitySource, type TileStreamingSource, type MapDownloadSource } from "foss-earth/shell";
import type { BabylonRuntimeStatus, RendererMode } from "foss-earth/runtime";
import { getAppSettings, TOOLBAR_EDIT_PRIORITIES_ID, TOOLBAR_PRIORITIES, toolbarPriorityParameterId, type ToolbarItemId } from "foss-earth/settings";
import { headingDegFromRad, type FlightState } from "@0sfs/ground-contact/flightState";
import { LOADING_LIVE_ATTRIBUTE } from "../../loading/createFlightLoadingScreen";
import type { FlightHudLayout } from "./flightHud";
import { SEA_LEVEL_GRID_ID, seaLevelMeters } from "./seaLevel";

export interface FlightHudBarOptions {
  renderActivity: RenderActivitySource & TileStreamingSource & MapDownloadSource;
  rendererMode: RendererMode;
  runtimeStatus: BabylonRuntimeStatus;
  onInputModeChange(mode: HudInputMode): void;
  onInputSensitivityChange(settings: InputSensitivitySettings): void;
  onPausedChange(paused: boolean): void;
  /** The shared detail controller behind the rail beside the basemap and the Map tab's Detail group. */
  mapDetail: MapDetailController;
  onSettingsClick(): void;
  /** Toggles the shared Bug report tab. */
  onBugReportClick(): void;
  /** The FPS chip toggles the Debug tab. */
  onDebugClick(): void;
  /** The input-method button toggles the Controls tab, the settings' one home. */
  onInputMethodClick(): void;
  /** The renderer chip toggles the Renderer tab, where the renderer is chosen. */
  onRendererClick(): void;
  /** The basemap's name, at the bar's right end, toggles the Map tab. */
  onMapClick(): void;
  /** The position readout toggles the Location tab. */
  onStatusClick(): void;
  /**
   * Where sea level is over Google 3D Tiles, whose heights are the WGS84
   * ellipsoid's: without it the altitude above sea level is a dash there.
   */
  seaLevel?: PositionSeaLevelPort;
  /** Opens or closes the game log history; returns whether it is now open. */
  onLogToggle?(): boolean;
}

export interface FlightHudBarHandle {
  /**
   * `groundHeightMeters` is the terrain's height under the aircraft, or null
   * while none has loaded there: what the altitude above ground is measured from.
   */
  update(state: FlightState, status: BabylonRuntimeStatus, fps: number | null, paused: boolean, groundHeightMeters?: number | null): void;
  /** Draws the Input method section into the Controls tab. Returns an unmount. */
  mountInputMethod(container: HTMLElement): () => void;
  /** Loading a replacement aircraft keeps pause engaged. */
  setResumeBlocked?(blocked: boolean): void;
  /**
   * Classic shows the position as one readout. Compact splits it into
   * latitude and longitude, altitude, heading and pitch chips, writes the
   * frame rate over its unit, and shows `instrumentSlot` before the bar's end.
   */
  setLayout(layout: FlightHudLayout): void;
  /** Where the Compact layout puts the load, gear and autopilot. */
  instrumentSlot: HTMLElement;
  destroy(): void;
}

// FOSS Earth's Interface → Position readout parameters, which the split chips follow too.
const ALTITUDE_REFERENCE_ID = "interface.position.altitude";
const ALTITUDE_UNIT_ID = "interface.position.altitudeUnit";
const METERS_PER_FOOT = 0.3048;
const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The eight-point compass direction nearest a heading in degrees. */
export function compassPoint(headingDeg: number): (typeof COMPASS_POINTS)[number] {
  return COMPASS_POINTS[((Math.round(headingDeg / 45) % 8) + 8) % 8]!;
}

/** A chip with its value over its label, as the frame rate's in FOSS Earth. */
interface ReadingChip {
  value: HTMLSpanElement;
  setValue(text: string): void;
  setLabel(text: string): void;
}

function setData(text: Text, data: string): void {
  if (text.data !== data) text.data = data;
}

function createReadingChip(element: HTMLElement, label: string): ReadingChip {
  const document = element.ownerDocument;
  const value = document.createElement("span");
  value.className = "flight-reading__value";
  const valueText = document.createTextNode("\u2014");
  value.append(valueText);
  const labelElement = document.createElement("span");
  labelElement.className = "flight-reading__label";
  const labelText = document.createTextNode(label);
  labelElement.append(labelText);
  element.replaceChildren(value, labelElement);
  return { value, setValue: text => setData(valueText, text), setLabel: text => setData(labelText, text) };
}

/** What the input method section offers is decided from the pointer and touch the device reports. */
function inputDeviceHints(): InputModeHudOptions["deviceHints"] {
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return {
    platform: userAgentData?.platform ?? navigator.platform ?? "",
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    finePointer: window.matchMedia?.("(pointer: fine)").matches ?? true,
  };
}

export function createFlightHudBar(container: HTMLElement, options: FlightHudBarOptions): FlightHudBarHandle {
  const hudBar: HudBarHandle = createHudBar(container, {
    ariaLabel: "Flight simulator controls",
    items: [
      { kind: "button", id: "flightPauseButton", title: "Pause simulation", ariaLabel: "Pause simulation", className: "flight-shell-pause-button", text: "Ⅱ" },
      { kind: "button", id: "flightFps", title: "Rendered frames per second. Click to show or hide the Debug tab.", ariaLabel: "Frame rate. Show or hide Debug", ariaLive: "polite", appearance: "chip", className: "hud-chip-button", text: "FPS —" },
      { kind: "button", id: "flightRendererButton", title: "GPU renderer API. Click to show or hide the Renderer tab.", ariaLabel: "GPU renderer API", appearance: "chip", className: "hud-chip-button hud-chip--gpu", text: getRendererLabel(options.rendererMode) },
      { kind: "button", id: "flightSettingsButton", title: "Open flight settings", ariaLabel: "Open flight settings", className: "settings-button", text: "⚙" },
      { kind: "button", id: "flightFullscreenButton", title: "Enter fullscreen", ariaLabel: "Enter fullscreen", className: "flight-fullscreen-button", text: "⛶" },
      { kind: "button", id: "flightLogButton", title: "Show the game log history", ariaLabel: "Show the game log history", className: "flight-log-button", text: "☰" },
      { kind: "button", id: "flightBugReportButton", title: "Show or hide Bug report", ariaLabel: "Show or hide Bug report", text: "🐞" },
      { kind: "button", id: "flightShellStatus", appearance: "chip", className: "hud-chip-button hud-status-text", ariaLive: "polite", ariaLabel: "Aircraft position", title: "Latitude, longitude, altitude and heading. Click to show or hide the Location tab." },
      { kind: "button", id: "flightLatLon", appearance: "chip", className: "hud-chip-button flight-reading-chip", ariaLabel: "Latitude and longitude. Show or hide Location", title: "Latitude and longitude. Click to show or hide the Location tab." },
      { kind: "button", id: "flightAltitude", appearance: "chip", className: "hud-chip-button flight-reading-chip", ariaLabel: "Altitude. Show or hide Location", title: "Altitude, above sea level or the ground as Interface → Position readout says. Click to show or hide the Location tab." },
      { kind: "button", id: "flightHeading", appearance: "chip", className: "hud-chip-button flight-reading-chip", ariaLabel: "Heading. Show or hide Location", title: "Heading, in degrees, over its compass point. Click to show or hide the Location tab." },
      { kind: "button", id: "flightPitch", appearance: "chip", className: "hud-chip-button flight-reading-chip", ariaLabel: "Pitch. Show or hide Location", title: "Pitch, in degrees: positive nose up. Click to show or hide the Location tab." },
      { kind: "slot", id: "flightInstrumentSlot", className: "flight-toolbar-instruments", ariaLabel: "Load, gear and autopilot" },
      { kind: "slot", id: "flightMapSourceSlot", className: "hud-bar-end map-source-hud-slot" },
    ],
  });

  const pauseButton = hudBar.getElement<HTMLButtonElement>("flightPauseButton");
  const fpsButton = hudBar.getElement<HTMLButtonElement>("flightFps");
  const rendererButton = hudBar.getElement<HTMLButtonElement>("flightRendererButton");
  const mapSourceSlot = hudBar.getElement("flightMapSourceSlot");
  const settingsButton = hudBar.getElement<HTMLButtonElement>("flightSettingsButton");
  const statusElement = hudBar.getElement<HTMLButtonElement>("flightShellStatus");
  const bugReportButton = hudBar.getElement<HTMLButtonElement>("flightBugReportButton");
  const latLonButton = hudBar.getElement<HTMLButtonElement>("flightLatLon");
  const altitudeButton = hudBar.getElement<HTMLButtonElement>("flightAltitude");
  const headingButton = hudBar.getElement<HTMLButtonElement>("flightHeading");
  const pitchButton = hudBar.getElement<HTMLButtonElement>("flightPitch");
  const instrumentSlot = hudBar.getElement("flightInstrumentSlot");
  if (!pauseButton || !fpsButton || !rendererButton || !mapSourceSlot || !settingsButton || !statusElement || !bugReportButton
    || !latLonButton || !altitudeButton || !headingButton || !pitchButton || !instrumentSlot) {
    hudBar.destroy();
    throw new Error("Flight HUD bar failed to mount.");
  }
  // Pausing works while the world loads too; the flight then starts paused.
  pauseButton.setAttribute(LOADING_LIVE_ATTRIBUTE, "");

  // The World detail rail, then the download speed and basemap as one button,
  // then its credit link, sit at the bar's right end, shared with FOSS Earth.
  const mapSource = createMapSourceHud(mapSourceSlot, {
    document,
    ui: { createExternalLinkIcon, attachMapDownloadSpeed, setMapSourceLabel, attachTileStreamingActivity },
    activity: options.renderActivity,
    onProviderClick: options.onMapClick,
    detail: { document, controller: options.mapDetail, name: "World detail" },
  });
  const detachRendererActivity = attachRendererActivity(rendererButton, options.renderActivity);
  // FOSS Earth's readout: Interface → Position readout says how it is written.
  const position = createPositionReadout(statusElement, getAppSettings(), { seaLevel: options.seaLevel });
  // Compact's split chips. The latitude and longitude are FOSS Earth's readout
  // without the altitude, so they are marked as Interface → Position readout says.
  const positionChips = [latLonButton, altitudeButton, headingButton, pitchButton];
  const latLonChip = createReadingChip(latLonButton, "lat, lon");
  const latLon = createPositionReadout(latLonChip.value, getAppSettings());
  const altitudeChip = createReadingChip(altitudeButton, "ft ASL");
  const headingChip = createReadingChip(headingButton, "N");
  const pitchChip = createReadingChip(pitchButton, "pitch");
  // The frame rate's chip keeps its button; Compact writes it over its unit.
  const fpsValue = document.createElement("span");
  fpsValue.className = "flight-reading__value";
  const fpsLabel = document.createElement("span");
  fpsLabel.className = "flight-reading__label";
  fpsLabel.textContent = "fps";
  let fpsText = "\u2014";
  let layout: FlightHudLayout = "classic";
  // The device decides what the section offers: Touch on a touchscreen, and the
  // mouse or trackpad choice where there is a pointer; a touch laptop gets both.
  const inputHud = createInputModeHud(container, pauseButton, {
    document,
    settings: getAppSettings(),
    ui: { attachParameterReset, checkChoice, createChoiceGroup },
    // The per-event wheel log is for developer pages: FOSS Earth's ?dev=1.
    showDebug: new URLSearchParams(window.location.search).getAll("dev").join() === "1",
    deviceHints: inputDeviceHints(),
    log: console,
    movements: ["orbit", "zoom"],
    trackpadOrbitGesture: "swipe",
    gestureDescription: (mode, movement) => movement === "orbit"
      ? (mode === "mouse" ? "Right-click drag to orbit" : mode === "touch" ? "Two-finger drag to orbit" : "Two-finger swipe to orbit")
      : (mode === "mouse" ? "Mouse wheel to zoom" : "Pinch to zoom"),
    onModeChange: options.onInputModeChange,
    onSensitivityChange: options.onInputSensitivityChange,
    onToggle: options.onInputMethodClick,
  });

  rendererButton.classList.toggle("hud-chip--good", options.rendererMode === "webgpu");
  rendererButton.classList.toggle("hud-chip--bad", options.rendererMode !== "webgpu");

  let paused = false;
  const updatePauseState = (nextPaused: boolean): void => {
    paused = nextPaused;
    pauseButton.textContent = paused ? "▶" : "Ⅱ";
    pauseButton.title = paused ? "Resume simulation" : "Pause simulation";
    pauseButton.setAttribute("aria-label", pauseButton.title);
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.classList.toggle("is-active", paused);
  };
  const onPauseClick = () => {
    updatePauseState(!paused);
    options.onPausedChange(paused);
  };

  const fullscreenButton = hudBar.getElement<HTMLButtonElement>("flightFullscreenButton");
  const logButton = hudBar.getElement<HTMLButtonElement>("flightLogButton");
  const detachFullscreen = fullscreenButton ? attachFullscreenButton(fullscreenButton) : () => {};
  const onLogClick = (): void => { logButton?.setAttribute("aria-pressed", String(options.onLogToggle?.() ?? false)); };
  if (logButton) {
    logButton.hidden = !options.onLogToggle;
    logButton.setAttribute("aria-pressed", "false");
  }
  logButton?.addEventListener("click", onLogClick);

  pauseButton.addEventListener("click", onPauseClick);
  rendererButton.addEventListener("click", options.onRendererClick);
  statusElement.addEventListener("click", options.onStatusClick);
  for (const chip of positionChips) chip.addEventListener("click", options.onStatusClick);
  settingsButton.addEventListener("click", options.onSettingsClick);
  fpsButton.addEventListener("click", options.onDebugClick);
  bugReportButton.addEventListener("click", options.onBugReportClick);
  mapSource.update(options.runtimeStatus);

  const settings = getAppSettings();
  const visibilityId = "interface.toolbar.bugReport";
  const priorityId = toolbarPriorityParameterId("bugReport");
  const defaultPriority = (item: ToolbarItemId): number => TOOLBAR_PRIORITIES.find(([id]) => id === item)![2];
  const applyBugVisibility = (): void => {
    bugReportButton.toggleAttribute("data-hud-choice-hidden", settings.get(visibilityId) === "off");
  };
  applyBugVisibility();
  const fit = fitHudBar(hudBar.element, mapSourceSlot, () => {
    const existing: HudBarFitItem[] = [
      { element: pauseButton, priority: defaultPriority("north"), keepVisible: true, essential: true },
      { element: fpsButton, priority: defaultPriority("fps"), keepVisible: true },
      { element: rendererButton, priority: defaultPriority("renderer"), keepVisible: true },
      { element: settingsButton, priority: defaultPriority("settings"), keepVisible: true },
    ];
    if (layout === "classic") {
      existing.push({ element: statusElement, priority: defaultPriority("position"), keepVisible: true });
    } else {
      // Altitude and heading are flown by; latitude, longitude and pitch give way first.
      existing.push(
        { element: latLonButton, priority: defaultPriority("position") },
        { element: altitudeButton, priority: defaultPriority("position"), keepVisible: true },
        { element: headingButton, priority: defaultPriority("position"), keepVisible: true },
        { element: pitchButton, priority: defaultPriority("position") },
        // Last, so it sits against the bar's end.
        { element: instrumentSlot, priority: Number.MAX_SAFE_INTEGER, keepVisible: true },
      );
    }
    const input = hudBar.element.querySelector<HTMLElement>(".input-mode-control");
    if (input) existing.push({ element: input, priority: defaultPriority("inputMode"), keepVisible: true });
    if (fullscreenButton) existing.push({ element: fullscreenButton, priority: defaultPriority("fullscreen"), keepVisible: true });
    if (logButton) existing.push({ element: logButton, priority: defaultPriority("settings"), keepVisible: true });
    const visibility = settings.get(visibilityId);
    if (visibility !== "off") existing.push({
      element: bugReportButton,
      priority: settings.get(TOOLBAR_EDIT_PRIORITIES_ID) === true ? settings.get<number>(priorityId) : defaultPriority("bugReport"),
      keepVisible: visibility === "on",
    });
    return existing;
  });
  const stopWatchingToolbar = settings.subscribe(changed => {
    if (![visibilityId, priorityId, TOOLBAR_EDIT_PRIORITIES_ID].some(id => changed.has(id))) return;
    applyBugVisibility();
    fit.update();
  });

  const setLayout = (next: FlightHudLayout): void => {
    layout = next;
    const compact = next === "compact";
    hudBar.element.dataset.flightLayout = next;
    statusElement.hidden = compact;
    for (const chip of positionChips) chip.hidden = !compact;
    instrumentSlot.hidden = !compact;
    fpsButton.classList.toggle("flight-reading-chip", compact);
    fpsValue.textContent = fpsText;
    if (compact) fpsButton.replaceChildren(fpsValue, fpsLabel);
    else fpsButton.textContent = `FPS ${fpsText}`;
    fit.update();
  };
  setLayout("classic");

  /** Altitude as Interface → Position readout measures it; a dash while its base is unknown. */
  let lastAltitude: { state: FlightState; groundHeightMeters: number | null; mode: BabylonRuntimeStatus["mode"] } | null = null;
  const drawAltitude = (state: FlightState, groundHeightMeters: number | null, mode: BabylonRuntimeStatus["mode"]): void => {
    lastAltitude = { state, groundHeightMeters, mode };
    const reference = settings.get<"asl" | "agl">(ALTITUDE_REFERENCE_ID);
    const unit = settings.get<"m" | "ft">(ALTITUDE_UNIT_ID);
    // Over Google 3D Tiles heights are the ellipsoid's: sea level is the geoid's
    // height there, a dash until its grid has loaded.
    const base = reference === "agl" ? groundHeightMeters : seaLevelMeters(options.seaLevel, settings, mode, state.latDeg, state.lonDeg);
    altitudeChip.setValue(base === null ? "\u2014" : String(Math.round((state.altMeters - base) / (unit === "ft" ? METERS_PER_FOOT : 1))));
    altitudeChip.setLabel(`${unit} ${reference === "agl" ? "AGL" : "ASL"}`);
  };
  // The geoid's grid arrives, or another is chosen: redraw, paused too.
  const redrawAltitude = (): void => {
    if (layout === "compact" && lastAltitude) drawAltitude(lastAltitude.state, lastAltitude.groundHeightMeters, lastAltitude.mode);
  };
  const stopWatchingSeaLevel = options.seaLevel?.subscribe?.(redrawAltitude) ?? (() => {});
  const stopWatchingGrid = settings.subscribe(changed => { if (changed.has(SEA_LEVEL_GRID_ID)) redrawAltitude(); });

  return {
    setResumeBlocked(blocked) { pauseButton.disabled = blocked; },
    mountInputMethod: (host) => inputHud.mountInline(host),
    setLayout,
    instrumentSlot,
    update(state, runtimeStatus, fps, nextPaused, groundHeightMeters = null): void {
      updatePauseState(nextPaused);
      mapSource.update(runtimeStatus);
      const headingDeg = Math.round(headingDegFromRad(state.headingRad));
      const heading = String(headingDeg).padStart(3, "0");
      fpsText = fps === null ? "\u2014" : String(Math.round(fps));
      if (layout === "classic") {
        fpsButton.textContent = `FPS ${fpsText}`;
        // Over Google 3D Tiles the aircraft flies at ellipsoid heights; the readout takes sea level's away.
        position.update({
          latDeg: state.latDeg, lonDeg: state.lonDeg, altitudeMeters: state.altMeters, groundHeightMeters,
          heightDatum: surfaceHeightDatum(runtimeStatus.mode), rest: `h${heading}°`,
        });
        return;
      }
      if (fpsValue.textContent !== fpsText) fpsValue.textContent = fpsText;
      latLon.update({ latDeg: state.latDeg, lonDeg: state.lonDeg });
      drawAltitude(state, groundHeightMeters, runtimeStatus.mode);
      headingChip.setValue(`${String(headingDeg % 360).padStart(3, "0")}°`);
      headingChip.setLabel(compassPoint(headingDeg));
      const pitchDeg = Math.round(state.pitchRad * 180 / Math.PI);
      pitchChip.setValue(`${pitchDeg < 0 ? "-" : "+"}${Math.abs(pitchDeg)}°`);
    },
    destroy(): void {
      stopWatchingToolbar();
      stopWatchingSeaLevel();
      stopWatchingGrid();
      fit.destroy();
      logButton?.removeEventListener("click", onLogClick);
      detachFullscreen();
      pauseButton.removeEventListener("click", onPauseClick);
      rendererButton.removeEventListener("click", options.onRendererClick);
      statusElement.removeEventListener("click", options.onStatusClick);
      for (const chip of positionChips) chip.removeEventListener("click", options.onStatusClick);
      settingsButton.removeEventListener("click", options.onSettingsClick);
      fpsButton.removeEventListener("click", options.onDebugClick);
      bugReportButton.removeEventListener("click", options.onBugReportClick);
      mapSource.destroy();
      detachRendererActivity();
      position.destroy();
      latLon.destroy();
      inputHud.destroy();
      hudBar.destroy();
    },
  };
}
