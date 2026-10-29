import { readFlightServerUrl, readInvitation, readServerInvitation } from "@0sfs/multiplayer/invitation";
import type { ShownPose } from "@0sfs/multiplayer/posePlayout";
import type { AircraftPose, CombatMessage } from "@0sfs/multiplayer/protocol";
import { createServerSession, type LocalPose } from "@0sfs/multiplayer/serverSession";
import { createServerlessSession } from "@0sfs/multiplayer/serverlessSession";
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
  onCombat?(message: CombatMessage): void;
}) {
  const remote = new Map<string, ReturnType<typeof createRemoteAircraft>>();
  let guestStart: InvitationStart = {};
  let active: "direct" | "server" = "direct";
  const shared = {
    aircraftId: () => options.getLocal().pose.aircraftId,
    initialSharedSettings: options.initialSharedSettings,
    onChange: () => { options.onSharedSettingsChange?.(sharedSettingsView()); refresh(); options.requestRender(); },
    onPose: options.requestRender,
    onSpawn: (pose: AircraftPose) => options.onSpawn(pose, guestStart.location),
    onCombat: options.onCombat,
  };
  const direct = createServerlessSession(shared);
  const server = createServerSession({ ...shared, serverUrl: () => serverInput.value.trim(), certHash: () => certInput.value.trim() || null });
  const current = () => active === "server" ? server : direct;
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
  const host = button("Host flight", () => perform(async () => { active = "direct"; server.disconnect(); await direct.host(options.baseUrl); }));
  const hostServer = button("Host on server", () => perform(async () => {
    if (!readFlightServerUrl(serverInput.value.trim())) throw new Error("Enter an https flight server address.");
    server.replaceIdleSettings(direct.snapshot().sharedSettings);
    direct.disconnect();
    active = "server";
    await server.host(options.baseUrl);
  }));
  const serverInput = document.createElement("input"); serverInput.type = "url"; serverInput.placeholder = "Flight server";
  serverInput.value = "https://127.0.0.1:4433/flight"; serverInput.setAttribute("aria-label", "Flight server address");
  serverInput.autocomplete = "off"; serverInput.spellcheck = false; serverInput.style.cssText = "min-width:0;width:100%;box-sizing:border-box";
  const certInput = document.createElement("input"); certInput.type = "text"; certInput.placeholder = "Certificate hash";
  certInput.setAttribute("aria-label", "Flight server certificate hash");
  certInput.autocomplete = "off"; certInput.spellcheck = false; certInput.style.cssText = "min-width:0;width:100%;box-sizing:border-box";
  const serverFields = document.createElement("div"); serverFields.append(serverInput, certInput);
  const joinInput = document.createElement("input"); joinInput.type = "text"; joinInput.placeholder = "Invitation link";
  joinInput.setAttribute("aria-label", "Multiplayer invitation link"); joinInput.autocomplete = "off"; joinInput.spellcheck = false;
  joinInput.value = draft; joinInput.style.cssText = "min-width:0;width:100%;box-sizing:border-box";
  joinInput.addEventListener("input", () => { draft = joinInput.value; });
  const join = button("Join flight", () => perform(async () => {
    const serverInvite = readServerInvitation(draft);
    const peerInvite = readInvitation(draft);
    if (!serverInvite && !peerInvite) throw new Error("Paste a valid multiplayer invitation link.");
    guestStart = readInvitationStart(draft);
    if (options.prepareJoin?.(draft, guestStart) === false) return;
    if (serverInvite) { direct.disconnect(); active = "server"; await server.join(draft); }
    else { server.disconnect(); active = "direct"; await direct.join(draft); }
    draft = ""; joinInput.value = "";
  }));
  const leave = button("Disconnect", () => {
    const settings = current().snapshot().sharedSettings;
    const wasServer = active === "server";
    current().disconnect();
    if (wasServer) { active = "direct"; direct.replaceIdleSettings({ damageImplementation: settings.damageImplementation, settingsEditors: "host" }); }
    error = ""; refresh();
  });
  const renew = button("New invitation", () => { try { current().invite(options.baseUrl); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); } refresh(); });
  const invitation = createMultiplayerInvitation(options.invitationControls);
  const joinGroup = document.createElement("div"); joinGroup.append(joinInput, join);
  const help = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "?"; summary.setAttribute("aria-label", "Multiplayer connection details");
  const explanation = document.createElement("p"); explanation.className = "flight-panel__hint";
  explanation.textContent = "Host flight connects two pilots directly. Host on server uses a flight server for more pilots; paste its address and, for a local certificate, its hash. Share one invitation per flight; it expires in two minutes. Optional aircraft and location settings apply to the guest. Without a location, the guest arrives paused beside the host; press Resume to fly. Pause affects only your aircraft.";
  const details = document.createElement("p"); details.className = "flight-panel__hint";
  const peerHealth = document.createElement("div"); peerHealth.className = "multiplayer-health"; peerHealth.hidden = true;
  const healthLabel = document.createElement("span"); healthLabel.textContent = "Other aircraft";
  const localHealth = document.createElement("div"); localHealth.className = "multiplayer-health"; localHealth.hidden = true;
  const localLabel = document.createElement("span"); localLabel.textContent = "Your aircraft";
  const localMeter = document.createElement("meter");
  localMeter.min = 0; localMeter.max = 100; localMeter.low = 25; localMeter.high = 60; localMeter.optimum = 100;
  localMeter.setAttribute("aria-label", "Your aircraft health");
  const localValue = document.createElement("output");
  localHealth.append(localLabel, localMeter, localValue);
  const healthMeter = document.createElement("meter");
  healthMeter.min = 0; healthMeter.max = 100; healthMeter.low = 25; healthMeter.high = 60; healthMeter.optimum = 100;
  healthMeter.setAttribute("aria-label", "Other aircraft health");
  const healthValue = document.createElement("output");
  peerHealth.append(healthLabel, healthMeter, healthValue);
  help.append(summary, explanation, details);
  actions.append(host, hostServer, renew, leave);
  panel.append(legend, status, localHealth, peerHealth, actions, serverFields, invitation.element, joinGroup, help);
  function button(label: string, action: () => void) {
    const element = document.createElement("button"); element.type = "button"; element.className = "flight-panel__command";
    element.textContent = label; element.addEventListener("click", action); return element;
  }
  function drawRemote(aircraft: readonly ShownPose[], frame: RemoteAircraftFrame | null, dt: number) {
    const live = new Set(aircraft.map(item => item.pose.pilotId));
    for (const [id, slot] of remote) if (!live.has(id)) { slot.dispose(); remote.delete(id); }
    for (const shown of aircraft) {
      let slot = remote.get(shown.pose.pilotId);
      if (!slot) { slot = createRemoteAircraft(options.scene, options.requestRender, shown.pose.pilotId); remote.set(shown.pose.pilotId, slot); }
      slot.update(frame ? shown : undefined, frame, dt);
    }
  }
  function sharedSettingsView(): SharedSettingsPanelState {
    const snapshot = current().snapshot();
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
    const state = current().snapshot();
    const view = current().render();
    const own = options.getLocal()?.pose?.health;
    localHealth.hidden = own === undefined;
    if (own !== undefined) {
      localMeter.value = own;
      localValue.textContent = own === 0 ? "Destroyed · 0 / 100" : `${own} / 100`;
    }
    const health = view.aircraft.find(item => item.pose.health !== undefined)?.pose.health;
    peerHealth.hidden = health === undefined;
    if (health !== undefined) {
      healthMeter.value = health;
      healthValue.textContent = health === 0 ? "Destroyed · 0 / 100" : `${health} / 100`;
    }
    status.textContent = error || state.message;
    const idle = state.status === "idle" || state.status === "error";
    host.hidden = hostServer.hidden = serverFields.hidden = !idle; host.disabled = hostServer.disabled = busy;
    joinGroup.hidden = !idle; join.disabled = busy;
    leave.hidden = idle; leave.disabled = false;
    renew.hidden = state.role !== "host" || (state.status !== "hosting" && !state.invitationUrl); renew.disabled = busy;
    invitation.update(state.invitationUrl, options.getGoogleKey?.() ?? null);
    const diag = state.diagnostics;
    const count = view.aircraft.length;
    details.textContent = state.status === "connected"
      ? `${count} aircraft. ${state.held ? "A pilot is paused" : state.stale ? "Aircraft updates are stale" : "Receiving aircraft updates"}. Path: ${active === "server" ? "flight server" : diag?.path ?? "unknown"}. Round trip: ${diag?.iceRttMs === null || !diag ? "unknown" : `${Math.round(diag.iceRttMs)} ms`}. Receive to present: ${state.receiveToPresentMs === null ? "unknown" : `${Math.round(state.receiveToPresentMs)} ms`}.`
      : "No aircraft connection opens until you host or join.";
  }
  // Keep the peer's aircraft moving when this pilot pauses the local simulator.
  const timer = setInterval(() => {
    if (disposed) return;
    const state = current().snapshot();
    if (state.status !== "connected") return;
    const local = options.getLocal(); current().update(local.pose, local.held);
    options.requestRender(); refresh();
  }, 1000 / 30);
  const frame = options.scene.onBeforeRenderObservable.add(() => {
    const time = performance.now();
    const state = current().render();
    drawRemote(state.aircraft, state.aircraft.length ? options.getRenderFrame() : null, Math.min((time - previousFrame) / 1000, 0.1));
    previousFrame = time;
  });
  return {
    setSharedSettings(patch: SharedSettingsPatch) { current().setSharedSettings(patch); },
    publishCombat(message: CombatMessage) { return current().publishCombat(message); },
    combatClock() {
      const session = current();
      return { connected: session.snapshot().status === "connected", selfId: session.selfId(), nowMs: session.nowMs(), remotes: session.remotePoses() };
    },
    mount(element: HTMLElement) { mounted = element; element.append(panel); refresh(); return () => { if (mounted === element) { mounted = null; panel.remove(); } }; },
    diagnostics() { return { ...current().snapshot(), invitationUrl: undefined }; },
    hasInvitation: Boolean(options.invitation && (readInvitation(options.invitation) || readServerInvitation(options.invitation))),
    dispose() { disposed = true; clearInterval(timer); options.scene.onBeforeRenderObservable.remove(frame); direct.dispose(); server.dispose(); for (const slot of remote.values()) slot.dispose(); invitation.dispose(); panel.remove(); },
  };
}
