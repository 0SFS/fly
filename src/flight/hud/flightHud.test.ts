// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlightHud, type FlightHudControls, type FlightHudOptions } from "./flightHud";
import { createFlightInputManager } from "@0sfs/controls/flightInputManager";
import type { FlightState } from "@0sfs/ground-contact/flightState";

const STATE: FlightState = {
  latDeg: 0, lonDeg: 0, altMeters: 1000,
  rollRad: 0, pitchRad: 0, headingRad: 0,
  airspeedKts: 120, verticalSpeedFps: 0, throttleNorm: 0.5,
} as FlightState;

const CONTROLS: FlightHudControls = {
  pitchTrim: 0, rollTrim: 0, flaps: 0, rudder: 0, aileron: 0, elevator: 0,
};

const AUTO_OFF = { pitch: false, roll: false };

// jsdom ships no 2D canvas, and the attitude indicator insists on one. These
// tests are about flight controls, so a stub that records nothing is enough.
function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy({}, { get: () => () => undefined }) as unknown as CanvasRenderingContext2D,
  );
}

function mount(overrides: Partial<FlightHudOptions> = {}) {
  stubCanvas();
  const host = document.createElement("div");
  document.body.append(host);
  const onGearChange = vi.fn();
  const onPitchAutoTrimChange = vi.fn();
  const onRollAutoTrimChange = vi.fn();
  const onAutopilotEngageChange = vi.fn();
  const hud = createFlightHud(host, {
    onGearChange,
    onThrottleChange: vi.fn(),
    onPitchTrimChange: vi.fn(),
    onRollTrimChange: vi.fn(),
    onPitchAutoTrimChange,
    onRollAutoTrimChange,
    onAutopilotEngageChange,
    onFlapsChange: vi.fn(),
    onRudderChange: vi.fn(),
    onStickChange: vi.fn(),
    ...overrides,
  });
  const gear = host.querySelector<HTMLButtonElement>('[data-control="gear"]')!;
  const ap = host.querySelector<HTMLButtonElement>('[data-control="autopilot"]')!;
  const pitchAuto = host.querySelector<HTMLButtonElement>('[data-control="auto-pitch-trim"]')!;
  const rollAuto = host.querySelector<HTMLButtonElement>('[data-control="auto-roll-trim"]')!;
  const pitchTrim = host.querySelector<HTMLInputElement>('[data-control="pitch-trim"]')!;
  const rollTrim = host.querySelector<HTMLInputElement>('[data-control="roll-trim"]')!;
  return {
    host, hud, gear, ap, pitchAuto, rollAuto, pitchTrim, rollTrim,
    onGearChange, onPitchAutoTrimChange, onRollAutoTrimChange, onAutopilotEngageChange,
  };
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("flight HUD automatic flaps", () => {
  it("updates physical feedback without moving command thumbs or sending local input", () => {
    let actual = { throttle: 0.2, rudder: -0.3, flaps: 0.1 };
    const onThrottleChange = vi.fn(), onRudderChange = vi.fn(), onFlapsChange = vi.fn();
    const t = mount({ getActualControls: () => actual, onThrottleChange, onRudderChange, onFlapsChange });
    const commands = { ...CONTROLS, throttle: 0.8, rudder: 0.6, flaps: 0.7 };
    try {
      for (const feedback of [actual, { throttle: 0.4, rudder: 0.2, flaps: 0.5 }]) {
        actual = feedback;
        t.hud.update(STATE, commands, true, AUTO_OFF);
        expect(t.host.querySelector<HTMLInputElement>('[data-control="flaps"]')!.value).toBe("0.7");
        expect(t.host.querySelector<HTMLInputElement>('[data-control="rudder"]')!.value).toBe("0.6");
        expect(t.host.querySelector('[data-control="flaps"]')!.getAttribute("aria-valuetext")).toContain(`${Math.round(actual.flaps * 100)}% actual`);
        expect(t.host.querySelector('[data-control="throttle"]')!.getAttribute("aria-valuenow")).toBe("80");
        expect(t.host.querySelector('[data-control="throttle"]')!.getAttribute("aria-valuetext")).toContain(`${Math.round(actual.throttle * 100)}% actual`);
      }
      expect(onThrottleChange).not.toHaveBeenCalled();
      expect(onRudderChange).not.toHaveBeenCalled();
      expect(onFlapsChange).not.toHaveBeenCalled();
    } finally { t.hud.destroy(); }
  });

  it("keeps the command while paused and marks physical travel separately", () => {
    let enabled = true;
    const onFlapsChange = vi.fn();
    const t = mount({ onFlapsChange, flapAutomation: {
      getEnabled: () => enabled, onEnabledChange: value => { enabled = value; }, getPositionNorm: () => 0,
    } });
    const slider = t.host.querySelector<HTMLInputElement>('[data-control="flaps"]')!;
    const output = t.host.querySelector<HTMLOutputElement>('[data-output="flaps"]')!;
    try {
      slider.focus();
      for (const value of [0.01, 0.02]) {
        slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        slider.value = String(value); // jsdom does not implement a range input's default key action.
        slider.dispatchEvent(new Event("input"));
        t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
        expect(slider.value).toBe(String(value));
        expect(output.value).toBe(`${Math.round(value * 100)}%`);
        expect(slider.getAttribute("aria-valuetext")).toContain("commanded");
      }
      expect(onFlapsChange.mock.calls.map(([value]) => value)).toEqual([0.01, 0.02]);
      expect(enabled).toBe(false);
      slider.blur();
      expect(slider.value).toBe("0.02");
      expect(slider.getAttribute("aria-valuetext")).toContain("actual");
    } finally { t.hud.destroy(); }
  });

  it("shows requested Auto separately from autopilot flap ownership", () => {
    const t = mount({ flapAutomation: {
      getEnabled: () => true, onEnabledChange: vi.fn(), getPositionNorm: () => 0.5,
    } });
    const button = t.host.querySelector<HTMLButtonElement>('[data-control="auto-flaps"]')!;
    try {
      const ap = { engaged: true, canEngage: true, ownsPitch: false, ownsRoll: false, ownsGear: false, ownsFlaps: true };
      t.hud.update(STATE, CONTROLS, true, AUTO_OFF, ap);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.classList.contains("is-on")).toBe(false);
      expect(button.getAttribute("aria-label")).toContain("owned by Autopilot");
      expect(button.title).toContain("requested");
      t.hud.update(STATE, CONTROLS, true, AUTO_OFF, { ...ap, ownsFlaps: false });
      expect(button.classList.contains("is-on")).toBe(true);
      expect(button.title).toContain("Automatic flaps on");
    } finally { t.hud.destroy(); }
  });

  it("keeps flap command separate from physical travel, including automatic reflex", () => {
    let enabled = true;
    let actual = 0.6;
    const onFlapsChange = vi.fn();
    const t = mount({ onFlapsChange, flapAutomation: {
      getEnabled: () => enabled,
      onEnabledChange: value => { enabled = value; },
      getPositionNorm: () => actual,
      minPositionNorm: -0.1,
    } });
    const slider = t.host.querySelector<HTMLInputElement>('[data-control="flaps"]')!;
    const output = t.host.querySelector<HTMLOutputElement>('[data-output="flaps"]')!;
    const button = t.host.querySelector<HTMLButtonElement>('[data-control="auto-flaps"]')!;
    try {
      t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
      expect(slider.value).toBe("0");
      expect(output.value).toBe("0%");
      expect(slider.getAttribute("aria-valuetext")).toContain("60% actual");
      expect(button.getAttribute("aria-pressed")).toBe("true");
      actual = -0.1;
      t.hud.refreshFlaps();
      expect(slider.value).toBe("0");
      expect(output.value).toBe("0%");
      expect(slider.getAttribute("aria-valuetext")).toContain("-10% actual");
      slider.dispatchEvent(new Event("pointerdown"));
      slider.value = "0.4";
      slider.dispatchEvent(new Event("input"));
      expect(enabled).toBe(false);
      expect(onFlapsChange).toHaveBeenLastCalledWith(0.4);
      actual = 0.2;
      t.hud.update(STATE, { ...CONTROLS, flaps: 0.4 }, true, AUTO_OFF);
      expect(slider.value).toBe("0.4"); // The moving actuator does not fight a drag.
      expect(output.value).toBe("40%");
      expect(slider.getAttribute("aria-valuetext")).toContain("20% actual");
      slider.dispatchEvent(new Event("pointerup"));
      expect(slider.value).toBe("0.4");
      button.click();
      expect(enabled).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    } finally { t.hud.destroy(); }
  });
});

