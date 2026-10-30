import type { ControlCapabilities } from "@0sfs/aircraft/aircraftCatalog";
import { mountCenteredStick, stickResponse, inverseStickResponse } from "@0sfs/controls/centeredStick";
import { createClimbRateLever, type ClimbRateLeverOptions } from "@0sfs/controls/climbRateLever";
import { headingDegFromRad, type FlightState } from "@0sfs/ground-contact/flightState";
import type { FrameProfiler } from "foss-earth/perf";
import { createThrottleLever, type ThrottleBrakeCommand, type ThrottleLeverEngine, type ThrottleLeverGauge } from "@0sfs/engines/throttleLever";
import { mountNativeControlPosition } from "@0sfs/rc/controlPosition";
import type { ActualControlPositions } from "@0sfs/rc/protocol";
import {
  ATTITUDE_HALF_SHARE,
  createAttitudeRenderer,
  type AttitudeRendererPreference,
  type AttitudeRendererStatus,
} from "./attitudeRenderer";
import type { AttitudeView } from "./attitudeIndicator";
import type { ReadingTints } from "./instrumentBands";

/**
 * Interface → Flight instruments → Layout: osfs.hud.layout. Classic keeps the
 * instrument row above the attitude indicator; Compact puts its readings on
 * the indicator's corners and its buttons in the toolbar.
 */
export type FlightHudLayout = "compact" | "classic";

export interface FlightHudOptions {
  drone?: boolean;
  capabilities?: ControlCapabilities;
  onEngineDetails?(): void;
  /** Physical actuator positions; absent readings never stand in for a command. */
  getActualControls?(): ActualControlPositions;
  onGearChange(down: boolean): void;
  onThrottleChange(value: number): void;
  climbRate?: ClimbRateLeverOptions;
  /** Present for an aircraft whose throttle lever includes a lower brake range. */
  onPowerChange?(command: ThrottleBrakeCommand): void;
  getKeepSliderBrakes?(): boolean;
  /** The slider's own brake selection, before keyboard/button brakes are mixed in. */
  getSliderBrake?(): number;
  /** How fast the engine turns, as I-beams beside the throttle lever; see `throttleLeverGauges`. */
  getEngineGauges?(): readonly ThrottleLeverGauge[];
  onPitchTrimChange(value: number): void;
  onRollTrimChange(value: number): void;
  onPitchAutoTrimChange(enabled: boolean): void;
  onRollAutoTrimChange(enabled: boolean): void;
  onAutopilotEngageChange(engaged: boolean): void;
  onFlapsChange(value: number): void;
  flapAutomation?: {
    getEnabled(): boolean;
    onEnabledChange(enabled: boolean): void;
    getPositionNorm(): number;
    /** Some automatic schedules reflex the flaps slightly above neutral. */
    minPositionNorm?: number;
  };
  onRudderChange(value: number): void;
  onStickChange(aileron: number, elevator: number): void;
  /** The globe's WebGPU device, so the attitude indicator draws on the GPU; null on WebGL. */
  gpuDevice?: GPUDevice | null;
  /** Renderer → Instruments → Attitude indicator: osfs.renderer.attitudeIndicator. */
  attitudeRenderer?: AttitudeRendererPreference;
  /** Told what the attitude indicator draws with, whenever that changes. */
  onAttitudeStatus?(status: AttitudeRendererStatus): void;
  profiler?: FrameProfiler | null;
  pitchAutoTrim?: boolean;
  rollAutoTrim?: boolean;
  autopilotEngaged?: boolean;
  /** Observed engine state, independent of throttle command and audio settings. */
  afterburner?: {
    getActive(): boolean | null;
    accentColor: string;
    /** Where one push of the throttle lever stops, or null when the pilot lets one push light it. */
    getDetent?(): number | null;
  };
  /**
   * Starting and stopping the engine from the throttle lever. Absent, the
   * lever is a plain throttle.
   */
  engine?: {
    getReading(): ThrottleLeverEngine | null;
    onStartHold(held: boolean): void;
    onShutdown(): void;
  };
  /** Present only when the active aircraft has a powered lift conversion lever. */
  vtolConversion?: {
    getCommandNorm(): number;
    getPositionNorm?(): number;
    onCommandChange(value: number): void;
  };
}

export interface FlightHudControls {
  throttle?: number;
  pitchTrim: number;
  rollTrim: number;
  flaps: number;
  rudder: number;
  aileron: number;
  elevator: number;
}

export interface FlightHudAutoTrim {
  pitch: boolean;
  roll: boolean;
}

export interface FlightHudMasterAp {
  engaged: boolean;
  canEngage: boolean;
  blockedReason: string | null;
  ownsPitch: boolean;
  ownsRoll: boolean;
  ownsGear: boolean;
  ownsFlaps: boolean;
}

export const FLIGHT_HUD_MASTER_OFF: FlightHudMasterAp = {
  engaged: false,
  canEngage: true,
  blockedReason: null,
  ownsPitch: false,
  ownsRoll: false,
  ownsGear: false,
  ownsFlaps: false,
};

