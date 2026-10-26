// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SharedSettingsPanel, type SharedSettingsPanelState } from "./SharedSettingsPanel";

it("keeps host-only controls locked, permits granted requests, and shows pending changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onChange = vi.fn();
  const state: SharedSettingsPanelState = {
    values: { damageImplementation: "health-v1", settingsEditors: "host" },
    role: "guest", ready: true, pending: false, error: null,
  };
  const render = async () => act(async () => root.render(<SharedSettingsPanel state={state} onChange={onChange} />));
  const input = (value: string) => host.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
  try {
    await render();
    expect(input("off-v1").disabled).toBe(true);
    await act(async () => input("off-v1").click()); expect(onChange).not.toHaveBeenCalled();
    state.values.settingsEditors = "everyone"; await render();
    expect(input("off-v1").disabled).toBe(false);
    expect(input("host").disabled).toBe(true);
    await act(async () => input("off-v1").click());
    expect(onChange).toHaveBeenLastCalledWith({ damageImplementation: "off-v1" });
    // The accepted selection is still Health until the host replies.
    expect(input("health-v1").checked).toBe(true);
    state.pending = true; await render();
    expect(input("off-v1").disabled).toBe(true); expect(host.textContent).toContain("Waiting for the host");
    state.pending = false; state.role = "host"; await render();
    expect(input("host").disabled).toBe(false);
    await act(async () => input("host").click()); expect(onChange).toHaveBeenLastCalledWith({ settingsEditors: "host" });
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
