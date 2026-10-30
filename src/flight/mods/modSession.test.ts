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
  it("adds each airframe as an aircraft of its own and does not import the feature", () => {
    expect(source("./applyDynamicMod.ts").includes("loadDroneFeature")).toBe(false);
    const quad = JSON.parse(source("../../../../Quadcopter/public/0sfs-mod.json"));
    const dji = JSON.parse(source("../../../../DJI-Quadcopter/public/0sfs-mod.json"));
    const camera = JSON.parse(source("../../../../DJI-FC7303/public/0sfs-mod.json"));
    const airCamera = JSON.parse(source("../../../../DJI-FC3411/public/0sfs-mod.json"));
    const mini = JSON.parse(source("../../../../DJI-Mini2/public/0sfs-mod.json"));
    const air = JSON.parse(source("../../../../DJI-Air-2S/public/0sfs-mod.json"));
    const record = (manifest: typeof mini, dependencies: LoadedModRecord[] = []): LoadedModRecord => ({
      manifest, dependencies, baseUrl: "http://local/",
      source: { canonicalKey: manifest.id, manifestUrl: "http://local/0sfs-mod.json", bundled: false, owner: "0SFS", repo: manifest.id },
      security: { requiresConfirmation: false, blockAutomaticUrl: false, reasons: [] },
    } as unknown as LoadedModRecord);
    const miniRecord = record(mini, [record(dji, [record(quad)]), record(camera)]);
    const airRecord = record(air, [record(dji, [record(quad)]), record(airCamera)]);
    const aircraftOf = (familyId: string) => AIRCRAFT_FAMILIES.find(family => family.id === familyId)?.variants.map(variant => variant.aircraftId);
    try {
      applyDynamicMod(miniRecord);
      applyDynamicMod(airRecord);
      expect(aircraftOf("dji-mini2")).toEqual(["dji-mini2"]);
      expect(aircraftOf("dji-air2s")).toEqual(["dji-air2s"]);
      expect(getAircraftDefinition("dji-air2s").familyId).toBe("dji-air2s");
      expect(AIRCRAFT_FAMILIES.find(family => family.id === "dji-mini2")?.thumbnail.path).toBe("http://local/aircraft/thumbnails/dji-mini2.png");
      expect(AIRCRAFT_FAMILIES.find(family => family.id === "dji-air2s")?.thumbnail.path).toBe("http://local/aircraft/thumbnails/dji-air2s.png");
      const definition = getAircraftDefinition("dji-mini2");
      expect(definition.lods.find(lod => lod.id === "hd")?.path).toBe("http://local/3d_model/HD/dji-mini2.glb");
      expect(definition.lods.find(lod => lod.id === "lod0")?.path).toBe("");
      expect(definition.camera?.chaseZoomLimits?.min).toBe(.25);
    } finally {
      unregisterAircraftMod("dji-mini2", ["dji-mini2"]);
      unregisterAircraftMod("dji-air2s", ["dji-air2s"]);
      for (const id of ["dji-mini2", "dji-air2s"]) {
        unregisterFdmProfile(id);
        uninstallQuadVehicle(id);
      }
      uninstallQuadLayer("0sfs/quadcopter");
      uninstallQuadLayer("0sfs/dji-quadcopter");
    }
  });
});
