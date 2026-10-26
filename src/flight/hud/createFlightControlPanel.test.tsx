// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlightControlPanelOptions, FlightControlPanelSnapshot } from "./FlightControlPanel";
import { createFlightControlPanel } from "./createFlightControlPanel";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./FlightControlPanel", () => ({
  FlightControlPanel: ({ overlayApiRef }: { overlayApiRef: { current: unknown } }) => {
    useLayoutEffect(() => {
      overlayApiRef.current = { openOrSelectTab: mocks.open };
      return () => { overlayApiRef.current = null; };
    });
    return null;
  },
}));
afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });
describe("flight panel startup navigation", () => {
  it("opens an invitation's tab when React commits after the request", async () => {
    const container = document.createElement("div"); document.body.append(container);
    let panel!: ReturnType<typeof createFlightControlPanel>;
    await act(async () => {
      panel = createFlightControlPanel(container, {} as FlightControlPanelSnapshot, {} as FlightControlPanelOptions);
      panel.openOrSelectTab("multiplayer");
    });
    expect(mocks.open).toHaveBeenCalledWith("multiplayer");
    await act(async () => panel.destroy());
  });
});