describe("flight HUD combined throttle and brake lever", () => {
  it("routes the brake range to persistent flight input and follows the brake command", () => {
    const input = createFlightInputManager();
    const t = mount({
      onPowerChange: ({ throttle, brake }) => input.setThrottleBrake(throttle, brake),
      getSliderBrake: () => input.getSliderBrake(),
    });
    const slider = t.host.querySelector<HTMLElement>('[data-control="throttle"]')!;
    const box = slider.parentElement!;
    try {
      t.hud.update({ ...STATE, throttleNorm: 0 }, CONTROLS, true, AUTO_OFF);
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      const controls = input.poll(1 / 60);
      expect(controls).toMatchObject({ throttle: 0, brake: 1 });
      t.hud.update({ ...STATE, throttleNorm: 0 }, controls, true, AUTO_OFF);
      expect(box.querySelector("span")?.textContent).toBe("BRK");
      expect(box.querySelector("output")?.value).toBe("100%");
      slider.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }));
      expect(input.poll(1 / 60)).toMatchObject({ throttle: 0, brake: 0 });
      expect(box.querySelector("span")?.textContent).toBe("THR");
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      const powered = input.poll(1 / 60);
      expect(powered).toMatchObject({ throttle: 1, brake: 0 });
      t.hud.update({ ...STATE, throttleNorm: 1 }, powered, true, AUTO_OFF);
      expect(box.querySelector("span")?.textContent).toBe("THR");
    } finally { t.hud.destroy(); input.dispose(); }
  });
});

