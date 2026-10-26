import { describe, expect, it, vi } from "vitest";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { createControlPositionReader } from "./controlPositions";
import { getFdmProfile } from "./jsbsim/fdmProfiles";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";

function fixture(aircraft: AircraftId, positions: Record<string, number>) {
  const values = new Map(Object.entries(positions));
  const read = vi.fn();
  const dispose = vi.fn();
  const getPropertyValue = vi.fn(() => 1);
  const createPropertyBatch = vi.fn((paths: readonly string[]) => {
    read.mockImplementation((target: Float64Array) => {
      paths.forEach((path, index) => { target[index] = values.get(path) ?? NaN; });
      return target;
    });
    return { read, dispose, missing: paths.filter(path => !values.has(path)) };
  });
  const sdk = { createPropertyBatch, getPropertyValue } as unknown as JSBSimSdk;
  const reader = createControlPositionReader(sdk, getFdmProfile(aircraft));
  return { reader, values, read, dispose, createPropertyBatch, getPropertyValue };
}

describe("actual control positions", () => {
  it("reads measured positions rather than commands, normalizing the C172's degrees and yaw sign", () => {
    const h = fixture("cessna-172", {
      "fcs/throttle-pos-norm": .35, "fcs/flap-pos-deg": 15, "fcs/rudder-pos-norm": -.4,
      "fcs/throttle-cmd-norm": .9, "fcs/flap-cmd-norm": 1, "fcs/rudder-cmd-norm": -1,
      "fcs/pitch-trim-cmd-norm": .3, "fcs/roll-trim-cmd-norm": -.1,
    });
    expect(h.reader.read()).toEqual({ throttle: .35, flaps: .5, rudder: .4 });
    expect(h.createPropertyBatch).toHaveBeenCalledWith([
      "fcs/throttle-pos-norm", "fcs/flap-pos-deg", "fcs/rudder-pos-norm",
    ], { create: false });
    expect(h.getPropertyValue).not.toHaveBeenCalled();
    h.values.set("fcs/flap-pos-deg", 21);
    expect(h.reader.read().flaps).toBe(.7);
    h.reader.dispose();
    h.reader.dispose();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.reader.read()).toEqual({});
  });

  it.each(["cirrus-vision-jet", "cirrus-vision-jet-g2", "cirrus-vision-jet-g3"] as const)("reads achieved %s yaw from the physical ruddervator differential", aircraft => {
    const h = fixture(aircraft, {
      "fcs/throttle-pos-norm": .6, "fcs/flap-pos-norm": .25,
      // Yaw demand .5 plus pitch .28 would ask for .36 on the left;
      // its .35 stop reduces achieved yaw, even though the virtual yaw stays .08.
      "fcs/left-ruddervator-pos-rad": .35, "fcs/right-ruddervator-pos-rad": .20,
      "fcs/rudder-pos-rad": .08, "fcs/rudder-pos-norm": 0,
    });
    expect(h.reader.read()).toEqual({ throttle: .6, flaps: .25, rudder: expect.closeTo(.46875) });
    expect(h.createPropertyBatch.mock.calls[0][0]).not.toContain("fcs/rudder-pos-norm");
    h.reader.dispose();
  });

  it("preserves F35 reflex flaps and converts physical yaw into the pilot's sign", () => {
    const h = fixture("f-35b", {
      "fcs/throttle-pos-norm": .99, "fcs/flap-pos-norm": -.1, "fcs/rudder-pos-norm": .3,
    });
    expect(h.reader.read()).toEqual({ throttle: .99, flaps: -.1, rudder: -.3 });
    h.reader.dispose();
  });

  it("keeps missing and impossible observations absent rather than using commands or zero", () => {
    const h = fixture("cessna-172", { "fcs/throttle-cmd-norm": 1 });
    expect(h.reader.read()).toEqual({});
    h.reader.dispose();
    const invalid = fixture("f-35b", {
      "fcs/throttle-pos-norm": -.1, "fcs/flap-pos-norm": 2, "fcs/rudder-pos-norm": Infinity,
    });
    expect(invalid.reader.read()).toEqual({});
    invalid.values.set("fcs/throttle-pos-norm", .4);
    expect(invalid.reader.read()).toEqual({ throttle: .4 });
    invalid.read.mockImplementationOnce(() => { throw new Error("Model unloaded"); });
    expect(invalid.reader.read()).toEqual({});
    invalid.reader.dispose();
    const unsupported = createControlPositionReader({} as JSBSimSdk, getFdmProfile("cessna-172"));
    expect(unsupported.read()).toEqual({});
    unsupported.dispose();
  });
});
