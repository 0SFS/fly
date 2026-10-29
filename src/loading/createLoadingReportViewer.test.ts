// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoadingReportViewer } from "./createLoadingReportViewer";

let viewer: ReturnType<typeof createLoadingReportViewer>;
const report = 'Error: Failed <img src=x onerror="alert(1)">\n0SFS report, 2026-10-28T00:00:00.000Z\nSettings: all at their defaults.\n';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  document.body.innerHTML = '<button id="opener">View report</button><main inert id="root"></main>';
  viewer = createLoadingReportViewer();
});

afterEach(() => {
  viewer?.destroy();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("loading report host", () => {
  it("hosts the shared report outside the inert app and treats the failure as text", () => {
    viewer.show(report);
    const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.closest("[inert]")).toBeNull();
    expect(dialog.querySelectorAll(".foss-earth-issue-report")).toHaveLength(1);
    expect([...dialog.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toContain("failure.txt");
    expect(dialog.querySelector("pre")?.textContent).toContain("failure.txt:1");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector('[aria-label="Download this file"]')).not.toBeNull();
    expect(dialog.querySelector('[download="error-report.zip"]')).not.toBeNull();
  });

  it("restores focus and updates the shared viewer when the dialog is reopened", () => {
    const opener = document.getElementById("opener")!;
    opener.focus();
    viewer.show(report);
    document.querySelector<HTMLButtonElement>('[aria-label="Close report"]')!.click();
    expect(document.activeElement).toBe(opener);
    viewer.show("Error: Retry failed\n0SFS report, 2026-10-28T00:00:00.000Z\nSettings: all at their defaults.\n");
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.querySelectorAll(".foss-earth-issue-report")).toHaveLength(1);
    expect(document.querySelector("pre")?.textContent).toContain("Error: Retry failed");
    expect(document.querySelector("pre")?.textContent).not.toContain("Failed <img");
    viewer.destroy();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