describe("flight HUD observed afterburner", () => {
  it.each(["#9ab8ff", "#ff9a62"])("uses aircraft accent %s only while an engine reports augmentation", accentColor => {
    let active: boolean | null = false;
    const t = mount({ afterburner: { getActive: () => active, accentColor } });
    const input = t.host.querySelector<HTMLInputElement>('[data-control="throttle"]')!;
    const output = t.host.querySelector<HTMLOutputElement>('[data-output="throttle"]')!;
    const lever = input.closest<HTMLElement>(".flight-hud__slider-control")!;
    try {
      t.hud.update({ ...STATE, throttleNorm: 1 }, CONTROLS, true, AUTO_OFF);
      expect(output.value).toBe("100%");
      expect(lever.dataset.afterburner).toBe("inactive");
      active = true;
      t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
      expect(output.value).toBe("50🔥");
      expect(lever.dataset.afterburner).toBe("active");
      expect(lever.style.getPropertyValue("--afterburner-accent")).toBe(accentColor);
      expect(input.getAttribute("aria-valuetext")).toBe("50%, afterburner active");
      expect(output.getAttribute("aria-label")).toBe("50%, afterburner active");
      expect(t.host.querySelectorAll('[data-afterburner="active"]')).toHaveLength(1);
      for (const next of [false, null]) {
        active = next;
        t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
        expect(output.value).toBe("50%");
        expect(lever.dataset.afterburner).toBe("inactive");
        expect(input.getAttribute("aria-valuetext")).toBe("50%");
      }
    } finally { t.hud.destroy(); }
  });

  it("keeps the ordinary percentage for aircraft without afterburner", () => {
    const t = mount();
    try {
      t.hud.update({ ...STATE, throttleNorm: 1 }, CONTROLS, true, AUTO_OFF);
      expect(t.host.querySelector<HTMLOutputElement>('[data-output="throttle"]')!.value).toBe("100%");
      expect(t.host.querySelector('[data-afterburner="active"]')).toBeNull();
    } finally { t.hud.destroy(); }
  });
});

describe("flight HUD VTOL conversion lever", () => {
  it("leaves aircraft without powered lift with their existing throttle control", () => {
    const t = mount();
    expect(t.host.querySelector('[data-control="vtol-conversion"]')).toBeNull();
    expect(t.host.querySelector('[data-control="throttle"]')).not.toBeNull();
    t.hud.refreshVtolConversion();
    t.hud.destroy();
  });

  it("places a native accessible vertical lever directly beside THR", () => {
    const t = mount({ vtolConversion: {
      getCommandNorm: () => 0.75, getPositionNorm: () => 0.4, onCommandChange: vi.fn(),
    } });
    const input = t.host.querySelector<HTMLInputElement>('[data-control="vtol-conversion"]')!;
    const lever = input.closest("label")!;
    expect(lever.previousElementSibling?.querySelector('[data-control="throttle"]')).not.toBeNull();
    expect(lever.parentElement?.className).toBe("flight-hud__throttle");
    expect(lever.querySelector("span")?.textContent).toBe("VTOL");
    expect(input.type).toBe("range");
    expect([input.min, input.max, input.step]).toEqual(["0", "1", "0.01"]);
    expect(input.getAttribute("aria-label")).toBe("VTOL conversion");
    expect(input.getAttribute("aria-orientation")).toBe("vertical");
    expect(input.getAttribute("aria-valuetext")).toBe("75% commanded; 40% actual");
    expect(input.value).toBe("0.75");
    expect(lever.querySelector("output")?.value).toBe("75%");
    t.hud.destroy();
  });

  it("uses native input events for pointer and keyboard edits and immediately follows its command owner", () => {
    let command = 0;
    const onCommandChange = vi.fn((value: number) => { command = value; });
    const t = mount({ vtolConversion: { getCommandNorm: () => command, onCommandChange } });
    const input = t.host.querySelector<HTMLInputElement>('[data-control="vtol-conversion"]')!;
    const output = t.host.querySelector<HTMLOutputElement>('[data-output="vtol-conversion"]')!;
    input.value = "0.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onCommandChange).toHaveBeenLastCalledWith(0.5);
    expect(output.value).toBe("50%");
    // Native range keyboard steps emit the same input event as pointer edits.
    input.value = "0.51";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onCommandChange).toHaveBeenLastCalledWith(0.51);
    expect(output.value).toBe("51%");
    t.hud.destroy();
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onCommandChange).toHaveBeenCalledTimes(2);
  });

  it("synchronizes registry and physical-position changes without replacing the command with actuator travel", () => {
    let command = 0.8;
    let position = 0.2;
    const onCommandChange = vi.fn();
    const t = mount({ vtolConversion: {
      getCommandNorm: () => command, getPositionNorm: () => position, onCommandChange,
    } });
    const input = t.host.querySelector<HTMLInputElement>('[data-control="vtol-conversion"]')!;
    command = 0.3;
    t.hud.refreshVtolConversion();
    expect(input.value).toBe("0.3");
    position = 0.25;
    t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
    expect(input.value).toBe("0.3");
    expect(input.getAttribute("aria-valuetext")).toBe("30% commanded; 25% actual");
    expect(onCommandChange).not.toHaveBeenCalled();
    t.hud.destroy();
  });
});

