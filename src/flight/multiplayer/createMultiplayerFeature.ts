import { createServerlessSession, type LocalPose } from "@0sfs/multiplayer/serverlessSession";
import { readInvitation } from "@0sfs/multiplayer/invitation";
import type { AircraftPose } from "@0sfs/multiplayer/protocol";
import type { Scene } from "@babylonjs/core";
import { createRemoteAircraft, type RemoteAircraftFrame } from "./remoteAircraft";
import { createMultiplayerInvitation } from "./createMultiplayerInvitation";
import { readInvitationStart, type InvitationStart } from "./invitationStart";
import type { InvitationStartControlsProps } from "./InvitationStartControls";
import type { FlightLocation } from "../location/flightLocation";
import type { SharedFlightSettings, SharedSettingsPatch } from "@0sfs/multiplayer/sharedSettings";
import type { SharedSettingsPanelState } from "./SharedSettingsPanel";
import "./multiplayer.css";

export function createMultiplayerFeature(options: {
  scene: Scene;
  getLocal(): { pose: LocalPose; held: boolean };
  getRenderFrame(): RemoteAircraftFrame | null;
  requestRender(): void;
  onSpawn(pose: AircraftPose, location?: FlightLocation): void;
  prepareJoin?(href: string, start: InvitationStart): boolean;
  invitationControls?: Omit<InvitationStartControlsProps, "onChange">;
  baseUrl: string;
  getGoogleKey?(): string | null;
  invitation: string | null;
  initialSharedSettings?: SharedFlightSettings;
  onSharedSettingsChange?(state: SharedSettingsPanelState): void;
}) {
  const remote = createRemoteAircraft(options.scene, options.requestRender);
  let guestStart: InvitationStart = {};
  const session = createServerlessSession({
    aircraftId: () => options.getLocal().pose.aircraftId,
    initialSharedSettings: options.initialSharedSettings,
    onChange: () => { options.onSharedSettingsChange?.(sharedSettingsView()); refresh(); options.requestRender(); },
    onPose: options.requestRender,
    onSpawn: pose => options.onSpawn(pose, guestStart.location),
  });
  let mounted: HTMLElement | null = null;
  let draft = options.invitation ?? "";
  let busy = false;
  let error = "";
  let previousFrame = performance.now();
  let disposed = false;
  const panel = document.createElement("fieldset");
  panel.className = "flight-panel__fieldset multiplayer-panel";
  const legend = document.createElement("legend"); legend.textContent = "Multiplayer";
  const status = document.createElement("p"); status.className = "flight-panel__hint"; status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "flight-panel__actions";
  const host = button("Host flight", () => perform(() => session.host(options.baseUrl)));
  const joinInput = document.createElement("input"); joinInput.type = "text"; joinInput.placeholder = "Invitation link";
  joinInput.setAttribute("aria-label", "Multiplayer invitation link"); joinInput.autocomplete = "off"; joinInput.spellcheck = false;
  joinInput.value = draft; joinInput.style.cssText = "min-width:0;width:100%;box-sizing:border-box";
  joinInput.addEventListener("input", () => { draft = joinInput.value; });
  const join = button("Join flight", () => perform(async () => {
    if (!readInvitation(draft)) throw new Error("Paste a valid multiplayer invitation link.");
    guestStart = readInvitationStart(draft);
    if (options.prepareJoin?.(draft, guestStart) === false) return;
    await session.join(draft); draft = ""; joinInput.value = "";
  }));
  const leave = button("Disconnect", () => { session.disconnect(); error = ""; refresh(); });
  const renew = button("New invitation", () => { try { session.invite(options.baseUrl); } catch (cause) { error = String(cause); } refresh(); });
  const invitation = createMultiplayerInvitation(options.invitationControls);
  const joinGroup = document.createElement("div"); joinGroup.append(joinInput, join);
  const help = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "?"; summary.setAttribute("aria-label", "Multiplayer connection details");
  const explanation = document.createElement("p"); explanation.className = "flight-panel__hint";
  explanation.textContent = "Two pilots, direct aircraft connection. Share one invitation per flight; it expires in two minutes. Optional aircraft and location settings apply to the guest. Without a location, the guest arrives paused beside the host; press Resume to fly. Pause affects only your aircraft. Both devices need the app open; connection setup uses PeerJS Cloud and public STUN. Some networks need a configured TURN service.";
  const details = document.createElement("p"); details.className = "flight-panel__hint";
  const peerHealth = document.createElement("div"); peerHealth.className = "multiplayer-health"; peerHealth.hidden = true;
  const healthLabel = document.createElement("span"); healthLabel.textContent = "Other aircraft";
  const healthMeter = document.createElement("meter");
  healthMeter.min = 0; healthMeter.max = 100; healthMeter.low = 25; healthMeter.high = 60; healthMeter.optimum = 100;
  healthMeter.setAttribute("aria-label", "Other aircraft health");
  const healthValue = document.createElement("output");
  peerHealth.append(healthLabel, healthMeter, healthValue);
  help.append(summary, explanation, details);
  actions.append(host, renew, leave);
  panel.append(legend, status, peerHealth, actions, invitation.element, joinGroup, help);
  function button(label: string, action: () => void) {
    const element = document.createElement("button"); element.type = "button"; element.className = "flight-panel__command";
    element.textContent = label; element.addEventListener("click", action); return element;
  }
  function sharedSettingsView(): SharedSettingsPanelState {
    const snapshot = session.snapshot();
    return {
      values: snapshot.sharedSettings,
      role: snapshot.status === "idle" || snapshot.status === "error" ? "local" : snapshot.role ?? "local",
      ready: snapshot.sharedSettingsReady, pending: snapshot.sharedSettingsPending, error: snapshot.sharedSettingsError,
    };
  }
  async function perform(run: () => Promise<unknown>) {
    busy = true; error = ""; refresh();
    try { await run(); } catch (cause) { error = cause instanceof Error ? cause.message : "Multiplayer could not start."; }
    finally { busy = false; refresh(); }
  }
  function refresh() {
    if (!mounted || disposed) return;
    const state = session.snapshot();
    const health = session.render().aircraft[0]?.pose.health;
    peerHealth.hidden = health === undefined;
    if (health !== undefined) {
      healthMeter.value = health;
      healthValue.textContent = health === 0 ? "Destroyed · 0 / 100" : `${health} / 100`;
    }
    status.textContent = error || state.message;
    const idle = state.status === "idle" || state.status === "error";
    host.hidden = !idle; host.disabled = busy;
    joinGroup.hidden = !idle; join.disabled = busy;
    leave.hidden = idle; leave.disabled = false;
    renew.hidden = state.role !== "host" || state.status !== "hosting"; renew.disabled = busy;
    invitation.update(state.invitationUrl, options.getGoogleKey?.() ?? null);
    const diag = state.diagnostics;
    details.textContent = state.status === "connected"
      ? `${state.held ? "Other pilot paused" : state.stale ? "Aircraft updates are stale" : "Receiving aircraft updates"}. Path: ${diag?.path ?? "unknown"}. ICE round trip: ${diag?.iceRttMs === null || !diag ? "unknown" : `${Math.round(diag.iceRttMs)} ms`}. Receive to present: ${state.receiveToPresentMs === null ? "unknown" : `${Math.round(state.receiveToPresentMs)} ms`}.`
      : "Aircraft snapshots use an unordered channel with no retransmission. No aircraft connection opens until you host or join.";
  }
  // Keep the peer's aircraft moving when this pilot pauses the local simulator.
  const timer = setInterval(() => {
    if (disposed) return;
    const state = session.snapshot();
    if (state.status !== "connected") return;
    const local = options.getLocal(); session.update(local.pose, local.held);
    options.requestRender(); refresh();
  }, 1000 / 30);
  const frame = options.scene.onBeforeRenderObservable.add(() => {
    const time = performance.now();
    const state = session.render();
    remote.update(state.aircraft[0], state.aircraft.length ? options.getRenderFrame() : null, Math.min((time - previousFrame) / 1000, 0.1));
    previousFrame = time;
  });
  return {
    setSharedSettings(patch: SharedSettingsPatch) { session.setSharedSettings(patch); },
    mount(element: HTMLElement) { mounted = element; element.append(panel); refresh(); return () => { if (mounted === element) { mounted = null; panel.remove(); } }; },
    diagnostics() { return { ...session.snapshot(), invitationUrl: undefined }; },
    hasInvitation: Boolean(options.invitation && readInvitation(options.invitation)),
    dispose() { disposed = true; clearInterval(timer); options.scene.onBeforeRenderObservable.remove(frame); session.dispose(); remote.dispose(); invitation.dispose(); panel.remove(); },
  };
}
