// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InvitationStartControls } from "./InvitationStartControls";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it("keeps both editors optional and uses the Location tab's Go action for the guest destination", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  await act(async () => root.render(<InvitationStartControls aircraftId="cessna-172" initialLocation={{ latDeg: 45, lonDeg: -93 }} onChange={change} />));
  const choose = async (heading: string, value: string) => {
    const group = host.querySelector(`[role="radiogroup"][aria-label="${heading}"]`)!;
    const input = group.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    await act(async () => input.click());
  };
  expect(host.querySelector('[aria-label="Invited aircraft"]')).toBeNull();
  expect(host.querySelector('[aria-label="Latitude"]')).toBeNull();
  expect(change).not.toHaveBeenCalled();
  await choose("Set aircraft", "on");
  expect(change).toHaveBeenLastCalledWith({ aircraftId: "cessna-172" });
  expect(host.querySelector('[aria-label="Invited aircraft"]')).not.toBeNull();
  await choose("Set location", "on");
  const latitude = host.querySelector<HTMLInputElement>('[aria-label="Latitude"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(latitude, "46");
    latitude.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Go to location"]')!.click());
  expect(change).toHaveBeenLastCalledWith({ aircraftId: "cessna-172", location: expect.objectContaining({ latDeg: 46, lonDeg: -93 }) });
  await choose("Set aircraft", "off");
  expect(change.mock.calls.at(-1)![0].aircraftId).toBeUndefined();
  await choose("Set location", "off");
  expect(change).toHaveBeenLastCalledWith({});
  expect(host.querySelector('[aria-label="Latitude"]')).toBeNull();
  await act(async () => root.unmount());
});