describe("flight HUD gear button", () => {
  it("starts down, and asks for the opposite of where it is", () => {
    const t = mount();
    expect(t.gear.getAttribute("aria-pressed")).toBe("true");
    expect(t.gear.classList.contains("is-down")).toBe(true);
    t.gear.click();
    // It reports the wanted position rather than toggling itself: the input
    // manager owns the lever, and the button follows it back through update().
    expect(t.onGearChange).toHaveBeenCalledWith(false);
    expect(t.gear.classList.contains("is-down")).toBe(true);
    t.hud.destroy();
  });

  it("follows the lever when the key moves it", () => {
    const t = mount();
    t.hud.setGearDown(false);
    expect(t.gear.getAttribute("aria-pressed")).toBe("false");
    expect(t.gear.classList.contains("is-down")).toBe(false);
    expect(t.gear.title).toContain("up");
    t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
    expect(t.gear.classList.contains("is-down")).toBe(true);
    t.hud.destroy();
  });

  it("sits with the instrument tapes, so both read in one glance", () => {
    const t = mount();
    expect(t.gear.parentElement?.className).toBe("flight-hud__tapes");
    expect(t.ap.parentElement).toBe(t.gear.parentElement);
    expect(t.ap.previousElementSibling).toBe(t.gear);
    const metrics = [...t.host.querySelectorAll("[data-metric]")].map(
      (element) => (element as HTMLElement).dataset.metric,
    );
    // The altitude is the HUD bar's, in its position readout.
    expect(metrics).toEqual(["ias", "hdg", "vs"]);
    t.hud.destroy();
  });

  it("keeps every value a fixed width, so the row cannot shunt sideways", () => {
    const t = mount();
    const widths = new Set<number>();
    const vsWidths = new Set<number>();
    for (const [airspeedKts, verticalSpeedFps] of [[7, 12.3], [140, -12.3], [140, 0], [62.4, -0.1]]) {
      t.hud.update({ ...STATE, airspeedKts, verticalSpeedFps }, CONTROLS, true, AUTO_OFF);
      widths.add(t.host.querySelector<HTMLElement>('[data-metric="ias"]')!.textContent!.length);
      vsWidths.add(t.host.querySelector<HTMLElement>('[data-metric="vs"]')!.textContent!.length);
    }
    expect([...widths]).toEqual([3]);
    expect([...vsWidths]).toEqual([5]);
    t.hud.destroy();
  });

  it("leaves the page untouched while nothing it shows changes", () => {
    let flaps = 0.25;
    const t = mount({ flapAutomation: {
      getEnabled: () => true, onEnabledChange: vi.fn(), getPositionNorm: () => flaps, minPositionNorm: -0.05,
    } });
    const controls = { ...CONTROLS, pitchTrim: 0.12, rudder: -0.3 };
    const state = { ...STATE, airspeedKts: 141.2, verticalSpeedFps: 3.4, headingRad: 1 };
    t.hud.update(state, controls, true, AUTO_OFF);
    const observer = new MutationObserver(() => undefined);
    observer.observe(t.host, { subtree: true, childList: true, attributes: true, characterData: true });
    t.hud.update({ ...state, airspeedKts: 141.4 }, controls, true, AUTO_OFF);
    expect(observer.takeRecords()).toEqual([]);
    flaps = 0.5;
    t.hud.update({ ...state, verticalSpeedFps: 3.5 }, controls, true, AUTO_OFF);
    const vs = t.host.querySelector<HTMLElement>('[data-metric="vs"]')!;
    const records = observer.takeRecords();
    const changed = records.map(record => record.attributeName ?? (record.target as Element).getAttribute?.("data-metric")
      ?? (record.target as Element).getAttribute?.("data-output") ?? record.target.parentElement?.dataset.metric);
    expect(new Set(changed)).toEqual(new Set(["vs", "style", "aria-valuetext", "title"]));
    // The readout's text node is kept and its text changed, rather than replaced.
    expect(records.find(record => record.target.parentElement === vs)?.type).toBe("characterData");
    expect(vs.textContent).toBe("+ 210");
    expect(vs.childNodes.length).toBe(1);
    expect(t.host.querySelector<HTMLOutputElement>('[data-output="flaps"]')!.value).toBe("0%");
    observer.disconnect();
    t.hud.destroy();
  });

  it("stops answering clicks once destroyed", () => {
    const t = mount();
    const gear = t.gear;
    t.hud.destroy();
    gear.click();
    expect(t.onGearChange).not.toHaveBeenCalled();
  });
});

