/** Combines UI taps and held flight bindings without manufacturing key events. */
export function createWeaponTrigger() {
  let uiHeld = false;
  let uiPressed = false;
  let externalWasHeld = false;
  let releaseRequired = false;

  return {
    setUiHeld(held: boolean): void {
      if (held && !uiHeld && !releaseRequired) uiPressed = true;
      uiHeld = held;
    },
    /** Cancellation discards taps and requires any held physical binding to release. */
    cancel(externalHeld: boolean): void {
      uiHeld = false;
      uiPressed = false;
      externalWasHeld = externalHeld;
      // Observe neutral in a subsequent sample: gamepad state can be stale at a focus/resume event.
      releaseRequired = true;
    },
    needsRelease(): boolean { return releaseRequired; },
    read(externalHeld: boolean): { held: boolean; pressed: boolean } {
      if (releaseRequired) {
        if (!externalHeld && !uiHeld) releaseRequired = false;
        externalWasHeld = externalHeld;
        uiPressed = false;
        return { held: false, pressed: false };
      }
      const pressed = uiPressed || (externalHeld && !externalWasHeld);
      uiPressed = false;
      externalWasHeld = externalHeld;
      return { held: externalHeld || uiHeld, pressed };
    },
  };
}
