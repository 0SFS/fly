import { describe, expect, it } from "vitest";
import { insertJpegMetadata } from "@0sfs/drone-camera/jpegExif";

describe("insertJpegMetadata", () => {
  it("puts APP1 after the start of image and records the camera model", () => {
    const jpeg = insertJpegMetadata(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), {
      make: "Camera vendor", software: "Simulator", xmpNamespace: "https://camera.example/metadata/",
      model: "FC7303", exposureDen: 1000, focalMm: 4.35869772740751, focal35mm: 25.431623693139443,
      width: 4000, height: 3000, when: new Date("2026-10-28T00:00:00Z"),
      yawDeg: 12, pitchDeg: -3, rollDeg: 0, gimbalPitchDeg: -90, gimbalYawDeg: 27, gimbalRollDeg: -12, aglM: 8, mslM: 120, focalPx: 2800, scale: 1,
    });
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    expect(jpeg[2]).toBe(0xff);
    expect(jpeg[3]).toBe(0xe1);
    const text = new TextDecoder().decode(jpeg);
    expect(text).toContain('drone-dji:GimbalYawDegree="27.0000"');
    expect(text).toContain('drone-dji:GimbalRollDegree="-12.0000"');
    for (const value of ["FC7303", "Camera vendor", "Simulator", "https://camera.example/metadata/"]) expect(text).toContain(value);
  });
});
