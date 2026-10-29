import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AIRCRAFT_FAMILIES, getAircraftDefinition, unregisterAircraftMod } from "@0sfs/aircraft/aircraftCatalog";
import type { LoadedModRecord } from "@0sfs/mods";
import { applyDynamicMod } from "./applyDynamicMod";
import { unregisterFdmProfile } from "../jsbsim/fdmProfiles";
import { uninstallQuadLayer, uninstallQuadVehicle } from "../drone/quadRegistry";

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("quadcopter mods", () => {
  it("adds the family from the manifests and does not import the feature", () => {
    expect(source("./applyDynamicMod.ts").includes("loadDroneFeature")).toBe(false);
    const quad = JSON.parse(source("../../../../Quadcopter/public/0sfs-mod.json"));
    const dji = JSON.parse(source("../../../../DJI-Quadcopter/public/0sfs-mod.json"));
    const camera = JSON.parse(source("../../../../DJI-FC7303/public/0sfs-mod.json"));
    const mini = JSON.parse(source("../../../../DJI-Mini2/public/0sfs-mod.json"));
    const record = (manifest: typeof mini, dependencies: LoadedModRecord[] = []): LoadedModRecord => ({
      manifest, dependencies, baseUrl: "http://local/",
      source: { canonicalKey: manifest.id, manifestUrl: "http://local/0sfs-mod.json", bundled: false, owner: "0SFS", repo: manifest.id },
      security: { requiresConfirmation: false, blockAutomaticUrl: false, reasons: [] },
    } as unknown as LoadedModRecord);
    const miniRecord = record(mini, [record(dji, [record(quad)]), record(camera)]);
    try {
      applyDynamicMod(miniRecord);
      expect(AIRCRAFT_FAMILIES.some(family => family.id === "dji-quadcopter")).toBe(true);
      const definition = getAircraftDefinition("dji-mini-2");
      expect(definition.lods.find(lod => lod.id === "hd")?.path).toBe("http://local/3d_model/HD/dji-mini2.glb");
      expect(definition.lods.find(lod => lod.id === "lod0")?.path).toBe("");
      expect(definition.camera?.chaseZoomLimits?.min).toBe(.25);
    } finally {
      unregisterAircraftMod("dji-quadcopter", ["dji-mini-2"]);
      unregisterFdmProfile("dji-mini-2");
      uninstallQuadVehicle("dji-mini-2");
      uninstallQuadLayer("0sfs/quadcopter");
      uninstallQuadLayer("0sfs/dji-quadcopter");
    }
  });
});
