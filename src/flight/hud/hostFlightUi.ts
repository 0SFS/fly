import { controlTakesEveryKey } from "@felipegalind0/gamepad-tools/browser";

export interface HostFlightUiOptions {
  /** A phone is paired and its link is open. */
  isConnected(): boolean;
  /** The paired phone has stopped answering. */
  isPhoneQuiet(): boolean;
  /** Remote Control → Shared controls → Flight UI on this computer while a phone is connected. */
  isShownWithPhone(): boolean;
  /** The flight UI is to be hidden or shown, or a phone has come or gone. */
  onChange(hidden: boolean): void;
}

/** Keys that are only ever half of a shortcut. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "FnLock", "Hyper", "Super", "OS"]);

/**
 * Whether this computer's flight UI is hidden while a phone is paired. By
 * default it is, so the phone has the instruments and controls and this screen
 * the view, the toolbar and the windows. It comes back while the phone stops
 * answering, and once a key is pressed here, since the pilot is then at this
 * keyboard; from a key it stays until the phone is touched again.
 */
export function createHostFlightUi(options: HostFlightUiOptions) {
  let connected = false;
  let hidden = false;
  let keyboard = false;
  const sync = (): void => {
    const linked = options.isConnected();
    // A phone that pairs again has the screen to itself, as any new phone does.
    if (!linked) keyboard = false;
    const next = linked && !options.isShownWithPhone() && !options.isPhoneQuiet() && !keyboard;
    if (linked === connected && next === hidden) return;
    connected = linked;
    hidden = next;
    options.onChange(hidden);
  };
  return {
    sync,
    /**
     * A key pressed on this computer. Not one typed into a text field or
     * answering an open dialog, a modifier on its own, or a browser or system
     * shortcut: none of those is flying from here.
     */
    noteKey(event: KeyboardEvent): void {
      if (keyboard || !connected || options.isShownWithPhone()) return;
      if (MODIFIER_KEYS.has(event.key) || event.metaKey || event.ctrlKey || controlTakesEveryKey(event.target)
        || (event.target as Element | null)?.closest?.("dialog[open]")) return;
      keyboard = true;
      sync();
    },
    /** The pilot touched the phone, which has the screen to itself again. */
    notePhoneInput(): void {
      if (!keyboard) return;
      keyboard = false;
      sync();
    },
    /** The setting was changed here: the choice stands as made, whatever a key did before. */
    noteSettingChanged(): void {
      keyboard = false;
      sync();
    },
  };
}
export type HostFlightUi = ReturnType<typeof createHostFlightUi>;
