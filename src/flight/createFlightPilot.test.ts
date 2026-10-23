import { describe, expect, it } from "vitest";
import { ALERT_PILOT, stepPilot } from "@0sfs/g-forces/gForce";
import { createFlightPilot, type FlightPilot, type FlightPilotSettings, type PilotTransition } from "./createFlightPilot";

const STEP = 1 / 60;
const SETTINGS: FlightPilotSettings = {
  curve: { blackout: { min: 5, max: 9 }, redout: { min: -3, max: -2 }, onsetSeconds: 5, recoverySeconds: 2 },
  passOut: { meanSeconds: 10, spreadSeconds: 0 },
  exposure: "relaxed",
  perfusion: "relaxed",
};

/** Holds `g` for `seconds`, one step at a time, and returns the transitions with their times. */
function hold(pilot: FlightPilot, g: number, seconds: number, start = 0): { seconds: number; transition: PilotTransition }[] {
  const transitions: { seconds: number; transition: PilotTransition }[] = [];
  const steps = Math.round(seconds / STEP);
  for (let step = 1; step <= steps; step++) {
    const transition = pilot.step(g, STEP);
    if (transition) transitions.push({ seconds: start + step * STEP, transition });
  }
  return transitions;
}

describe("createFlightPilot", () => {
  it("draws Curve exactly as the original pilot step", () => {
    const pilot = createFlightPilot("curve", { ...SETTINGS, passOut: null });
    let original = ALERT_PILOT;
    for (const g of [1, 4, 7, 9.5, 9.5, 6, 1, -2.5, -4, 1]) {
      for (let step = 0; step < 60; step++) {
        pilot.step(g, STEP);
        original = stepPilot(original, g, STEP, SETTINGS.curve, null);
      }
      expect(pilot.blackout()).toBeCloseTo(original.vision.blackout, 12);
      expect(pilot.redout()).toBeCloseTo(original.vision.redout, 12);
    }
    expect(pilot.profileId()).toBe("curve@1");
  });

  it("passes an Exposure pilot out once under a held pull and brings them to only after unloading", () => {
    const pilot = createFlightPilot("exposure", SETTINGS);
    expect(pilot.profileId()).toBe("exposure-relaxed@2");
    const pulled = hold(pilot, 8, 20);
    expect(pulled.map(each => each.transition)).toEqual(["passed-out"]);
    expect(pulled[0]!.seconds).toBeGreaterThan(3);
    expect(pilot.isOut()).toBe(true);
    expect(pilot.blackout()).toBe(1);
    const unloaded = hold(pilot, 1, 30, 20);
    expect(unloaded.map(each => each.transition)).toEqual(["came-to"]);
    expect(pilot.isOut()).toBe(false);
  });

  it("keeps the pilot on the controls while passing out is off", () => {
    const pilot = createFlightPilot("perfusion", { ...SETTINGS, passOut: null });
    expect(hold(pilot, 8, 20)).toEqual([]);
    expect(pilot.isOut()).toBe(false);
    expect(pilot.blackout()).toBe(1);
  });

  it("keeps the pilot's state across edits within the model", () => {
    const pilot = createFlightPilot("exposure", SETTINGS);
    hold(pilot, 6, 7);
    const blackout = pilot.blackout();
    expect(blackout).toBeGreaterThan(0);
    expect(pilot.configure({ ...SETTINGS, exposure: "suit-strain" })).toBeNull();
    expect(pilot.profileId()).toBe("exposure-protected@2");
    expect(pilot.blackout()).toBe(blackout);
  });

  it("wakes a pilot who is out when passing out is turned off", () => {
    const pilot = createFlightPilot("exposure", SETTINGS);
    hold(pilot, 8, 20);
    expect(pilot.isOut()).toBe(true);
    expect(pilot.configure({ ...SETTINGS, passOut: null })).toBe("came-to");
    expect(pilot.isOut()).toBe(false);
  });

  it("gives every model the redout range", () => {
    for (const kind of ["curve", "exposure", "perfusion"] as const) {
      const late = createFlightPilot(kind, { ...SETTINGS, curve: { ...SETTINGS.curve, redout: { min: -5, max: -4 } } });
      hold(late, -3, 10);
      expect(late.redout(), kind).toBe(0);
      const early = createFlightPilot(kind, SETTINGS);
      hold(early, -3, 10);
      expect(early.redout(), kind).toBeGreaterThan(0.9);
    }
  });

  it("is rested after a reset", () => {
    const pilot = createFlightPilot("perfusion", SETTINGS);
    hold(pilot, 8, 20);
    pilot.reset();
    expect(pilot.isOut()).toBe(false);
    expect(pilot.blackout()).toBe(0);
    expect(hold(pilot, 1, 1)).toEqual([]);
  });
});
