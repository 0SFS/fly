// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createMultiplayerInvitation } from "./createMultiplayerInvitation";
import { readInvitationStart } from "./invitationStart";

const qr = vi.hoisted(() => ({ toCanvas: vi.fn() }));
vi.mock("qrcode", () => ({ default: qr }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, "clipboard"); qr.toCanvas.mockReset(); document.body.replaceChildren(); });
const url = `https://example.test/fly/#flight=${"test-invitation-".repeat(20)}`;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("multiplayer invitation", () => {
  it("updates the full link and QR together when optional start settings change", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    qr.toCanvas.mockResolvedValue(undefined);
    let view!: ReturnType<typeof createMultiplayerInvitation>;
    await act(async () => {
      view = createMultiplayerInvitation({ aircraftId: "f-35b", initialLocation: { latDeg: 45, lonDeg: -93 } });
      document.body.append(view.element); view.update(url);
    });
    const enable = async (heading: string) => {
      await act(async () => view.element.querySelector<HTMLInputElement>(`[aria-label="${heading}"] input[value="on"]`)!.click());
    };
    await enable("Set aircraft"); await enable("Set location");
    const href = view.element.querySelector("a")!.href;
    expect(readInvitationStart(href)).toEqual({ aircraftId: "f-35b", location: { latDeg: 45, lonDeg: -93 } });
    expect(qr.toCanvas.mock.calls.at(-1)![1]).toBe(href);
    expect(view.element.querySelector("a")!.textContent).toBe(href);
    await act(async () => view.dispose());
  });

  it("shares gkey only after opting in, in both the link and QR", async () => {
    qr.toCanvas.mockResolvedValue(undefined);
    const view = createMultiplayerInvitation();
    const key = "synthetic+/&=?key";
    view.update(url, key); await settle();
    const toggle = view.element.querySelector<HTMLButtonElement>('[aria-pressed]')!;
    const link = view.element.querySelector("a")!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(new URL(link.href).searchParams.has("gkey")).toBe(false);
    toggle.click(); await settle();
    expect(new URL(link.href).searchParams.get("gkey")).toBe(key);
    expect(new URL(link.href).hash).toBe(new URL(url).hash);
    expect(qr.toCanvas.mock.calls.at(-1)![1]).toBe(link.href);
    expect(link.textContent).toBe(link.href);
    toggle.click(); await settle();
    expect(link.href).toBe(url);
    expect(qr.toCanvas.mock.calls.at(-1)![1]).toBe(url);
    view.update(url, null);
    expect(toggle.hidden).toBe(true);
    view.update(url, key);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    view.dispose();
  });

  it("shows and copies the complete URL and encodes that same URL once", async () => {
    qr.toCanvas.mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = createMultiplayerInvitation(); document.body.append(view.element);
    view.update(url); await settle(); view.update(url);
    expect(view.element.hidden).toBe(false);
    const link = view.element.querySelector("a")!;
    expect(link.textContent).toBe(url); expect(link.href).toBe(url);
    expect(qr.toCanvas).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLCanvasElement), url, { width: 280, margin: 3, errorCorrectionLevel: "M" });
    expect(view.element.querySelector("canvas")!.hidden).toBe(false);
    view.element.querySelector("button")!.click(); await settle();
    expect(writeText).toHaveBeenCalledWith(url);
    expect(view.element.querySelector("button")!.textContent).toBe("Copied");
    view.dispose();
  });

  it("ignores late QR renders when renewed, expired or disposed", async () => {
    const complete: (() => void)[] = [];
    qr.toCanvas.mockImplementation(() => new Promise<void>(resolve => complete.push(resolve)));
    const view = createMultiplayerInvitation(); document.body.append(view.element);
    view.update(url); view.update(`${url}-new`);
    complete[0](); await settle();
    expect(view.element.querySelector("canvas")!.hidden).toBe(true);
    complete[1](); await settle();
    expect(view.element.querySelector("canvas")!.hidden).toBe(false);
    view.update(`${url}-expired`); view.update(null); complete[2](); await settle();
    expect(view.element.hidden).toBe(true);
    expect(view.element.querySelector("canvas")!.hidden).toBe(true);
    view.update(url); view.dispose(); complete[3](); await settle();
    expect(view.element.isConnected).toBe(false);
    expect(view.element.querySelector("canvas")!.hidden).toBe(true);
  });

  it("keeps the link available if QR rendering or clipboard access fails", async () => {
    qr.toCanvas.mockRejectedValue(new Error("canvas unavailable"));
    const view = createMultiplayerInvitation(); view.update(url); await settle();
    expect(view.element.querySelector("a")!.textContent).toBe(url);
    expect(view.element.querySelector('[role="status"]')!.textContent).toContain("QR unavailable");
    view.element.querySelector("button")!.click();
    expect(view.element.querySelector('[role="status"]')!.textContent).toContain("Select the invitation");
    view.dispose();
  });
});
