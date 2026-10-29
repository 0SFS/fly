import { describe, expect, it } from "vitest";
import { storeZip } from "@0sfs/drone-camera/zipStore";

describe("storeZip", () => {
  it("writes a STORE-method local header", () => {
    const zip = storeZip([{ name: "DJI_000_0.00_0.00.jpg", bytes: Uint8Array.of(1, 2, 3) }]);
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(zip[8]).toBe(0);
  });
});
