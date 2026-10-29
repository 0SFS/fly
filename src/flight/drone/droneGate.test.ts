import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativeToTest: string): string {
  return readFileSync(fileURLToPath(new URL(relativeToTest, import.meta.url)), "utf8");
}

describe("drone gate import boundary", () => {
  it("keeps the feature chunk out of the startup files", () => {
    const files = [
      "../createFlightSimApp.ts",
      "../hud/FlightControlPanel.tsx",
      "../../../../rc/src/PhoneController.tsx",
      "../aircraft/fleet.ts",
      "../mods/installBuiltinMods.ts",
    ];
    for (const file of files) {
      const text = source(file);
      for (const name of ["droneFeature", "droneFlightModel", "@0sfs/multirotor", "flowWgsl", "captureFrame", "droneController", "PhoneQuadcopter", "cameraControls"]) {
        expect(text.includes(name), `${file} names ${name}`).toBe(false);
      }
    }
  });
});