describe("flight HUD layout", () => {
  const order = (parent: Element) => [...parent.children].map(child =>
    (child as HTMLElement).dataset.reading ?? (child as HTMLElement).dataset.slot ?? (child as HTMLElement).dataset.control);

  it("puts the readings on the attitude indicator's corners and the buttons in the toolbar in Compact", () => {
    const t = mount();
    const toolbar = document.createElement("span");
    document.body.append(toolbar);
    const hud = t.host.querySelector<HTMLElement>(".flight-hud")!;
    expect(hud.dataset.layout).toBe("classic");

    t.hud.setLayout("compact", toolbar);
    expect(hud.dataset.layout).toBe("compact");
    const readings = t.host.querySelector(".flight-hud__attitude-readings")!;
    // Over the pad, in its cell of the attitude cluster.
    expect(readings.previousElementSibling).toBe(t.host.querySelector(".flight-hud__attitude"));
    expect(order(readings)).toEqual(["ias", "vs", "aoa", "hdg"]);
    expect(order(toolbar)).toEqual(["g", "gear", "autopilot"]);
    expect(t.host.querySelector(".flight-hud__tapes")!.children).toHaveLength(0);
    // The buttons answer from the toolbar as from the row.
    t.gear.click();
    expect(t.onGearChange).toHaveBeenCalledWith(false);

    t.hud.setLayout("classic", toolbar);
    expect(order(t.host.querySelector(".flight-hud__tapes")!)).toEqual(["ias", "hdg", "vs", "aoa", "g", "gear", "autopilot"]);
    expect(readings.children).toHaveLength(0);
    expect(toolbar.children).toHaveLength(0);

    t.hud.setLayout("compact", toolbar);
    t.hud.destroy();
    expect(toolbar.children).toHaveLength(0);
  });

  it("hides everywhere it is, toolbar too, and draws nothing until shown again", () => {
    const onStickChange = vi.fn();
    const t = mount({ onStickChange });
    const toolbar = document.createElement("span");
    document.body.append(toolbar);
    t.hud.setLayout("compact", toolbar);
    t.hud.update(STATE, CONTROLS, true, AUTO_OFF);
    const pad = t.host.querySelector<HTMLElement>(".flight-hud__attitude")!;
    pad.focus();
    pad.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(onStickChange).toHaveBeenLastCalledWith(-1, -0);

    t.hud.setHidden(true);
    expect(t.host.style.display).toBe("none");
    expect([...toolbar.children].map(item => (item as HTMLElement).style.display)).toEqual(["none", "none", "none"]);
    // A stick held here lets go: the phone has the controls.
    expect(onStickChange).toHaveBeenLastCalledWith(0, -0);
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    t.hud.update({ ...STATE, airspeedKts: 160, verticalSpeedFps: 20 }, CONTROLS, false, AUTO_OFF);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();

    t.hud.setHidden(false);
    expect(t.host.style.display).toBe("");
    expect([...toolbar.children].map(item => (item as HTMLElement).style.display)).toEqual(["", "", ""]);
    t.hud.update({ ...STATE, airspeedKts: 160 }, CONTROLS, false, AUTO_OFF);
    expect(t.gear.getAttribute("aria-pressed")).toBe("false");
    t.hud.destroy();
  });

  it("keeps the buttons in the row when Compact has no toolbar to put them in", () => {
    const t = mount();
    t.hud.setLayout("compact");
    expect(order(t.host.querySelector(".flight-hud__tapes")!)).toEqual(["g", "gear", "autopilot"]);
    t.hud.destroy();
  });

  it("tints airspeed, angle of attack and load in steps, writing only when a step changes", () => {
    const t = mount();
    const ias = t.host.querySelector<HTMLElement>('[data-reading="ias"]')!;
    const aoa = t.host.querySelector<HTMLElement>(".flight-hud__aoa")!;
    const g = t.host.querySelector<HTMLElement>(".flight-hud__g")!;
    t.hud.setReadingTints({ ias: 0, aoa: 0.51, g: null, vs: null });
    expect(ias.style.getPropertyValue("--hud-tint")).toBe("0.00");
    expect(aoa.dataset.tint).toBe("0.50");
    expect(g.hasAttribute("data-tint")).toBe(false);

    const observer = new MutationObserver(() => undefined);
    observer.observe(t.host, { subtree: true, attributes: true });
    t.hud.setReadingTints({ ias: 0.01, aoa: 0.52, g: null, vs: null });
    expect(observer.takeRecords()).toEqual([]);

    t.hud.setReadingTints({ ias: 1.4, aoa: null, g: 0.3, vs: null });
    expect(ias.dataset.tint).toBe("1.00");
    expect(aoa.hasAttribute("data-tint")).toBe(false);
    expect(aoa.style.getPropertyValue("--hud-tint")).toBe("");
    expect(g.style.getPropertyValue("--hud-tint")).toBe("0.30");
    observer.disconnect();
    t.hud.destroy();
  });

  it("colours vertical speed by direction, with dark ink on the pale end", () => {
    const t = mount();
    const vs = t.host.querySelector<HTMLElement>('[data-reading="vs"]')!;
    const tints = { ias: null, aoa: null, g: null };
    t.hud.setReadingTints({ ...tints, vs: 0.71 });
    expect(vs.dataset.vsTint).toBe("0.70");
    expect(vs.dataset.vsDirection).toBe("up");
    expect(vs.dataset.vsInk).toBe("light");
    expect(vs.style.getPropertyValue("--hud-vs-mix")).toBe("0.70");
    // Not the green-to-red tint.
    expect(vs.hasAttribute("data-tint")).toBe(false);

    t.hud.setReadingTints({ ...tints, vs: -0.3 });
    expect(vs.dataset.vsTint).toBe("-0.30");
    expect(vs.dataset.vsDirection).toBe("down");
    expect(vs.dataset.vsInk).toBe("dark");
    expect(vs.style.getPropertyValue("--hud-vs-mix")).toBe("0.30");

    t.hud.setReadingTints({ ...tints, vs: -0.01 });
    expect(vs.dataset.vsTint).toBe("0.00");
    const observer = new MutationObserver(() => undefined);
    observer.observe(t.host, { subtree: true, attributes: true });
    t.hud.setReadingTints({ ...tints, vs: 0.02 });
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();

    t.hud.setReadingTints({ ...tints, vs: null });
    expect(vs.hasAttribute("data-vs-tint")).toBe(false);
    expect(vs.hasAttribute("data-vs-direction")).toBe(false);
    expect(vs.style.getPropertyValue("--hud-vs-mix")).toBe("");
    t.hud.destroy();
  });
});

