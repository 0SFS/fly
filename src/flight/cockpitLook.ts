/**
 * The Cockpit view looks around as a 360 photograph does in FOSS Earth: the
 * same look, gestures, glide and Photograph → Looking settings
 * (`scene.panorama.*`), turning the cockpit camera about the pilot eye. It
 * holds the canvas only while the cockpit is shown, opens looking ahead at the
 * chosen field of view, and leaves the arrow keys to the flight controls.
 */
import { attachPanoramaLook, type PanoramaLookBinding, type PanoramaLookOptions } from "foss-earth/input";
import type { AircraftEntity } from "@0sfs/aircraft/createPlaceholderAircraft";

type CockpitAircraft = Pick<AircraftEntity, "getViewMode" | "lookFromCockpit">;

export interface CockpitLookOptions {
  canvas: HTMLCanvasElement;
  /** The aircraft flown now, if one is mounted. */
  aircraft(): CockpitAircraft | null;
  /** `osfs.camera.fieldOfView`: the cockpit opens at it. */
  fieldOfViewDeg(): number;
  inputMode: PanoramaLookOptions["inputMode"];
  requestRender(): void;
  now(): number;
  /** FOSS Earth's look; a test supplies its own. */
  attach?: typeof attachPanoramaLook;
}

export interface CockpitLook {
  /** Takes or lets go of the canvas as the cockpit is shown or left. Call it each frame, before `step`. */
  sync(): void;
  /** Advances the look's glide and held rates to now. */
  step(): void;
  /** The field of view setting changed: the cockpit takes it and keeps where it looks. */
  setFieldOfView(degrees: number): void;
  /** A held stick, −1 to 1: right looks right and up looks up. */
  setStick(x: number, y: number): void;
  dispose(): void;
}

export function createCockpitLook(options: CockpitLookOptions): CockpitLook {
  let look: PanoramaLookBinding | null = null;
  let lookingFrom: CockpitAircraft | null = null;
  // Like the photograph viewer, a glide steps by the time since its last frame.
  let ticking = false;
  let steppedAt = 0;
  let stick = { x: 0, y: 0 };
  const requestFrame = (): void => {
    options.requestRender();
    if (!ticking && look?.moving()) {
      ticking = true;
      steppedAt = options.now();
    }
  };
  const release = (): void => {
    look?.detach();
    look = null;
    lookingFrom = null;
    ticking = false;
    stick = { x: 0, y: 0 };
  };
  return {
    sync() {
      const aircraft = options.aircraft();
      const shown = aircraft !== null && aircraft.getViewMode() === "first";
      if (look && (!shown || aircraft !== lookingFrom)) release();
      if (!aircraft || !shown || look) return;
      lookingFrom = aircraft;
      const attach = options.attach ?? attachPanoramaLook;
      look = attach({
        canvas: options.canvas,
        initial: { headingDeg: 0, pitchDeg: 0, verticalFovDeg: options.fieldOfViewDeg() },
        onChange(state) {
          lookingFrom?.lookFromCockpit(state);
          options.requestRender();
        },
        requestFrame,
        inputMode: options.inputMode,
      });
      aircraft.lookFromCockpit(look.get());
    },
    step() {
      if (!look || !ticking) return;
      const now = options.now();
      const moving = look.step(now - steppedAt);
      steppedAt = now;
      if (moving) options.requestRender();
      else ticking = false;
    },
    setFieldOfView(degrees) {
      look?.set({ ...look.get(), verticalFovDeg: degrees });
    },
    setStick(x, y) {
      if (!look || (x === stick.x && y === stick.y)) return;
      stick = { x, y };
      look.setRates({ lookX: x, lookY: y, zoom: 0 });
    },
    dispose: release,
  };
}
