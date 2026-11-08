// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSettingsRegistry } from "foss-earth/settings";
import { flightParameterStore, OSFS_PARAMETERS } from "../settings/flightParameters";
import { HUD_BACKDROP_ID, watchHudBackdrop } from "./hudBackdrop";

const FLAT = '[data-hud-backdrop="flat"]';

function store() {
  const registry = createSettingsRegistry({ storage: null });
  registry.register(OSFS_PARAMETERS);
  return { registry, parameters: flightParameterStore(registry) };
}

/** Each rule's selector list and declarations, comments removed; nested rules are read one by one. */
function cssRules(text: string): { selectors: string[]; body: string }[] {
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: splitSelectors(selector.trim()), body }));
}

/** A selector list split at its own commas, not those inside :where() or :is(). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) { out.push(list.slice(start, i).trim()); start = i + 1; }
  }
  out.push(list.slice(start).trim());
  return out;
}

describe("Backgrounds over the view", () => {
  it("defaults to Flat and marks the flight's root", () => {
    const { registry, parameters } = store();
    const spec = registry.inspect(HUD_BACKDROP_ID).spec;
    expect(spec.default).toBe("flat");
    expect(spec.home).toEqual({ tab: "interface", section: "hud", level: "main" });
    expect(registry.get(HUD_BACKDROP_ID)).toBe("flat");
    const root = document.createElement("div");
    const stop = watchHudBackdrop(parameters, root);
    expect(root.getAttribute("data-hud-backdrop")).toBe("flat");
    stop();
  });

  it("leaves the flight's root unmarked while Blurred", () => {
    const { registry, parameters } = store();
    registry.set(HUD_BACKDROP_ID, "blurred");
    const root = document.createElement("div");
    watchHudBackdrop(parameters, root)();
    expect(root.hasAttribute("data-hud-backdrop")).toBe(false);
    expect(root.attributes.length).toBe(0);
  });

  it("marks the root while Flat, live, and stops with its watch", () => {
    const { registry, parameters } = store();
    registry.set(HUD_BACKDROP_ID, "blurred");
    const root = document.createElement("div");
    const stop = watchHudBackdrop(parameters, root);
    expect(root.hasAttribute("data-hud-backdrop")).toBe(false);
    expect(registry.set(HUD_BACKDROP_ID, "flat")).toEqual({ ok: true });
    expect(root.getAttribute("data-hud-backdrop")).toBe("flat");
    expect(registry.set(HUD_BACKDROP_ID, "blurred")).toEqual({ ok: true });
    expect(root.hasAttribute("data-hud-backdrop")).toBe(false);
    registry.reset(HUD_BACKDROP_ID);
    expect(root.getAttribute("data-hud-backdrop")).toBe("flat");
    registry.set(HUD_BACKDROP_ID, "blurred");
    stop();
    registry.set(HUD_BACKDROP_ID, "flat");
    expect(root.hasAttribute("data-hud-backdrop")).toBe(false);
  });

  it("starts marked when Flat was chosen before the flight", () => {
    const { registry, parameters } = store();
    registry.set(HUD_BACKDROP_ID, "flat");
    const root = document.createElement("div");
    watchHudBackdrop(parameters, root)();
    expect(root.getAttribute("data-hud-backdrop")).toBe("flat");
  });

  it("styles nothing differently while Blurred: every rule that names the setting needs Flat on each selector", () => {
    const rules = cssRules(readFileSync("src/styles/flight.css", "utf8"));
    const flat = rules.filter(rule => rule.selectors.some(selector => selector.includes("data-hud-backdrop")));
    expect(flat.length).toBe(5);
    for (const rule of flat) for (const selector of rule.selectors) expect(selector).toContain(`.flight-app${FLAT}`);
    // Blurred keeps today's blurs: the toolbar's load, gear and autopilot, and the status card.
    const blurs = rules.filter(rule => /backdrop-filter:\s*blur\(/.test(rule.body)).map(rule => rule.selectors.join(", "));
    expect(blurs).toEqual([
      ".flight-toolbar-instruments :where(.flight-hud__tape, .flight-hud__gear, .flight-hud__ap)",
      ".flight-status-overlay__card",
    ]);
    // Flat takes each of them off.
    const nones = flat.filter(rule => /backdrop-filter:\s*none/.test(rule.body)).map(rule => rule.selectors.join(", "));
    expect(nones).toEqual([
      `.flight-app${FLAT} .flight-toolbar-instruments :where(.flight-hud__tape, .flight-hud__gear, .flight-hud__ap)`,
      `.flight-app${FLAT} .flight-status-overlay__card`,
    ]);
  });
});
