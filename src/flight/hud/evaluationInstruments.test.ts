// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropertyBatch } from "@felipegalind0/jsbsim";
import { createEvaluationInstruments } from "./evaluationInstruments";
import type { FlightRecorderPropertyReader } from "@0sfs/logging/flightRecorder";

function reader(values: Record<string, number>): FlightRecorderPropertyReader {
  return {
    getPropertyValue: (property) => values[property] ?? 0,
    queryPropertyCatalog: (check) => {
      const hits = Object.keys(values).map((p) => p.replace(/\[0\]/g, "")).filter((p) => p.includes(check));
      return hits.length ? hits.map((p) => `${p} (R)`).join("\n") + "\n" : "No matches found\n";
    },
  };
}

const SF50 = {
  "simulation/sim-time-sec": 12,
  "propulsion/engine[0]/n1": 97.24,
  "aero/alpha-deg": 3.14,
  "fcs/stall-warning": 0,
  "fcs/stick-pusher": 0,
};

describe("evaluation instruments", () => {
  let root: HTMLElement;
  afterEach(() => {
    root?.remove();
  });
  const mount = () => {
    root = document.createElement("div");
    document.body.appendChild(root);
    return createEvaluationInstruments(root);
  };
  const text = (selector: string) => root.querySelector(selector)?.textContent?.trim();

  it("shows AoA and no N1, fuel-flow, or recorder UI", () => {
    const handle = mount();
    handle.update(reader(SF50));
    expect(text('[data-value="aoa"]')).toBe("3.1");
    // One space of room for the tens, and no more.
    expect(root.querySelector('[data-value="aoa"]')?.textContent).toBe(" 3.1");
    expect(handle.aoaDeg()).toBe(3.14);
    expect((root.querySelector('[data-readout="aoa"]') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('[data-readout="n1"]')).toBeNull();
    expect(root.querySelector('[data-readout="ff"]')).toBeNull();
    expect(root.querySelector(".flight-eval__recorder")).toBeNull();
    expect(root.querySelector(".flight-eval__cas")?.classList.contains("is-active")).toBe(false);
  });

  it("edits the AoA text in place and only when the shown value changes", () => {
    const handle = mount();
    handle.update(reader(SF50));
    const value = root.querySelector('[data-value="aoa"]')!;
    const node = value.firstChild;
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    handle.update(reader({ ...SF50, "aero/alpha-deg": 3.12 }));
    expect(observer.takeRecords()).toEqual([]);
    handle.update(reader({ ...SF50, "aero/alpha-deg": -12.5 }));
    expect(observer.takeRecords().map((record) => record.type)).toEqual(["characterData"]);
    expect(value.firstChild).toBe(node);
    expect(value.textContent).toBe("-12.5");
    observer.disconnect();
  });

  it("hides AoA and never shows a CAS warning on an aircraft without them", () => {
    const handle = mount();
    handle.update(reader({ "propulsion/engine[0]/n1": 40 }));
    expect((root.querySelector('[data-readout="aoa"]') as HTMLElement).hidden).toBe(true);
    expect(handle.aoaDeg()).toBeNull();
    expect(text(".flight-eval__cas")).toBe("");
  });

  it("places AoA in the left tape row when a HUD slot exists", () => {
    root = document.createElement("div");
    root.innerHTML = `<div class="flight-hud"><div class="flight-hud__eval"></div><div class="flight-hud__aoa"></div></div>`;
    document.body.appendChild(root);
    const handle = createEvaluationInstruments(root.querySelector(".flight-hud__eval")!);
    handle.update(reader(SF50));
    expect(root.querySelector(".flight-hud__aoa [data-readout='aoa']")).not.toBeNull();
    expect(root.querySelector(".flight-eval [data-readout='aoa']")).toBeNull();
    handle.destroy();
  });

  it("announces the stick pusher ahead of the stall warning", () => {
    const handle = mount();
    handle.update(reader({ ...SF50, "fcs/stall-warning": 1 }));
    expect(text(".flight-eval__cas")).toBe("STALL WARNING");
    handle.update(reader({ ...SF50, "fcs/stall-warning": 1, "fcs/stick-pusher": 1 }));
    expect(text(".flight-eval__cas")).toBe("STICK PUSHER");
    handle.update(reader(SF50));
    expect(root.querySelector(".flight-eval__cas")?.classList.contains("is-active")).toBe(false);
  });

  it("samples only the available readings in one batch, keeping live values and releasing a replaced reader", () => {
    const values = { ...SF50 };
    const batches: Array<{ paths: readonly string[]; disposed: boolean; read: ReturnType<typeof vi.fn> }> = [];
    const sdk = {
      ...reader(values),
      getPropertyValue: vi.fn((path: string) => values[path as keyof typeof values] ?? 0),
      createPropertyBatch: vi.fn((paths: readonly string[], options?: { create?: boolean }) => {
        expect(options).toEqual({ create: false });
        const batch = {
          paths, disposed: false, missing: [],
          read: vi.fn((target: Float64Array) => {
            if (batch.disposed) throw new Error("Model reloaded");
            paths.forEach((path, index) => { target[index] = values[path as keyof typeof values] ?? NaN; });
            return target;
          }),
          dispose() { batch.disposed = true; },
        };
        batches.push(batch);
        return batch as unknown as PropertyBatch;
      }),
    };
    const handle = mount();
    for (const [aoa, pusher, warning] of [[3.14, 0, 0], [-0, 0, 1], [15.5, 1, 1], [NaN, 0, 0]]) {
      values["aero/alpha-deg"] = aoa!;
      values["fcs/stick-pusher"] = pusher!;
      values["fcs/stall-warning"] = warning!;
      handle.update(sdk);
      expect(Object.is(handle.aoaDeg(), aoa)).toBe(true);
      expect(text(".flight-eval__cas")).toBe(pusher! > 0.5 ? "STICK PUSHER" : warning! > 0.5 ? "STALL WARNING" : "");
    }
    expect(sdk.getPropertyValue).not.toHaveBeenCalled();
    expect(sdk.createPropertyBatch).toHaveBeenCalledOnce();
    expect(batches[0]!.paths).toEqual(["aero/alpha-deg", "fcs/stick-pusher", "fcs/stall-warning"]);
    expect(batches[0]!.read).toHaveBeenCalledTimes(4);
    // The sampler resolves the SDK's new nodes after its old batch was disposed.
    batches[0]!.disposed = true;
    values["aero/alpha-deg"] = 7.2;
    handle.update(sdk);
    expect(sdk.createPropertyBatch).toHaveBeenCalledTimes(2);
    expect(handle.aoaDeg()).toBe(7.2);
    // A new reader has only AoA: no missing warning paths are sampled.
    const replacement = { ...sdk, queryPropertyCatalog: reader({ "aero/alpha-deg": 0 }).queryPropertyCatalog };
    handle.update(replacement);
    expect(batches[1]!.disposed).toBe(true);
    expect(batches[2]!.paths).toEqual(["aero/alpha-deg"]);
    handle.destroy();
    expect(batches[2]!.disposed).toBe(true);
  });

  it("removes its markup on destroy", () => {
    const handle = mount();
    handle.destroy();
    expect(root.querySelector(".flight-eval")).toBeNull();
  });
});
