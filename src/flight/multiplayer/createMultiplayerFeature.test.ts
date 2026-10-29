// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { Scene } from "@babylonjs/core";
import type { AircraftPose } from "@0sfs/multiplayer/protocol";
import { createMultiplayerFeature } from "./createMultiplayerFeature";
import { withInvitationStart } from "./invitationStart";

const fake = vi.hoisted(() => ({ onSpawn: vi.fn<(pose: unknown) => void>(), join: vi.fn(), dispose: vi.fn(), serverJoin: vi.fn(), serverHost: vi.fn() }));
vi.mock("./remoteAircraft", () => ({ createRemoteAircraft: () => ({ update: vi.fn(), dispose: vi.fn() }) }));
vi.mock("@0sfs/multiplayer/serverlessSession", () => ({ createServerlessSession: (options: { onSpawn(pose: unknown): void }) => {
  fake.onSpawn.mockImplementation(options.onSpawn);
  return { join: fake.join, host: vi.fn(), invite: vi.fn(), disconnect: vi.fn(), dispose: fake.dispose, update: vi.fn(),
    replaceIdleSettings: vi.fn(), setSharedSettings: vi.fn(), render: () => ({ aircraft: [] }),
    snapshot: () => ({ status: "idle", role: null, message: "Off", invitationUrl: null, diagnostics: null,
      sharedSettings: { damageImplementation: "health-v1", settingsEditors: "host" }, sharedSettingsReady: true,
      sharedSettingsPending: false, sharedSettingsError: null, held: false, stale: false, receiveToPresentMs: null }) };
} }));
vi.mock("@0sfs/multiplayer/serverSession", () => ({ createServerSession: () => ({
  join: fake.serverJoin, host: fake.serverHost, invite: vi.fn(), disconnect: vi.fn(), dispose: vi.fn(), update: vi.fn(),
  replaceIdleSettings: vi.fn(), setSharedSettings: vi.fn(), render: () => ({ aircraft: [] }),
  snapshot: () => ({ status: "idle", role: null, message: "Off", invitationUrl: null, diagnostics: null,
    sharedSettings: { damageImplementation: "health-v1", settingsEditors: "host" }, sharedSettingsReady: true,
    sharedSettingsPending: false, sharedSettingsError: null, held: false, stale: false, receiveToPresentMs: null }),
}) }));
afterEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); });
const base = `https://example.test/fly/#mp=1&v=1&peer=host&join=${"a".repeat(43)}`;

it("passes the invitation's selected destination to the guest spawn handler", async () => {
  const location = { latDeg: 45, lonDeg: -93, altMeters: 500 };
  const href = withInvitationStart(base, { aircraftId: "f-35b", location });
  const spawn = vi.fn(), prepareJoin = vi.fn(() => true);
  const feature = createMultiplayerFeature({ scene: { onBeforeRenderObservable: { add: vi.fn(), remove: vi.fn() } } as unknown as Scene,
    getLocal: vi.fn(), getRenderFrame: () => null, requestRender: vi.fn(), onSpawn: spawn, prepareJoin,
    baseUrl: "https://example.test/fly/", invitation: href });
  const host = document.createElement("div"); document.body.append(host); feature.mount(host);
  [...host.querySelectorAll("button")].find(button => button.textContent === "Join flight")!.click();
  await vi.waitFor(() => expect(fake.join).toHaveBeenCalledWith(href));
  expect(prepareJoin).toHaveBeenCalledWith(href, { aircraftId: "f-35b", location });
  const pose = { latDeg: 0, lonDeg: 0 } as AircraftPose;
  fake.onSpawn(pose);
  expect(spawn).toHaveBeenCalledWith(pose, location);
  feature.dispose();
});

it("waits for an aircraft startup change before connecting", async () => {
  const feature = createMultiplayerFeature({ scene: { onBeforeRenderObservable: { add: vi.fn(), remove: vi.fn() } } as unknown as Scene,
    getLocal: vi.fn(), getRenderFrame: () => null, requestRender: vi.fn(), onSpawn: vi.fn(), prepareJoin: () => false,
    baseUrl: "https://example.test/fly/", invitation: base });
  const host = document.createElement("div"); document.body.append(host); feature.mount(host);
  [...host.querySelectorAll("button")].find(button => button.textContent === "Join flight")!.click();
  await Promise.resolve(); await Promise.resolve();
  expect(fake.join).not.toHaveBeenCalled();
  feature.dispose();
});

it("joins a flight server from its invitation", async () => {
  const href = `https://example.test/fly/#mp=1&v=1&server=${encodeURIComponent("https://127.0.0.1:4433/flight")}&session=${"b".repeat(22)}&join=${"c".repeat(43)}`;
  const feature = createMultiplayerFeature({ scene: { onBeforeRenderObservable: { add: vi.fn(), remove: vi.fn() } } as unknown as Scene,
    getLocal: vi.fn(), getRenderFrame: () => null, requestRender: vi.fn(), onSpawn: vi.fn(),
    baseUrl: "https://example.test/fly/", invitation: href });
  const host = document.createElement("div"); document.body.append(host); feature.mount(host);
  [...host.querySelectorAll("button")].find(button => button.textContent === "Join flight")!.click();
  await vi.waitFor(() => expect(fake.serverJoin).toHaveBeenCalledWith(href));
  expect(fake.join).not.toHaveBeenCalled();
  feature.dispose();
});
