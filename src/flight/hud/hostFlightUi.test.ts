// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createHostFlightUi } from "./hostFlightUi";

function setup() {
  const phone = { connected: false, quiet: false };
  const setting = { shown: false };
  const onChange = vi.fn();
  const ui = createHostFlightUi({
    isConnected: () => phone.connected,
    isPhoneQuiet: () => phone.quiet,
    isShownWithPhone: () => setting.shown,
    onChange,
  });
  const key = (init: KeyboardEventInit & { target?: EventTarget } = {}) => {
    const event = new KeyboardEvent("keydown", { key: "w", ...init });
    if (init.target) Object.defineProperty(event, "target", { value: init.target });
    ui.noteKey(event);
  };
  const hidden = () => onChange.mock.lastCall?.[0] as boolean | undefined;
  return { phone, setting, onChange, ui, key, hidden };
}

describe("the flight UI on this computer while a phone is paired", () => {
  it("is hidden while a phone is connected, and back when it goes", () => {
    const h = setup();
    h.ui.sync();
    expect(h.onChange).not.toHaveBeenCalled();
    h.phone.connected = true;
    h.ui.sync();
    expect(h.hidden()).toBe(true);
    h.phone.connected = false;
    h.ui.sync();
    expect(h.hidden()).toBe(false);
  });

  it("comes back while the phone stops answering, and goes when it answers again", () => {
    const h = setup();
    h.phone.connected = true;
    h.ui.sync();
    h.phone.quiet = true;
    h.ui.sync();
    expect(h.hidden()).toBe(false);
    h.phone.quiet = false;
    h.ui.sync();
    expect(h.hidden()).toBe(true);
  });

  it("comes back for a key pressed here, and stays until the phone is touched", () => {
    const h = setup();
    h.phone.connected = true;
    h.ui.sync();
    h.key();
    expect(h.hidden()).toBe(false);
    // The phone answering again is not the pilot coming back to it.
    h.phone.quiet = true;
    h.ui.sync();
    h.phone.quiet = false;
    h.ui.sync();
    expect(h.hidden()).toBe(false);
    h.ui.notePhoneInput();
    expect(h.hidden()).toBe(true);
    expect(h.onChange).toHaveBeenCalledTimes(3);
  });

  it("is not brought back by typing, a dialog's keys, a modifier alone, or a shortcut", () => {
    const h = setup();
    h.phone.connected = true;
    h.ui.sync();
    const field = document.createElement("input");
    h.key({ target: field });
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const choice = dialog.appendChild(document.createElement("button"));
    h.key({ key: "Escape", target: choice });
    h.key({ key: "Shift" });
    h.key({ key: "Meta" });
    h.key({ key: "r", metaKey: true });
    h.key({ key: "Tab", ctrlKey: true });
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.hidden()).toBe(true);
    // A slider here takes the arrows, but it is still this keyboard.
    const slider = Object.assign(document.createElement("input"), { type: "range" });
    h.key({ key: "ArrowUp", target: slider });
    expect(h.hidden()).toBe(false);
  });

  it("does not carry a key over to the next phone, or past the setting changed", () => {
    const h = setup();
    // A key before any phone is just a key.
    h.key();
    h.phone.connected = true;
    h.ui.sync();
    expect(h.hidden()).toBe(true);
    h.key();
    expect(h.hidden()).toBe(false);
    h.phone.connected = false;
    h.ui.sync();
    h.phone.connected = true;
    h.ui.sync();
    expect(h.hidden()).toBe(true);
    h.key();
    h.setting.shown = true;
    h.ui.noteSettingChanged();
    expect(h.hidden()).toBe(false);
    h.setting.shown = false;
    h.ui.noteSettingChanged();
    expect(h.hidden()).toBe(true);
  });
});
