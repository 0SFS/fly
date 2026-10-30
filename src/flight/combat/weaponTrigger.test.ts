import { describe, expect, it } from "vitest";
import { createWeaponTrigger } from "./weaponTrigger";

describe("weapon trigger sources", () => {
  it("preserves a UI tap between ticks without sticking the gun trigger", () => {
    const trigger = createWeaponTrigger();
    trigger.setUiHeld(true);
    trigger.setUiHeld(false);
    expect(trigger.read(false)).toEqual({ held: false, pressed: true });
    expect(trigger.read(false)).toEqual({ held: false, pressed: false });
  });

  it("combines held sources and preserves fresh presses from the other source", () => {
    const trigger = createWeaponTrigger();
    expect(trigger.read(true)).toEqual({ held: true, pressed: true });
    trigger.setUiHeld(true);
    expect(trigger.read(true)).toEqual({ held: true, pressed: true });
    trigger.setUiHeld(false);
    expect(trigger.read(true)).toEqual({ held: true, pressed: false });
    expect(trigger.read(false)).toEqual({ held: false, pressed: false });
  });

  it("requires release after arming, selecting or resuming with a held binding", () => {
    const trigger = createWeaponTrigger();
    trigger.cancel(true);
    trigger.setUiHeld(true);
    expect(trigger.read(true)).toEqual({ held: false, pressed: false });
    trigger.setUiHeld(false);
    expect(trigger.read(false)).toEqual({ held: false, pressed: false });
    expect(trigger.needsRelease()).toBe(false);
    expect(trigger.read(true)).toEqual({ held: true, pressed: true });
  });

  it("discards a canceled tap and allows a new UI gesture", () => {
    const trigger = createWeaponTrigger();
    trigger.setUiHeld(true);
    trigger.cancel(false);
    expect(trigger.read(false)).toEqual({ held: false, pressed: false });
    trigger.setUiHeld(true);
    expect(trigger.read(false)).toEqual({ held: true, pressed: true });
  });

  it("waits for a neutral sample when the controller value was stale at resume", () => {
    const trigger = createWeaponTrigger();
    trigger.cancel(false);
    expect(trigger.needsRelease()).toBe(true);
    expect(trigger.read(true)).toEqual({ held: false, pressed: false });
    expect(trigger.read(false)).toEqual({ held: false, pressed: false });
    expect(trigger.read(true)).toEqual({ held: true, pressed: true });
  });
});