describe("flight HUD auto-trim", () => {
  it("puts both autos in a diagonally split square, pitch in the lower left", () => {
    const t = mount();
    expect(t.rollAuto.parentElement?.className).toBe("flight-hud__auto-trims");
    expect(t.pitchAuto.parentElement).toBe(t.rollAuto.parentElement);
    expect(t.rollAuto.classList.contains("flight-hud__auto-trim--roll")).toBe(true);
    expect(t.pitchAuto.classList.contains("flight-hud__auto-trim--pitch")).toBe(true);
    expect([...t.rollAuto.parentElement!.children]).toEqual([t.rollAuto, t.pitchAuto]);
    expect([...t.rollAuto.querySelectorAll("span")].map((el) => el.textContent)).toEqual(["TRIM", "AUTO"]);
    expect([...t.pitchAuto.querySelectorAll("span")].map((el) => el.textContent)).toEqual(["AUTO", "TRIM"]);
    expect(t.pitchTrim.closest(".flight-hud__attitude-cluster")).toBe(t.rollAuto.closest(".flight-hud__attitude-cluster"));
    t.hud.destroy();
  });

  it("keeps pitch and flaps captions outside the slim tracks", () => {
    const t = mount();
    const pitch = t.pitchTrim.closest(".flight-hud__lever--pitch");
    const flaps = t.host.querySelector('[data-control="flaps"]')!.closest(".flight-hud__lever--flaps");
    expect(pitch?.querySelector(".flight-hud__lever-meta")?.textContent).toContain("PITCH");
    expect(flaps?.querySelector(".flight-hud__lever-meta")?.textContent).toContain("FLAPS");
    expect(pitch?.firstElementChild?.className).toBe("flight-hud__lever-meta");
    expect(flaps?.firstElementChild?.className).toBe("flight-hud__lever-meta");
    expect(t.pitchTrim.closest(".flight-hud__lever-track")).not.toBeNull();
    expect(t.host.querySelector('[data-control="flaps"]')!.closest(".flight-hud__lever-track")).not.toBeNull();
    t.hud.destroy();
  });

  it("starts off and asks the sim to toggle the matching axis", () => {
    const t = mount();
    expect(t.pitchAuto.getAttribute("aria-pressed")).toBe("false");
    expect(t.rollAuto.getAttribute("aria-pressed")).toBe("false");
    expect(t.pitchTrim.disabled).toBe(false);
    expect(t.rollTrim.disabled).toBe(false);
    t.pitchAuto.click();
    t.rollAuto.click();
    expect(t.onPitchAutoTrimChange).toHaveBeenCalledWith(true);
    expect(t.onRollAutoTrimChange).toHaveBeenCalledWith(true);
    expect(t.pitchAuto.classList.contains("is-on")).toBe(false);
    expect(t.rollAuto.classList.contains("is-on")).toBe(false);
    t.hud.destroy();
  });

  it("follows each latch and disables only that axis's wheel", () => {
    const t = mount();
    t.hud.update(STATE, CONTROLS, true, { pitch: true, roll: false });
    expect(t.pitchAuto.classList.contains("is-on")).toBe(true);
    expect(t.rollAuto.classList.contains("is-on")).toBe(false);
    expect(t.pitchTrim.disabled).toBe(true);
    expect(t.rollTrim.disabled).toBe(false);
    t.hud.update(STATE, CONTROLS, true, { pitch: false, roll: true });
    expect(t.pitchTrim.disabled).toBe(false);
    expect(t.rollTrim.disabled).toBe(true);
    t.hud.destroy();
  });

  it("describes leftover-moment assist, not attitude hold", () => {
    const t = mount();
    expect(t.pitchAuto.title).toMatch(/leftover pitch moment/i);
    t.hud.update(STATE, CONTROLS, true, { pitch: true, roll: true });
    expect(t.pitchAuto.title).toMatch(/leftover moment in real time/i);
    expect(t.rollAuto.title).not.toMatch(/holds roll|stick is centered/i);
    t.hud.destroy();
  });

  it("stops answering clicks once destroyed", () => {
    const t = mount();
    const pitchAuto = t.pitchAuto;
    const rollAuto = t.rollAuto;
    t.hud.destroy();
    pitchAuto.click();
    rollAuto.click();
    expect(t.onPitchAutoTrimChange).not.toHaveBeenCalled();
    expect(t.onRollAutoTrimChange).not.toHaveBeenCalled();
  });
});

