import { createHelpTooltip } from "@foss-earth/ui/browser";
import type { SettingsRegistry } from "foss-earth/settings";
import { createShareLink } from "./createShareLink";
import { captureSharedFlight, describeSharedFlight, sharedFlightUrl, type FlightShareSource } from "./flightShare";

export interface FlightShareOptions {
  /** The flight in progress, or null before there is one. */
  getSource(): FlightShareSource | null;
  settings: Pick<SettingsRegistry, "inspect" | "get">;
  baseUrl: string;
  getGoogleKey?(): string | null;
}

/**
 * Shares the flight in progress as a link: whoever opens it starts a new
 * flight in the same aircraft, place and motion. Each press captures the
 * flight as it is then; the link does not follow the aircraft.
 */
export function createFlightShare(options: FlightShareOptions) {
  const element = document.createElement("fieldset");
  element.className = "flight-panel__fieldset multiplayer-panel multiplayer-share";
  const legend = document.createElement("legend"); legend.textContent = "Share flight";
  const actions = document.createElement("div"); actions.className = "flight-panel__actions";
  const capture = document.createElement("button");
  capture.type = "button"; capture.className = "flight-panel__command";
  capture.textContent = "Link this flight";
  const explanation = document.createElement("p");
  explanation.textContent = "Opening the link starts a new flight for that visit: this aircraft, place, height above the ground, heading, pitch, climb angle and airspeed, wings level. "
    + "Height is from the ground rather than sea level because maps disagree about the ground's height. "
    + "Each press links the flight as it is then. Include gkey adds your Google Maps key: anyone with the link can use it, and their device keeps it.";
  const help = createHelpTooltip({ label: "About shared flight links", content: explanation });
  actions.append(capture, help.element);
  const summary = document.createElement("p");
  summary.className = "flight-panel__hint"; summary.setAttribute("role", "status");
  summary.hidden = true;
  const link = createShareLink({ link: "Shared flight link", copy: "Copy link", qr: "Scan to start this flight", noun: "link" });
  element.append(legend, actions, summary, link.element);
  capture.addEventListener("click", () => {
    const source = options.getSource();
    const flight = source ? captureSharedFlight(source, options.settings) : null;
    summary.hidden = false;
    summary.classList.toggle("is-error", !flight);
    if (!flight) {
      summary.textContent = "The ground under the aircraft has not loaded yet. Try again in a moment.";
      link.update(null);
      return;
    }
    summary.textContent = describeSharedFlight(flight, options.settings.get<"m" | "ft">("interface.position.altitudeUnit") === "ft" ? "ft" : "m");
    link.update(sharedFlightUrl(options.baseUrl, flight), options.getGoogleKey?.() ?? null);
  });
  return {
    element,
    dispose() { help.destroy(); link.dispose(); element.remove(); },
  };
}
