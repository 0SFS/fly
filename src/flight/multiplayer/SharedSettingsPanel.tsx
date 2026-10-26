import { ChoiceTrack, HelpTip } from "foss-earth/shell";
import type { SharedFlightSettings, SharedSettingsPatch } from "@0sfs/multiplayer/sharedSettings";

export interface SharedSettingsPanelState {
  values: SharedFlightSettings;
  role: "local" | "host" | "guest";
  ready: boolean;
  pending: boolean;
  error: string | null;
}

export function SharedSettingsPanel({ state, onChange }: {
  state: SharedSettingsPanelState;
  onChange(patch: SharedSettingsPatch): void;
}) {
  const waiting = !state.ready || state.pending;
  const canEdit = !waiting && (state.role !== "guest" || state.values.settingsEditors === "everyone");
  return <div className="flight-panel__content">
    <p className="flight-panel__hint" role="status">
      {state.error || (state.pending ? "Waiting for the host…" : !state.ready ? "Synchronizing shared settings…"
        : state.role === "local" ? "Local settings. Hosting shares them with every pilot."
          : state.values.settingsEditors === "host" ? "Shared by all pilots. Only the host can edit."
            : "Shared by all pilots. Everyone can request changes.")}
    </p>
    <fieldset className="flight-panel__fieldset">
      <legend>Damage</legend>
      <ChoiceTrack heading="Implementation" value={state.values.damageImplementation} defaultValue="health-v1" disabled={!canEdit}
        choices={[{ id: "off-v1", label: "Off" }, { id: "health-v1", label: "Health" }]}
        onChange={value => onChange({ damageImplementation: value as SharedFlightSettings["damageImplementation"] })}
        help="Health gives each aircraft one 100-point pool. Off ignores damage. Changing implementation resets health for everyone and pauses flight. Every connected pilot must use the same implementation." />
    </fieldset>
    <fieldset className="flight-panel__fieldset">
      <legend>Permissions</legend>
      <ChoiceTrack heading="Settings editors" value={state.values.settingsEditors} defaultValue="host" disabled={state.role !== "host" || waiting}
        choices={[{ id: "host", label: "Host" }, { id: "everyone", label: "Everyone" }]}
        onChange={value => onChange({ settingsEditors: value as SharedFlightSettings["settingsEditors"] })} />
    </fieldset>
    <HelpTip label="Explain shared settings permissions">
      The host always decides the accepted settings and is the only pilot who can change permissions.
      Everyone lets guests request setting changes; it does not give them permission to change these permissions.
      Settings synchronize before aircraft updates start. Host a flight in Multiplayer to manage permissions.
    </HelpTip>
  </div>;
}