describe("flight HUD master autopilot", () => {
  it("sits next to gear and asks the sim to toggle, lighting only from update", () => {
    const t = mount();
    expect(t.ap.textContent).toBe("AP");
    expect(t.ap.getAttribute("aria-pressed")).toBe("false");
    expect(t.ap.classList.contains("is-on")).toBe(false);
    t.ap.click();
    expect(t.onAutopilotEngageChange).toHaveBeenCalledWith(true);
    expect(t.ap.classList.contains("is-on")).toBe(false);
    t.hud.update(STATE, CONTROLS, true, AUTO_OFF, {
      engaged: true, canEngage: true, blockedReason: null,
      ownsPitch: true, ownsRoll: true, ownsGear: true, ownsFlaps: false,
    });
    expect(t.ap.getAttribute("aria-pressed")).toBe("true");
    expect(t.ap.classList.contains("is-on")).toBe(true);
    expect(t.ap.title).toMatch(/Autopilot on/);
    t.hud.destroy();
  });

  it("shows a blocked ArduPilot path without lighting as if it were flying", () => {
    const t = mount();
    t.hud.update(STATE, CONTROLS, true, AUTO_OFF, {
      engaged: false, canEngage: false, blockedReason: "ArduPilot is not connected.",
      ownsPitch: false, ownsRoll: false, ownsGear: false, ownsFlaps: false,
    });
    expect(t.ap.classList.contains("is-on")).toBe(false);
    expect(t.ap.classList.contains("is-blocked")).toBe(true);
    expect(t.ap.title).toMatch(/not connected/i);
    t.ap.click();
    expect(t.onAutopilotEngageChange).toHaveBeenCalledWith(true);
    t.hud.destroy();
  });

  it("stops answering clicks once destroyed", () => {
    const t = mount();
    const ap = t.ap;
    t.hud.destroy();
    ap.click();
    expect(t.onAutopilotEngageChange).not.toHaveBeenCalled();
  });
});

