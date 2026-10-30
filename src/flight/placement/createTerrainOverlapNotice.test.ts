// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerrainOverlapNotice } from "./createTerrainOverlapNotice";

afterEach(() => { document.body.replaceChildren(); });

describe("terrain overlap notice", () => {
  it("shows a nonmodal explanation without locking or focusing the interface", () => {
    const controls = document.createElement("button");
    document.body.append(controls);
    controls.focus();
    const notice = createTerrainOverlapNotice(document);
    const card = document.querySelector<HTMLElement>(".flight-terrain-overlap")!;
    expect(card.hidden).toBe(true);
    notice.update({ message: "The downloaded surface is above this position.", onResume: vi.fn() });
    expect(card.hidden).toBe(false);
    expect(card.textContent).toContain("map detail loads");
    expect(card.textContent).toContain("below the current surface");
    expect(card.querySelector('[role="status"]')?.textContent).toContain("above this position");
    expect(card.hasAttribute("aria-modal")).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(controls);
    notice.update(null);
    expect(card.hidden).toBe(true);
    notice.dispose();
  });

  it("offers teleport only when ground is known and uses current action callbacks", () => {
    const notice = createTerrainOverlapNotice(document);
    const card = document.querySelector<HTMLElement>(".flight-terrain-overlap")!;
    const [resume, teleport] = card.querySelectorAll<HTMLButtonElement>("button");
    const firstResume = vi.fn(), nextResume = vi.fn(), onTeleport = vi.fn();
    notice.update({ message: "Waiting for terrain", onResume: firstResume });
    expect(teleport.hidden).toBe(true);
    resume.click();
    expect(firstResume).toHaveBeenCalledOnce();
    notice.update({ message: "Ground available", onResume: nextResume, onTeleport });
    expect(teleport.hidden).toBe(false);
    resume.click();
    teleport.click();
    expect(nextResume).toHaveBeenCalledOnce();
    expect(onTeleport).toHaveBeenCalledOnce();
    notice.update({ message: "Ground unknown again", onResume: nextResume });
    expect(teleport.hidden).toBe(true);
    teleport.click();
    expect(onTeleport).toHaveBeenCalledOnce();
    notice.dispose();
    expect(card.isConnected).toBe(false);
    notice.update({ message: "Stale update", onResume: nextResume });
    resume.click();
    expect(nextResume).toHaveBeenCalledOnce();
  });

  it("collapses to a status and recovery move once the pilot chose to fly on, and expands for a new question", () => {
    const notice = createTerrainOverlapNotice(document);
    const card = document.querySelector<HTMLElement>(".flight-terrain-overlap")!;
    const [resume, teleport] = card.querySelectorAll<HTMLButtonElement>("button");
    const title = card.querySelector("h2")!;
    notice.update({ message: "Inside the surface", compact: true, onResume: vi.fn(), onTeleport: vi.fn() });
    expect(card.classList.contains("flight-terrain-overlap--compact")).toBe(true);
    expect([title.hidden, resume.hidden, teleport.hidden]).toEqual([true, true, false]);
    notice.update({ message: "A new proposal", onResume: vi.fn() });
    expect(card.classList.contains("flight-terrain-overlap--compact")).toBe(false);
    expect([title.hidden, resume.hidden, teleport.hidden]).toEqual([false, false, true]);
    notice.dispose();
  });

  it("preserves button focus through updates and blocks camera gestures only within the card", () => {
    const notice = createTerrainOverlapNotice(document);
    const card = document.querySelector<HTMLElement>(".flight-terrain-overlap")!;
    const resume = card.querySelector<HTMLButtonElement>("button")!;
    const camera = vi.fn();
    document.body.addEventListener("pointerdown", camera);
    notice.update({ message: "First surface", onResume() {} });
    resume.focus();
    notice.update({ message: "Refined surface", onResume() {} });
    expect(document.activeElement).toBe(resume);
    resume.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(camera).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(camera).toHaveBeenCalledOnce();
    document.body.removeEventListener("pointerdown", camera);
    notice.dispose();
  });
});