export interface FlightHudHandle {
  /**
   * `gearDown`, auto-trim, and master AP are passed separately rather than
   * added to `FlightHudControls` because they are latching switches, not
   * smoothed axes. `attitudeView` is the frame the attitude indicator is
   * drawn from, the 3D camera's (cameraAttitudeView.ts), or null for the
   * aircraft's.
   */
  update(
    state: FlightState,
    controls: FlightHudControls,
    gearDown: boolean,
    autoTrim: FlightHudAutoTrim,
    masterAp?: FlightHudMasterAp,
    attitudeView?: AttitudeView | null,
  ): void;
  /** Repaint just the gear button, for when the key moves it between frames. */
  setGearDown(down: boolean): void;
  /** Synchronize a registry edit while the simulation is paused or stopped. */
  refreshVtolConversion(): void;
  refreshFlaps(): void;
  setAttitudeRenderer(preference: AttitudeRendererPreference): void;
  /**
   * Hides the instruments and controls, those in the toolbar slot too, and
   * stops drawing them, letting go of a stick held here: Remote Control →
   * Flight UI on this computer, off, while a phone has them.
   */
  setHidden(hidden: boolean): void;
  /**
   * Moves the readings and buttons between the instrument row and their
   * Compact places: airspeed, vertical speed and angle of attack on the
   * attitude indicator's corners, heading over its horizon, and the load,
   * gear and autopilot into `toolbarSlot`. Without a slot they stay in the row.
   */
  setLayout(layout: FlightHudLayout, toolbarSlot?: HTMLElement | null): void;
  setAttitudeSide(side: "left" | "right"): void;
  /** Tints the airspeed, angle of attack and load chips, 0 green to 1 red; null leaves one untinted. */
  setReadingTints(tints: ReadingTints): void;
  /**
   * A pointer is down on one of the flight controls. A finger resting on a
   * lever is still flying, though it sends nothing until it moves, so control
   * must not go back to a phone underneath it.
   */
  isPilotHolding(): boolean;
  destroy(): void;
}

function clampStickSquare(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}

function controlsToStickDisplay(aileron: number, elevator: number): { x: number; y: number } {
  return clampStickSquare(
    inverseStickResponse(aileron),
    inverseStickResponse(-elevator),
  );
}

// The HUD refreshes every frame, and a write puts style or layout out of date,
// so the next read of the canvas's size restyles or lays out the page again.
// Each of these writes only what differs from the page. A readout's text is
// changed in its text node: replacing the node, as textContent does, restyles
// as well as laying out.
function setText(element: HTMLElement, text: string): void {
  const node = element.firstChild;
  if (node?.nodeType === 3 && node === element.lastChild && text !== "") {
    if ((node as Text).data !== text) (node as Text).data = text;
  } else if (element.textContent !== text) element.textContent = text;
}

