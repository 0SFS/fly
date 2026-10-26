import { createRoot } from "react-dom/client";
import type { WindowOverlayHandle } from "foss-earth/shell";
import {
  FlightControlPanel,
  type FlightControlPanelHandle,
  type FlightControlPanelOptions,
  type FlightControlPanelSnapshot,
  type FlightPanelTab,
  type FlightOverlayTab,
} from "./FlightControlPanel";

export function createFlightControlPanel(
  container: HTMLElement,
  initialSnapshot: FlightControlPanelSnapshot,
  options: FlightControlPanelOptions,
): FlightControlPanelHandle {
  const overlayHost = document.createElement("div");
  overlayHost.className = "flight-window-overlay-host";
  container.append(overlayHost);
  const root = createRoot(overlayHost);
  let snapshot = initialSnapshot;
  let testFeedbackTab = options.testFeedbackTab;
  let overlayApi: WindowOverlayHandle<FlightPanelTab> | null = null;
  let pendingTab: FlightOverlayTab | null = null;
  const overlayApiRef: { current: WindowOverlayHandle<FlightPanelTab> | null } = {
    get current() { return overlayApi; },
    set current(value) {
      overlayApi = value;
      if (value && pendingTab) queueMicrotask(() => {
        if (!overlayApi || !pendingTab) return;
        const tab = pendingTab;
        pendingTab = null;
        overlayApi.openOrSelectTab(tab);
      });
    },
  };

  const render = () => root.render(
    <FlightControlPanel {...options} testFeedbackTab={testFeedbackTab} snapshot={snapshot} overlayApiRef={overlayApiRef} />,
  );
  render();

  return {
    setTestFeedbackTab(element): void {
      if (testFeedbackTab === element) return;
      // Close its workspace entry before unregistering the content, so the
      // retiring built-in tab is never rendered as an additional flight tab.
      if (!element) overlayApiRef.current?.closeTab("test-feedback");
      testFeedbackTab = element;
      render();
    },
    update(nextSnapshot): void {
      snapshot = nextSnapshot;
      render();
    },
    openOrSelectTab(tabId): void {
      if (overlayApi) overlayApi.openOrSelectTab(tabId);
      else pendingTab = tabId;
    },
    toggleTab(tabId): void {
      overlayApiRef.current?.toggleTab(tabId);
    },
    destroy(): void {
      pendingTab = null;
      root.unmount();
      overlayHost.remove();
    },
  };
}
