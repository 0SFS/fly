import { HelpTip } from "foss-earth/shell";
import type { DamageAction } from "./aircraftHealth";
import type { AircraftDamageSnapshot } from "./aircraftDamage";
import "./damage.css";

export function DamagePanel({ state, onAction }: {
  state: AircraftDamageSnapshot;
  onAction(action: DamageAction): void;
}) {
  if (state.model === "off") return <div className="flight-panel__content"><p>Damage is off. Change it in Shared settings.</p></div>;
  return <div className="flight-panel__content">
    <fieldset className="flight-panel__fieldset">
      <legend>Aircraft health</legend>
      <div className="aircraft-health">
        <meter aria-label="Aircraft health" min={0} max={state.maxHealth} low={25} high={60}
          optimum={state.maxHealth} value={state.health} />
        <output aria-live="polite" aria-atomic="true">{state.health} / {state.maxHealth}</output>
        <HelpTip label="Explain aircraft health">
          One health pool covers the whole aircraft. Hits reduce it; at zero the aircraft is destroyed and
          flight pauses until repaired. Partial damage leaves flight handling unchanged.
        </HelpTip>
      </div>
      {state.destroyed && <p role="status">Aircraft destroyed. Repair before resuming.</p>}
      <div className="flight-panel__actions">
        <button type="button" className="flight-panel__command" disabled={state.health === state.maxHealth}
          onClick={() => onAction({ type: "repair" })}>Repair aircraft</button>
      </div>
    </fieldset>
    <details className="flight-panel__fieldset">
      <summary>Test damage</summary>
      <div className="flight-panel__actions">
        <button type="button" className="flight-panel__command" disabled={state.destroyed}
          onClick={() => onAction({ type: "test-hit" })}>Apply 25 damage</button>
        <HelpTip label="Explain test damage">
          Applies one test hit to your own aircraft. Gun hits and terrain impacts are not connected yet.
          Repair restores 100 health and leaves flight paused if it was paused.
        </HelpTip>
      </div>
    </details>
  </div>;
}