function setValue(element: HTMLInputElement | HTMLOutputElement, value: string): void {
  if (element.value !== value) element.value = value;
}

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function createFlightHud(root: HTMLElement, options: FlightHudOptions): FlightHudHandle {
  root.innerHTML = `
    <div class="flight-hud" aria-label="Flight instruments">
      <div class="flight-hud__attitude-cluster" aria-label="Attitude and adjacent levers">
        <div class="flight-hud__auto-trims" role="group" aria-label="Trim assists">
          <button class="flight-hud__auto-trim flight-hud__auto-trim--roll" data-control="auto-roll-trim" type="button" aria-pressed="false"><span>TRIM</span><span>AUTO</span></button>
          <button class="flight-hud__auto-trim flight-hud__auto-trim--pitch" data-control="auto-pitch-trim" type="button" aria-pressed="false"><span>AUTO</span><span>TRIM</span></button>
        </div>
        <label class="flight-hud__slider-control flight-hud__slider-control--roll-trim">
          <span>ROLL</span>
          <input data-control="roll-trim" type="range" min="-1" max="1" step="0.01" value="0" aria-label="Roll trim" />
          <output data-output="roll-trim">0%</output>
        </label>
        <label class="flight-hud__lever flight-hud__lever--pitch">
          <span class="flight-hud__lever-meta">
            <span>PITCH</span>
            <output data-output="pitch-trim">0%</output>
          </span>
          <span class="flight-hud__lever-track">
            <input data-control="pitch-trim" type="range" min="-1" max="1" step="0.01" value="0" aria-label="Pitch trim" />
          </span>
        </label>
        <div class="flight-hud__attitude" role="button" tabindex="0" data-takes-keys="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label="Attitude indicator and pitch roll control. Drag to steer."></div>
        <div class="flight-hud__attitude-readings" aria-label="Flight readings"></div>
        <div class="flight-hud__lever flight-hud__lever--flaps">
          <span class="flight-hud__lever-meta">
            <span>FLAPS</span>
            ${options.flapAutomation ? '<button type="button" class="flight-hud__auto-button" data-control="auto-flaps" aria-label="Automatic flaps" aria-pressed="false">AUTO</button>' : ""}
            <output data-output="flaps">0%</output>
          </span>
          <span class="flight-hud__lever-track">
            <input data-control="flaps" type="range" min="0" max="1" step="0.01" value="0" aria-label="Flaps" />
          </span>
        </div>
      </div>
      <div class="flight-hud__tapes">
        <div class="flight-hud__tape" data-reading="ias">
          <div class="flight-hud__tape-header">
            <span class="flight-hud__label">IAS</span>
            <span class="flight-hud__unit">kt</span>
          </div>
          <span class="flight-hud__value" data-metric="ias">000</span>
        </div>
        <div class="flight-hud__tape" data-reading="hdg">
          <div class="flight-hud__tape-header">
            <span class="flight-hud__label">HDG</span>
            <span class="flight-hud__unit">°</span>
          </div>
          <span class="flight-hud__value" data-metric="hdg">000</span>
        </div>
        <div class="flight-hud__tape" data-reading="vs">
          <div class="flight-hud__tape-header">
            <span class="flight-hud__label">VS</span>
            <span class="flight-hud__unit">fpm</span>
          </div>
          <span class="flight-hud__value" data-metric="vs">+0000</span>
        </div>
        <div class="flight-hud__aoa" data-slot="aoa"></div>
        <div class="flight-hud__g" data-slot="g"></div>
        <button class="flight-hud__gear" data-control="gear" type="button" aria-pressed="true">G</button>
        <button class="flight-hud__ap" data-control="autopilot" type="button" aria-pressed="false">AP</button>
      </div>
      <div class="flight-hud__yaw-throttle" aria-label="Yaw and throttle">
        <div class="flight-hud__armament" data-slot="armament" hidden></div>
        <div class="flight-hud__eval" data-slot="eval"></div>
        <div class="flight-hud__yaw">
          <label class="flight-hud__yaw-control">
            <span class="flight-hud__yaw-heading">
              <span>YAW</span>
              <output data-output="rudder">0%</output>
            </span>
            <input data-control="rudder" type="range" min="-1" max="1" step="0.01" value="0" aria-label="Yaw rudder. Drag left or right; releases to center." />
          </label>
        </div>
        ${options.drone ? '<div class="flight-hud__engine-stick" data-control="climb-yaw" role="button" tabindex="0" data-takes-keys="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label="Climb and yaw control. Drag up to climb, down to descend, left or right to yaw. Release to hold.">' : ""}
        <div class="flight-hud__engine" data-slot="engine"></div>
        ${options.drone ? '<span class="flight-hud__engine-stick-marker" aria-hidden="true"></span><span class="flight-hud__engine-stick-label">CLIMB / YAW</span></div><button type="button" class="flight-hud__engine-details" data-control="engine-details" aria-label="Open quadcopter engine details">Engines</button>' : ""}
        <div class="flight-hud__throttle">
          <div class="flight-hud__slider-control flight-hud__slider-control--throttle"></div>
          ${options.vtolConversion ? `
          <label class="flight-hud__slider-control flight-hud__slider-control--vtol" title="0% conventional flight; 100% vertical lift">
            <span>VTOL</span>
            <output data-output="vtol-conversion">0%</output>
            <input data-control="vtol-conversion" type="range" min="0" max="1" step="0.01" value="0" aria-label="VTOL conversion" aria-orientation="vertical" />
          </label>` : ""}
        </div>
      </div>
    </div>
  `;

  // The pad takes the pointer and the keys; the renderer draws into a canvas inside it.
  const pad = root.querySelector<HTMLElement>(".flight-hud__attitude");
  const enginePad = root.querySelector<HTMLElement>(".flight-hud__engine-stick");
  const engineMarker = root.querySelector<HTMLElement>(".flight-hud__engine-stick-marker");
  const engineDetails = root.querySelector<HTMLButtonElement>('[data-control="engine-details"]');
  const iasEl = root.querySelector<HTMLElement>('[data-metric="ias"]');
  const hdgEl = root.querySelector<HTMLElement>('[data-metric="hdg"]');
  const vsEl = root.querySelector<HTMLElement>('[data-metric="vs"]');
  const throttleControl = root.querySelector<HTMLElement>(".flight-hud__slider-control--throttle");
  const pitchTrimInput = root.querySelector<HTMLInputElement>('[data-control="pitch-trim"]');
  const rollTrimInput = root.querySelector<HTMLInputElement>('[data-control="roll-trim"]');
  const pitchAutoTrimButton = root.querySelector<HTMLButtonElement>('[data-control="auto-pitch-trim"]');
  const rollAutoTrimButton = root.querySelector<HTMLButtonElement>('[data-control="auto-roll-trim"]');
  const flapsInput = root.querySelector<HTMLInputElement>('[data-control="flaps"]');
  const autoFlapsButton = root.querySelector<HTMLButtonElement>('[data-control="auto-flaps"]');
  const rudderInput = root.querySelector<HTMLInputElement>('[data-control="rudder"]');
  const vtolInput = root.querySelector<HTMLInputElement>('[data-control="vtol-conversion"]');
  const vtolOutput = root.querySelector<HTMLOutputElement>('[data-output="vtol-conversion"]');
  const pitchTrimOutput = root.querySelector<HTMLOutputElement>('[data-output="pitch-trim"]');
  const rollTrimOutput = root.querySelector<HTMLOutputElement>('[data-output="roll-trim"]');
  const flapsOutput = root.querySelector<HTMLOutputElement>('[data-output="flaps"]');
  const rudderOutput = root.querySelector<HTMLOutputElement>('[data-output="rudder"]');
  const gearButton = root.querySelector<HTMLButtonElement>('[data-control="gear"]');
  const apButton = root.querySelector<HTMLButtonElement>('[data-control="autopilot"]');
  const hud = root.querySelector<HTMLElement>(".flight-hud");
  const tapes = root.querySelector<HTMLElement>(".flight-hud__tapes");
  const attitudeReadings = root.querySelector<HTMLElement>(".flight-hud__attitude-readings");
  const iasTape = root.querySelector<HTMLElement>('[data-reading="ias"]');
  const hdgTape = root.querySelector<HTMLElement>('[data-reading="hdg"]');
  const vsTape = root.querySelector<HTMLElement>('[data-reading="vs"]');
  const aoaSlot = root.querySelector<HTMLElement>(".flight-hud__aoa");
  const gSlot = root.querySelector<HTMLElement>(".flight-hud__g");

  if (!pad || !gearButton || !apButton || !pitchAutoTrimButton || !rollAutoTrimButton
    || !iasEl || !hdgEl || !vsEl || !hud || !tapes || !attitudeReadings
    || !iasTape || !hdgTape || !vsTape || !aoaSlot || !gSlot
    || !throttleControl || !pitchTrimInput || !rollTrimInput || !flapsInput || !rudderInput
    || !pitchTrimOutput || !rollTrimOutput || !flapsOutput || !rudderOutput) {
    throw new Error("Flight HUD markup failed to initialize.");
  }

  if (options.afterburner) {
    throttleControl.style.setProperty("--afterburner-accent", options.afterburner.accentColor);
  }
  // The phone mounts this same lever; see throttleLever.ts.
  const climb = !options.drone && options.climbRate ? createClimbRateLever(throttleControl, options.climbRate) : null;
  if (climb) {
    throttleControl.classList.add("flight-hud__slider-control--climb-rate");
    root.querySelector(".flight-hud__yaw-throttle")?.setAttribute("aria-label", "Yaw and climb rate");
  }
  const throttle = climb || options.drone ? null : createThrottleLever(throttleControl, {
    onThrottleChange: options.onThrottleChange,
    onPowerChange: options.onPowerChange,
    onStartHold: options.engine?.onStartHold,
    onShutdown: options.engine?.onShutdown,
  });
  const pitchPosition = mountNativeControlPosition(pitchTrimInput, "vertical");
  const rollPosition = mountNativeControlPosition(rollTrimInput, "horizontal");
  const flapPosition = mountNativeControlPosition(flapsInput, "vertical");
  const rudderPosition = mountNativeControlPosition(rudderInput, "horizontal");
  const vtolPosition = vtolInput ? mountNativeControlPosition(vtolInput, "vertical") : null;
  let masterAp: FlightHudMasterAp = {
    ...FLIGHT_HUD_MASTER_OFF,
    engaged: options.autopilotEngaged === true,
  };
  let flapsDragging = false;
  let flapsKeyboardEditing = false;
  let flapCommand = 0;
  const refreshFlaps = (): void => {
    const automation = options.flapAutomation;
    const enabled = automation?.getEnabled() === true;
    if (enabled) flapsKeyboardEditing = false;
    if (autoFlapsButton) setAttr(autoFlapsButton, "aria-pressed", String(enabled));
    autoFlapsButton?.classList.toggle("is-on", enabled && !masterAp.ownsFlaps);
    if (autoFlapsButton) {
      const title = masterAp.ownsFlaps
        ? `Flaps are owned by Autopilot. Automatic flap assist is ${enabled ? "requested" : "off"}; move the slider to take over manually.`
        : enabled ? "Automatic flaps on. Move the slider to take over manually."
          : "Automatic flaps off. Click to resume automatic control.";
      setAttr(autoFlapsButton, "title", title);
      setAttr(autoFlapsButton, "aria-label", title);
    }
    const actual = options.getActualControls?.().flaps ?? automation?.getPositionNorm();
    setAttr(flapsInput, "min", String(enabled ? automation?.minPositionNorm ?? 0 : 0));
    if (!flapsDragging) setValue(flapsInput, String(flapCommand));
    setValue(flapsOutput, `${Math.round(flapCommand * 100)}%`);
    flapPosition.update(Number(flapsInput.value), actual, masterAp.ownsFlaps ? "autopilot owns flaps" : enabled ? "automatic flaps" : undefined);
  };
  const onAutoFlapsClick = (): void => {
    flapsKeyboardEditing = false;
    if (options.flapAutomation) options.flapAutomation.onEnabledChange(!options.flapAutomation.getEnabled());
    refreshFlaps();
  };
  autoFlapsButton?.addEventListener("click", onAutoFlapsClick);
  const onFlapsPointerDown = (): void => { flapsDragging = true; flapsKeyboardEditing = false; };
  const onFlapsPointerUp = (): void => { flapsDragging = false; refreshFlaps(); };
  const onFlapsBlur = (): void => { flapsDragging = false; flapsKeyboardEditing = false; refreshFlaps(); };
  const onFlapsKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      flapsKeyboardEditing = true;
    }
  };
  flapsInput.addEventListener("pointerdown", onFlapsPointerDown);
  flapsInput.addEventListener("pointerup", onFlapsPointerUp);
  flapsInput.addEventListener("pointercancel", onFlapsPointerUp);
  flapsInput.addEventListener("lostpointercapture", onFlapsPointerUp);
  flapsInput.addEventListener("blur", onFlapsBlur);
  flapsInput.addEventListener("keydown", onFlapsKeyDown);
  refreshFlaps();

  const attitude = createAttitudeRenderer(pad, {
    device: options.gpuDevice ?? null,
    preference: options.attitudeRenderer,
    onStatusChange: options.onAttitudeStatus,
    profiler: options.profiler,
  });

  let gearDown = true;
  let pitchAutoTrim = options.pitchAutoTrim === true;
  let rollAutoTrim = options.rollAutoTrim === true;
  const renderGearButton = (): void => {
    gearButton.setAttribute("aria-pressed", String(gearDown));
    gearButton.classList.toggle("is-down", gearDown);
    gearButton.title = masterAp.ownsGear
      ? "Landing gear is held by Autopilot. Click or press G to take it back."
      : gearDown ? "Landing gear down (G) — click to raise" : "Landing gear up (G) — click to lower";
    gearButton.setAttribute("aria-label", gearButton.title);
  };
  const renderMasterApButton = (): void => {
    apButton.setAttribute("aria-pressed", String(masterAp.engaged));
    apButton.classList.toggle("is-on", masterAp.engaged);
    apButton.classList.toggle("is-blocked", !masterAp.canEngage);
    apButton.title = masterAp.engaged
      ? "Autopilot on — flying the axes selected on the Autopilot tab. Click to disengage."
      : masterAp.canEngage
        ? "Autopilot off — click to engage the package from the Autopilot tab."
        : (masterAp.blockedReason ?? "Autopilot cannot engage.");
    apButton.setAttribute("aria-label", apButton.title);
  };
  const renderAxisAutoTrim = (
    button: HTMLButtonElement,
    input: HTMLInputElement,
    enabled: boolean,
    axis: "pitch" | "roll",
    apOwns: boolean,
  ): void => {
    button.setAttribute("aria-pressed", String(enabled));
    button.classList.toggle("is-on", enabled && !apOwns);
    button.title = apOwns
      ? `${axis} is owned by Autopilot. TRIM is a wheel assist; disengage AP to use it.`
      : enabled
        ? `Trim assist on — the ${axis} wheel cancels leftover moment in real time, including while you fly. Click to turn off.`
        : `Trim assist off — click to cancel leftover ${axis} moment on the trim wheel.`;
    button.setAttribute("aria-label", button.title);
    input.disabled = enabled || apOwns;
  };
  const renderAutoTrimButtons = (): void => {
    renderAxisAutoTrim(pitchAutoTrimButton, pitchTrimInput, pitchAutoTrim, "pitch", masterAp.ownsPitch);
    renderAxisAutoTrim(rollAutoTrimButton, rollTrimInput, rollAutoTrim, "roll", masterAp.ownsRoll);
  };
  const onGearClick = (): void => options.onGearChange(!gearDown);
  const onPitchAutoTrimClick = (): void => options.onPitchAutoTrimChange(!pitchAutoTrim);
  const onRollAutoTrimClick = (): void => options.onRollAutoTrimChange(!rollAutoTrim);
  const onAutopilotClick = (): void => options.onAutopilotEngageChange(!masterAp.engaged);
  gearButton.addEventListener("click", onGearClick);
  pitchAutoTrimButton.addEventListener("click", onPitchAutoTrimClick);
  rollAutoTrimButton.addEventListener("click", onRollAutoTrimClick);
  apButton.addEventListener("click", onAutopilotClick);
  renderGearButton();
  renderMasterApButton();
  renderAutoTrimButtons();

  const refreshVtolConversion = (): void => {
    const lever = options.vtolConversion;
    if (!lever || !vtolInput || !vtolOutput) return;
    const value = lever.getCommandNorm();
    const command = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    const percent = Math.round(command * 100);
    const physical = lever.getPositionNorm?.();
    setValue(vtolInput, String(command));
    vtolPosition?.update(command, physical);
    setValue(vtolOutput, `${percent}%`);
  };
  const onVtolInput = (): void => {
    if (!options.vtolConversion || !vtolInput) return;
    options.vtolConversion.onCommandChange(Number(vtolInput.value));
    refreshVtolConversion();
  };
  vtolInput?.addEventListener("input", onVtolInput);
  refreshVtolConversion();

  let rudderDragging = false;
  const onPitchTrimInput = (): void => options.onPitchTrimChange(Number(pitchTrimInput.value));
  const onRollTrimInput = (): void => options.onRollTrimChange(Number(rollTrimInput.value));
  const onFlapsInput = (): void => {
    const command = Math.min(1, Math.max(0, Number(flapsInput.value)));
    flapCommand = command;
    if (!flapsDragging && document.activeElement === flapsInput) flapsKeyboardEditing = true;
    options.flapAutomation?.onEnabledChange(false);
    options.onFlapsChange(command);
    flapCommand = command; // Synchronous setting observers may refresh the HUD during takeover.
    refreshFlaps();
  };
  const onRudderInput = (): void => options.onRudderChange(Number(rudderInput.value));
  const releaseRudder = (): void => {
    if (!rudderDragging) return;
    rudderDragging = false;
    rudderInput.value = "0";
    rudderOutput.value = "0%";
    options.onRudderChange(0);
  };
  const onRudderPointerDown = (): void => { rudderDragging = true; };
  const onRudderPointerUp = (): void => releaseRudder();
  const onRudderBlur = (): void => releaseRudder();
  pitchTrimInput.addEventListener("input", onPitchTrimInput);
  rollTrimInput.addEventListener("input", onRollTrimInput);
  flapsInput.addEventListener("input", onFlapsInput);
  rudderInput.addEventListener("input", onRudderInput);
  rudderInput.addEventListener("pointerdown", onRudderPointerDown);
  rudderInput.addEventListener("pointerup", onRudderPointerUp);
  rudderInput.addEventListener("pointercancel", onRudderPointerUp);
  rudderInput.addEventListener("lostpointercapture", onRudderPointerUp);
  rudderInput.addEventListener("blur", onRudderBlur);

  let hidden = false;
  const stick = mountCenteredStick(pad, {
    halfShare: ATTITUDE_HALF_SHARE,
    disabled: () => hidden,
    onChange: (x, y) => options.onStickChange(stickResponse(x), -stickResponse(y)),
  });
  const paintEngineStick = (x: number, y: number, held: boolean): void => {
    if (!engineMarker || !enginePad) return;
    const half = ATTITUDE_HALF_SHARE * 100;
    const left = `${50 + x * half}%`;
    const top = `${50 + y * half}%`;
    if (engineMarker.style.left !== left) engineMarker.style.left = left;
    if (engineMarker.style.top !== top) engineMarker.style.top = top;
    enginePad.toggleAttribute("data-commanded", held || Math.abs(x) + Math.abs(y) > .001);
  };
  const engineStick = enginePad ? mountCenteredStick(enginePad, {
    halfShare: ATTITUDE_HALF_SHARE,
    disabled: () => hidden,
    onPosition: paintEngineStick,
    onChange: (x, y) => {
      options.onRudderChange(stickResponse(x));
      options.climbRate?.onChange(-stickResponse(y));
    },
  }) : null;
  const onEngineDetails = (): void => options.onEngineDetails?.();
  engineDetails?.addEventListener("click", onEngineDetails);

  // Pointers down on a flight control, wherever they are lifted.
  const heldPointers = new Set<number>();
  const controlGroups = [...root.querySelectorAll<HTMLElement>(".flight-hud__attitude-cluster, .flight-hud__yaw-throttle")];
  const onHoldStart = (event: PointerEvent): void => { heldPointers.add(event.pointerId); };
  const onHoldEnd = (event: PointerEvent): void => { heldPointers.delete(event.pointerId); };
  const clearHeld = (): void => heldPointers.clear();
  const clearHiddenHeld = (): void => { if (document.hidden) clearHeld(); };
  for (const group of controlGroups) {
    group.addEventListener("pointerdown", onHoldStart, { capture: true });
    group.addEventListener("lostpointercapture", onHoldEnd, { capture: true });
  }
  window.addEventListener("pointerup", onHoldEnd, { capture: true });
  window.addEventListener("pointercancel", onHoldEnd, { capture: true });
  window.addEventListener("blur", clearHeld);
  window.addEventListener("resize", clearHeld);
  document.addEventListener("visibilitychange", clearHiddenHeld);

  const setGearDown = (next: boolean): void => {
    if (next === gearDown) return;
    gearDown = next;
    renderGearButton();
  };
  const setAutoTrim = (next: FlightHudAutoTrim): void => {
    if (next.pitch === pitchAutoTrim && next.roll === rollAutoTrim) return;
    pitchAutoTrim = next.pitch;
    rollAutoTrim = next.roll;
    renderAutoTrimButtons();
  };
  const setMasterAp = (next: FlightHudMasterAp): void => {
    const same = next.engaged === masterAp.engaged
      && next.canEngage === masterAp.canEngage
      && next.blockedReason === masterAp.blockedReason
      && next.ownsPitch === masterAp.ownsPitch
      && next.ownsRoll === masterAp.ownsRoll
      && next.ownsGear === masterAp.ownsGear
      && next.ownsFlaps === masterAp.ownsFlaps;
    if (same) return;
    masterAp = { ...next };
    renderMasterApButton();
    renderGearButton();
    renderAutoTrimButtons();
    refreshFlaps();
  };

  // The row's own order, which Classic puts back.
  const capabilities = options.capabilities ?? {
    flaps: !options.drone, pitchTrim: !options.drone, rollTrim: !options.drone, landingGear: !options.drone,
  };
  if (!capabilities.pitchTrim) {
    pitchTrimInput.closest(".flight-hud__lever--pitch")?.remove();
    pitchAutoTrimButton.remove();
  }
  if (!capabilities.rollTrim) {
    rollTrimInput.closest(".flight-hud__slider-control--roll-trim")?.remove();
    rollAutoTrimButton.remove();
  }
  if (!capabilities.pitchTrim && !capabilities.rollTrim) root.querySelector(".flight-hud__auto-trims")?.remove();
  if (!capabilities.flaps) flapsInput.closest(".flight-hud__lever--flaps")?.remove();
  if (!capabilities.landingGear) gearButton.remove();
  if (options.drone) {
    hud.dataset.drone = "true";
    root.querySelector(".flight-hud__yaw")?.remove();
    root.querySelector(".flight-hud__throttle")?.remove();
    pad.setAttribute("aria-label", "Attitude indicator and pitch roll control. Drag up to fly forward, down to fly backward, left or right to roll.");
    root.querySelector(".flight-hud__yaw-throttle")?.setAttribute("aria-label", "Climb and yaw");
  }
  hud.dataset.trims = String(capabilities.pitchTrim || capabilities.rollTrim);
  const gearItems = capabilities.landingGear ? [gearButton] : [];
  const rowItems = [iasTape, hdgTape, vsTape, aoaSlot, gSlot, ...gearItems, apButton];
  const toolbarItems = [gSlot, ...gearItems, apButton];
  hud.dataset.layout = "classic";
  const setLayout = (layout: FlightHudLayout, toolbarSlot: HTMLElement | null = null): void => {
    if (layout === "compact") {
      // Corners clockwise from the top left, heading last so it reads over the horizon.
      attitudeReadings.append(iasTape, vsTape, aoaSlot, hdgTape);
      (toolbarSlot ?? tapes).append(...toolbarItems);
    } else {
      tapes.append(...rowItems);
    }
    hud.dataset.layout = layout;
  };

  const setAttitudeSide = (side: "left" | "right"): void => {
    if (hud.dataset.attitudeSide === side) return;
    stick.release();
    engineStick?.release();
    releaseRudder();
    heldPointers.clear();
    hud.dataset.attitudeSide = side;
  };
  setAttitudeSide(options.drone ? "right" : "left");

  const setHidden = (next: boolean): void => {
    if (next === hidden) return;
    hidden = next;
    if (hidden) {
      stick.release();
      engineStick?.release();
      releaseRudder();
      heldPointers.clear();
    }
    for (const element of [root, ...toolbarItems]) {
      if (hidden) element.style.display = "none";
      else element.style.removeProperty("display");
    }
  };

  // Steps of 5%: a reading that holds still writes nothing.
  const tintStep = (value: number, min: number) => (Math.round(Math.min(1, Math.max(min, value)) * 20) / 20).toFixed(2);
  const tintTargets = [["ias", iasTape], ["aoa", aoaSlot], ["g", gSlot]] as const;
  const setReadingTints = (tints: ReadingTints): void => {
    for (const [reading, element] of tintTargets) {
      const value = tints[reading];
      const step = value === null ? "" : tintStep(value, 0);
      if ((element.dataset.tint ?? "") === step) continue;
      if (step === "") {
        delete element.dataset.tint;
        element.style.removeProperty("--hud-tint");
      } else {
        element.dataset.tint = step;
        element.style.setProperty("--hud-tint", step);
      }
    }
    // Signed: brown one way, blue the other.
    const vsStep = tints.vs === null ? "" : tintStep(tints.vs, -1);
    if ((vsTape.dataset.vsTint ?? "") === vsStep) return;
    if (vsStep === "") {
      delete vsTape.dataset.vsTint;
      delete vsTape.dataset.vsDirection;
      delete vsTape.dataset.vsInk;
      vsTape.style.removeProperty("--hud-vs-mix");
      return;
    }
    const mix = Math.abs(Number(vsStep));
    vsTape.dataset.vsTint = vsStep;
    vsTape.dataset.vsDirection = vsStep.startsWith("-") ? "down" : "up";
    // Dark ink until the fill is darker than mid grey.
    vsTape.dataset.vsInk = mix < 0.6 ? "dark" : "light";
    vsTape.style.setProperty("--hud-vs-mix", mix.toFixed(2));
  };

  return {
    setGearDown,
    refreshVtolConversion,
    refreshFlaps,
    setAttitudeRenderer: preference => attitude.setPreference(preference),
    setHidden,
    setLayout,
    setAttitudeSide,
    setReadingTints,
    update(
      state: FlightState,
      controls: FlightHudControls,
      nextGearDown: boolean,
      nextAutoTrim: FlightHudAutoTrim,
      nextMasterAp = FLIGHT_HUD_MASTER_OFF,
      attitudeView: AttitudeView | null = null,
    ): void {
      // Brought up to date by the first update once shown again.
      if (hidden) return;
      setGearDown(nextGearDown);
      setAutoTrim(nextAutoTrim);
      setMasterAp(nextMasterAp);
      refreshVtolConversion();
      const position = stick.getPosition();
      const localStick = position.held;
      const { x: displayX, y: displayY } = localStick
        ? clampStickSquare(position.x, position.y)
        : controlsToStickDisplay(controls.aileron, controls.elevator);
      const displayActive = localStick || Math.hypot(controls.aileron, controls.elevator) > 0.001;
      attitude.draw(state, { x: displayX, y: displayY, active: displayActive }, attitudeView);

      setText(iasEl, Math.round(state.airspeedKts).toString().padStart(3, "0"));
      setText(hdgEl, Math.round(headingDegFromRad(state.headingRad)).toString().padStart(3, "0"));

      // Sign then magnitude, each fixed width: signing the padded number gave
      // "+ 738" against "-738", so the chip changed width across zero. The
      // instrument row is left-anchored now, and that shunts everything after
      // it sideways.
      const vsFpm = Math.round(state.verticalSpeedFps * 60);
      setText(vsEl, `${vsFpm < 0 ? "-" : "+"}${Math.abs(vsFpm).toString().padStart(4, " ")}`);
      setValue(pitchTrimInput, String(controls.pitchTrim));
      setValue(rollTrimInput, String(controls.rollTrim));
      const actual = options.getActualControls?.();
      pitchPosition.update(controls.pitchTrim, actual?.pitchTrim);
      rollPosition.update(controls.rollTrim, actual?.rollTrim);
      if (!flapsKeyboardEditing) flapCommand = controls.flaps;
      refreshFlaps();
      if (!rudderDragging) setValue(rudderInput, String(controls.rudder));
      rudderPosition.update(Number(rudderInput.value), actual?.rudder);
      climb?.update();
      if (engineStick && !engineStick.isHolding()) paintEngineStick(
        inverseStickResponse(controls.rudder), -inverseStickResponse(options.climbRate?.getCommand() ?? 0), false,
      );
      throttle?.update({
        throttle: controls.throttle ?? state.throttleNorm,
        actualThrottle: actual?.throttle,
        brake: options.getSliderBrake?.() ?? 0,
        keepBrakes: options.getKeepSliderBrakes?.() ?? false,
        engine: options.engine?.getReading() ?? null,
        gauges: options.getEngineGauges?.(),
        afterburner: options.afterburner?.getActive() ?? null,
        afterburnerDetent: options.afterburner?.getDetent?.() ?? null,
      });
      setValue(pitchTrimOutput, `${Math.round(controls.pitchTrim * 100)}%`);
      setValue(rollTrimOutput, `${Math.round(controls.rollTrim * 100)}%`);
      setValue(rudderOutput, `${Math.round((rudderDragging ? Number(rudderInput.value) : controls.rudder) * 100)}%`);
    },
    destroy(): void {
      attitude.destroy();
      stick.destroy();
      engineStick?.destroy();
      heldPointers.clear();
      engineDetails?.removeEventListener("click", onEngineDetails);
      releaseRudder();
      gearButton.removeEventListener("click", onGearClick);
      pitchAutoTrimButton.removeEventListener("click", onPitchAutoTrimClick);
      rollAutoTrimButton.removeEventListener("click", onRollAutoTrimClick);
      apButton.removeEventListener("click", onAutopilotClick);
      throttle?.destroy();
      climb?.destroy();
      for (const position of [pitchPosition, rollPosition, flapPosition, rudderPosition, vtolPosition]) position?.destroy();
      vtolInput?.removeEventListener("input", onVtolInput);
      pitchTrimInput.removeEventListener("input", onPitchTrimInput);
      rollTrimInput.removeEventListener("input", onRollTrimInput);
      flapsInput.removeEventListener("input", onFlapsInput);
      autoFlapsButton?.removeEventListener("click", onAutoFlapsClick);
      flapsInput.removeEventListener("pointerdown", onFlapsPointerDown);
      flapsInput.removeEventListener("pointerup", onFlapsPointerUp);
      flapsInput.removeEventListener("pointercancel", onFlapsPointerUp);
      flapsInput.removeEventListener("lostpointercapture", onFlapsPointerUp);
      flapsInput.removeEventListener("blur", onFlapsBlur);
      flapsInput.removeEventListener("keydown", onFlapsKeyDown);
      rudderInput.removeEventListener("input", onRudderInput);
      rudderInput.removeEventListener("pointerdown", onRudderPointerDown);
      rudderInput.removeEventListener("pointerup", onRudderPointerUp);
      rudderInput.removeEventListener("pointercancel", onRudderPointerUp);
      rudderInput.removeEventListener("lostpointercapture", onRudderPointerUp);
      rudderInput.removeEventListener("blur", onRudderBlur);
      for (const group of controlGroups) {
        group.removeEventListener("pointerdown", onHoldStart, { capture: true });
        group.removeEventListener("lostpointercapture", onHoldEnd, { capture: true });
      }
      window.removeEventListener("pointerup", onHoldEnd, { capture: true });
      window.removeEventListener("pointercancel", onHoldEnd, { capture: true });
      window.removeEventListener("blur", clearHeld);
      window.removeEventListener("resize", clearHeld);
      document.removeEventListener("visibilitychange", clearHiddenHeld);
      // In Compact these sit in the toolbar, outside the root.
      for (const element of toolbarItems) element.remove();
      root.innerHTML = "";
    },
    isPilotHolding: () => heldPointers.size > 0 || stick.isHolding() || engineStick?.isHolding() === true,
  };
}
