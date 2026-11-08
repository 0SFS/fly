import type { FlightParameterStore } from "../settings/flightParameters";

/** The setting: Interface → Flight instruments → Backgrounds over the view. */
export const HUD_BACKDROP_ID = "osfs.hud.backdrop";

/**
 * Flat marks the flight's root with `data-hud-backdrop="flat"`, and flight.css
 * then drops the backdrop blurs of the toolbar's load, gear and autopilot and
 * of the status card. Flat is the default. Blurred leaves the root unmarked, so the
 * page is styled as it was before the setting. Returns the watch's stop.
 */
export function watchHudBackdrop(
  parameters: Pick<FlightParameterStore, "get" | "watch">,
  element: HTMLElement | null,
): () => void {
  const apply = (): void => {
    if (parameters.get(HUD_BACKDROP_ID) === "flat") element?.setAttribute("data-hud-backdrop", "flat");
    else element?.removeAttribute("data-hud-backdrop");
  };
  apply();
  return parameters.watch(HUD_BACKDROP_ID, apply);
}
