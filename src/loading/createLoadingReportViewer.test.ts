// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoadingReportViewer } from "./createLoadingReportViewer";

let viewer: ReturnType<typeof createLoadingReportViewer>;
const createUrl = vi.fn<(blob: Blob) => string>(() => "blob:loading-report");
const revokeUrl = vi.fn();
const copyText = vi.fn<(text: string) => Promise<void>>();
const report = JSON.stringify({ version: 2, failure: '<img src=x onerror="alert(1)">', cause: { message: 'Failed "module"\nNext line', stack: null }, elapsedMs: -1.5e10, offline: false }, null, 2);

beforeEach(() => {
  vi.clearAllMocks();
  copyText.mockResolvedValue(undefined);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copyText } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  document.body.innerHTML = '<button id="opener">View report</button><main inert id="root"></main>';
  viewer = createLoadingReportViewer();
});

afterEach(() => {
  viewer?.destroy();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  document.body.replaceChildren();
});

describe("loading report viewer", () => {
  it("shows lossless highlighted JSON outside the inert app, without interpreting HTML", () => {
    viewer.show(report);
    const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.closest("[inert]")).toBeNull();
    expect(dialog.querySelector("code")?.textContent).toBe(report);
    expect(dialog.querySelector("img")).toBeNull();
    for (const kind of ["key", "string", "number", "literal"]) expect(dialog.querySelector(`.osfs-loading-report__${kind}`)).not.toBeNull();
    expect([...dialog.querySelectorAll(".osfs-loading-report__actions > *")].map(control => control.getAttribute("aria-label"))).toEqual(["Copy report", "Download report"]);
  });

  it("copies and downloads exactly the visible snapshot", async () => {
    viewer.show(report);
    document.querySelector<HTMLButtonElement>('[aria-label="Copy report"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe("Copied."));
    expect(copyText).toHaveBeenCalledExactlyOnceWith(report);
    const link = document.querySelector<HTMLAnchorElement>('[aria-label="Download report"]')!;
    expect(link.href).toBe("blob:loading-report");
    expect(link.download).toBe("osfs-loading-report.json");
    const blob = createUrl.mock.calls[0][0];
    expect(blob.type).toBe("application/json;charset=utf-8");
    const text = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
    expect(text).toBe(report);
  });

  it("selects the report when clipboard permission is denied and leaves download available", async () => {
    copyText.mockRejectedValueOnce(new Error("Denied"));
    viewer.show(report);
    document.querySelector<HTMLButtonElement>('[aria-label="Copy report"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain("Clipboard unavailable"));
    expect(document.getSelection()?.toString()).toBe(report);
    expect(document.querySelector<HTMLAnchorElement>('[aria-label="Download report"]')!.href).toBe("blob:loading-report");
  });

  it("restores focus, releases downloads and reuses one dialog when reopened", () => {
    const opener = document.getElementById("opener")!;
    opener.focus();
    viewer.show(report);
    document.querySelector<HTMLButtonElement>('[aria-label="Close report"]')!.click();
    expect(document.activeElement).toBe(opener);
    expect(revokeUrl).toHaveBeenCalledWith("blob:loading-report");
    viewer.show('{"retry":true}');
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelector("code")?.textContent).toBe('{"retry":true}');
    viewer.destroy();
    expect(document.querySelector("dialog")).toBeNull();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });
});
