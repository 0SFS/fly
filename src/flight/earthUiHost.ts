import {
  appendHostSections, checkChoice, createBrowserClipboard, createChoiceGroup, createChoiceNote,
  createDial, createHelpTooltip, createIconButton, createParameterControl, createParameterSection, createSectionsElement, createTrack, wrapTurn,
} from "@foss-earth/ui/browser";
import type { RendererPanelUiPort } from "@foss-earth/renderer/panel";
import type { SettingsRegistry, SettingsStorage } from "foss-earth/settings";

/**
 * The ports FOSS Earth's panels take from their host: the document, the panel
 * storage, a refresh after every drawn frame and settings change, the
 * clipboard and the shared controls. The flight's are the page's, as the
 * globe's own app gives them (FOSS Earth `app/src/app/uiHost.ts`).
 */
export type FlightSectionFactory = (
  registry: SettingsRegistry,
  options: Omit<Parameters<typeof createParameterSection>[1], "document" | "refresh" | "panelStorage">,
) => ReturnType<typeof createParameterSection>;

export interface FlightUiHost {
  document: Document;
  storage: SettingsStorage | null;
  refresh: { nowMs(): number; subscribe(listener: () => void): () => void };
  /** Tells the refresh's listeners: after each drawn frame and settings change (and once a second). */
  emit(): void;
  copy(text: string): Promise<void>;
  control: (registry: SettingsRegistry, id: string) => ReturnType<typeof createParameterControl>;
  /** A settings section in this document, refreshed after each drawn frame, settings change and second. */
  section: FlightSectionFactory;
  createTrack: typeof createTrack;
  /** The Renderer tab's factories, in this document. */
  renderer: RendererPanelUiPort;
  publicUi: {
    appendHostSections: typeof appendHostSections; checkChoice: typeof checkChoice;
    createChoiceGroup: typeof createChoiceGroup; createChoiceNote: typeof createChoiceNote;
    createParameterSection: typeof createParameterSection; createSectionsElement: typeof createSectionsElement;
    createDial: typeof createDial; wrapTurn: typeof wrapTurn;
    createHelpTooltip: typeof createHelpTooltip; createIconButton: typeof createIconButton;
  };
  dispose(): void;
}

export function createFlightUiHost(settings: SettingsRegistry, document: Document): FlightUiHost {
  const listeners = new Set<() => void>();
  let disposed = false;
  let storage: SettingsStorage | null;
  try { storage = document.defaultView?.localStorage ?? null; } catch { storage = null; }
  const emit = () => {
    if (!disposed) for (const listener of [...listeners]) listener();
  };
  const stopSettings = settings.subscribe(emit);
  // The old panels also ticked once a second, so readings, Sky and Time keep
  // moving while the flight is paused and draws no frames.
  const view = document.defaultView;
  const tick = view ? view.setInterval(emit, 1000) : null;
  const refresh: FlightUiHost["refresh"] = {
    nowMs: () => performance.now(),
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    document,
    storage,
    refresh,
    emit,
    copy: createBrowserClipboard(document, navigator),
    control: (registry, id) => createParameterControl(registry, id, document),
    section: (registry, options) => createParameterSection(registry, { ...options, document, refresh, panelStorage: storage }),
    createTrack,
    renderer: {
      document,
      isInput: (value): value is HTMLInputElement => value instanceof document.defaultView!.HTMLInputElement,
      createChoiceGroup: (name, heading, choices, options) => createChoiceGroup(name, heading, choices, document, options),
      createHelpTooltip,
      createChoiceNote: text => createChoiceNote(text, document),
      checkChoice,
      createParameterSection: (registry, options) => createParameterSection(registry, { ...options, document, refresh, panelStorage: storage }),
      createSectionsElement: entries => createSectionsElement(entries, { document, storage }),
      appendHostSections: (registry, tab, target, own) => appendHostSections(registry, tab, target, own, { document, refresh, panelStorage: storage }),
    },
    publicUi: { appendHostSections, checkChoice, createChoiceGroup, createChoiceNote, createParameterSection, createSectionsElement, createDial, wrapTurn, createHelpTooltip, createIconButton },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopSettings();
      if (tick !== null) view?.clearInterval(tick);
      listeners.clear();
    },
  };
}
