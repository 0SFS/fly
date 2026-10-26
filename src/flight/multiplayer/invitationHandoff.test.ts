import { describe, expect, it, vi } from "vitest";
import { captureMultiplayerInvitation } from "./invitationHandoff";

describe("multiplayer invitation handoff", () => {
  it("scrubs even an invalid multiplayer fragment before lazy loading", () => {
    const href = "https://example.test/fly/#mp=1&join=secret";
    const replaceState = vi.fn();
    expect(captureMultiplayerInvitation({ href }, { state: null, replaceState })).toBe(href);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://example.test/fly/");
  });
  it("preserves other app fragments", () => {
    const replaceState = vi.fn();
    expect(captureMultiplayerInvitation({ href: "https://example.test/fly/#test=checklist" }, { state: null, replaceState })).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