describe("flight HUD yaw-throttle cluster", () => {
  it("keeps eval above yaw and engine left of throttle", () => {
    const t = mount();
    const cluster = t.host.querySelector(".flight-hud__yaw-throttle");
    expect(cluster?.querySelector(".flight-hud__eval")).not.toBeNull();
    expect(cluster?.querySelector(".flight-hud__yaw")).not.toBeNull();
    expect(cluster?.querySelector(".flight-hud__engine")).not.toBeNull();
    expect(cluster?.querySelector(".flight-hud__throttle")).not.toBeNull();
    expect(cluster?.querySelector(".flight-hud__aoa")).toBeNull();
    const tapes = [...t.host.querySelector(".flight-hud__tapes")!.children];
    const vs = tapes.findIndex((node) => node.querySelector('[data-metric="vs"]'));
    const aoa = tapes.findIndex((node) => node.classList.contains("flight-hud__aoa"));
    expect(aoa).toBe(vs + 1);
    t.hud.destroy();
  });
});

describe("flight HUD and a paired phone", () => {
  function capturePointers(pad: HTMLElement): void {
    const captured = new Set<number>();
    Object.assign(pad, {
      setPointerCapture: (id: number) => { captured.add(id); },
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => { captured.delete(id); },
    });
  }
  const pointer = (type: string, init: PointerEventInit = {}) => new PointerEvent(type, {
    pointerId: 1, button: 0, pointerType: "mouse", bubbles: true, cancelable: true, ...init,
  });

  // The reported defect: with a phone flying, clicking another application
  // blurred the window, the stick pad let go of a stick nobody held, and that
  // "release" reached the controls as local input, which takes them from a phone.
  it("moves no control when the window loses focus, resizes or hides with nothing held", () => {
    const onLocalInput = vi.fn();
    const input = createFlightInputManager({ onLocalInput });
    const onRudderChange = vi.fn();
    const onThrottleChange = vi.fn();
    const t = mount({ onStickChange: (aileron, elevator) => input.setStick(aileron, elevator), onRudderChange, onThrottleChange });
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("resize"));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    t.hud.destroy();
    expect(onLocalInput).not.toHaveBeenCalled();
    expect(onRudderChange).not.toHaveBeenCalled();
    expect(onThrottleChange).not.toHaveBeenCalled();
  });

  it("still lets go of a held stick when the window loses focus, and only takes control for the deflection", () => {
    const onLocalInput = vi.fn();
    const input = createFlightInputManager({ onLocalInput });
    const t = mount({ onStickChange: (aileron, elevator) => input.setStick(aileron, elevator) });
    const pad = t.host.querySelector<HTMLElement>(".flight-hud__attitude")!;
    capturePointers(pad);
    vi.spyOn(pad, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 200));
    pad.dispatchEvent(pointer("pointerdown", { clientX: 190, clientY: 100 }));
    expect(onLocalInput).toHaveBeenCalledOnce();
    expect(input.poll(0).aileron).toBeGreaterThan(0.5);
    window.dispatchEvent(new Event("blur"));
    expect(input.poll(0).aileron).toBe(0);
    expect(input.hasActiveFlightInput()).toBe(false);
    // Letting go is not flying: it does not take control again.
    expect(onLocalInput).toHaveBeenCalledOnce();
    t.hud.destroy();
  });

  it("reports a finger resting on a flight control until it lifts, and nothing for the instruments", () => {
    const t = mount();
    expect(t.hud.isPilotHolding()).toBe(false);
    t.pitchTrim.dispatchEvent(pointer("pointerdown"));
    expect(t.hud.isPilotHolding()).toBe(true);
    window.dispatchEvent(pointer("pointerup"));
    expect(t.hud.isPilotHolding()).toBe(false);
    t.host.querySelector('[data-metric="ias"]')!.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));
    expect(t.hud.isPilotHolding()).toBe(false);
    t.rollTrim.dispatchEvent(pointer("pointerdown", { pointerId: 3 }));
    window.dispatchEvent(new Event("blur"));
    expect(t.hud.isPilotHolding()).toBe(false);
    t.hud.destroy();
  });
});
