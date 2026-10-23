import "./evaluationInstruments.css";
import { propertyInCatalog, type FlightRecorderPropertyReader } from "@0sfs/logging/flightRecorder";

/**
 * Angle-of-attack tape and CAS warnings for pilot evaluation. AoA sits in the
 * left tape row, immediately right of VS, or on the attitude indicator's
 * bottom left corner in the Compact layout. CAS sits above yaw. N1, fuel flow
 * and flight recording live elsewhere.
 *
 * Readouts appear only for properties the loaded aircraft has, so the C172
 * shows AoA without a CAS line.
 */

export interface EvaluationInstrumentsHandle {
  update(reader: FlightRecorderPropertyReader): void;
  /** The angle of attack last read, in degrees; null when the aircraft has none. */
  aoaDeg(): number | null;
  destroy(): void;
}

const ALPHA = "aero/alpha-deg";
const STALL_WARNING = "fcs/stall-warning";
const STICK_PUSHER = "fcs/stick-pusher";

export function createEvaluationInstruments(root: HTMLElement): EvaluationInstrumentsHandle {
  const container = document.createElement("div");
  container.className = "flight-eval";
  container.innerHTML = `<div class="flight-eval__cas" aria-live="assertive"></div>`;
  root.appendChild(container);

  const aoa = document.createElement("div");
  aoa.className = "flight-hud__tape flight-eval__readout";
  aoa.dataset.readout = "aoa";
  aoa.hidden = true;
  aoa.innerHTML = `
    <div class="flight-hud__tape-header"><span class="flight-hud__label">AOA</span><span class="flight-hud__unit">°</span></div>
    <span class="flight-hud__value" data-value="aoa"> 0.0</span>
  `;
  const aoaHost = root.closest(".flight-hud")?.querySelector(".flight-hud__aoa") ?? container;
  aoaHost.appendChild(aoa);

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = container.querySelector<T>(selector) ?? aoa.querySelector<T>(selector);
    if (!el) throw new Error(`Evaluation instruments markup is missing ${selector}.`);
    return el;
  };
  // Edit the readout's own text node: replacing it forces a page restyle every frame.
  const aoaText = query('[data-value="aoa"]').firstChild as Text;
  const cas = query(".flight-eval__cas");

  let available: Record<"aoa" | "stallWarning" | "stickPusher", boolean> | null = null;
  let lastCas = "";
  let lastAoaDeg: number | null = null;

  return {
    update(reader: FlightRecorderPropertyReader): void {
      // Property sets are fixed once an aircraft is loaded; changing aircraft reloads the app.
      if (!available) {
        available = {
          aoa: propertyInCatalog(reader, ALPHA),
          stallWarning: propertyInCatalog(reader, STALL_WARNING),
          stickPusher: propertyInCatalog(reader, STICK_PUSHER),
        };
        aoa.hidden = !available.aoa;
      }
      if (available.aoa) {
        lastAoaDeg = reader.getPropertyValue(ALPHA);
        // Room for "12.3" and "-4.5"; only a deep negative stall is wider.
        const text = lastAoaDeg.toFixed(1).padStart(4, " ");
        if (aoaText.data !== text) aoaText.data = text;
      }

      // STICK PUSHER outranks STALL WARNING; both are red CAS warnings in the AFM.
      const next = available.stickPusher && reader.getPropertyValue(STICK_PUSHER) > 0.5 ? "STICK PUSHER"
        : available.stallWarning && reader.getPropertyValue(STALL_WARNING) > 0.5 ? "STALL WARNING" : "";
      if (next !== lastCas) {
        lastCas = next;
        cas.textContent = next;
        cas.classList.toggle("is-active", next !== "");
      }
    },
    aoaDeg: () => lastAoaDeg,
    destroy(): void {
      aoa.remove();
      container.remove();
    },
  };
}
