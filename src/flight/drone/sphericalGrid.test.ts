import { describe, expect, it } from "vitest";
import type { DjiQuadModData, QuadcopterModData, QuadVehicleModData } from "@0sfs/mods/schema";
import { buildDroneProfile } from "./droneTypes";
import { sphericalGrid } from "@0sfs/drone-camera/sphericalGrid";

import common from "../../../../Quadcopter/public/0sfs-mod.json";
import dji from "../../../../DJI-Quadcopter/public/0sfs-mod.json";
import miniMod from "../../../../DJI-Mini2/public/0sfs-mod.json";
import airMod from "../../../../DJI-Air-2S/public/0sfs-mod.json";
import miniCamera from "../../../../DJI-FC7303/public/0sfs-mod.json";
import airCamera from "../../../../DJI-FC3411/public/0sfs-mod.json";

const mini = buildDroneProfile("dji-mini-2", "Mini 2", common.quadcopter as QuadcopterModData, dji.dji as DjiQuadModData, miniMod.quad as QuadVehicleModData, miniCamera.camera);
const air = buildDroneProfile("dji-air-2s", "Air 2S", common.quadcopter as QuadcopterModData, dji.dji as DjiQuadModData, airMod.quad as QuadVehicleModData, airCamera.camera);

describe("sphericalGrid", () => {
  it("builds the Mini 2 and Air 2S shots from the field of view", () => {
    const miniNodes = sphericalGrid(mini);
    expect(miniNodes).toHaveLength(22);
    expect(miniNodes.filter(node => Math.abs(node.pitchDeg + 90) < 1e-6)).toHaveLength(1);
    expect(miniNodes.filter(node => Math.abs(node.pitchDeg - (-90 + 110 / 3)) < 1e-6)).toHaveLength(6);
    expect(miniNodes.filter(node => Math.abs(node.pitchDeg - (-90 + 220 / 3)) < 1e-6)).toHaveLength(8);
    expect(miniNodes.filter(node => Math.abs(node.pitchDeg - 20) < 1e-6)).toHaveLength(7);
    const airNodes = sphericalGrid(air);
    expect(airNodes).toHaveLength(20);
    expect(airNodes.filter(node => Math.abs(node.pitchDeg + 90) < 1e-6)).toHaveLength(1);
    expect(airNodes.filter(node => Math.abs(node.pitchDeg + 52) < 1e-6)).toHaveLength(5);
    expect(airNodes.filter(node => Math.abs(node.pitchDeg + 14) < 1e-6)).toHaveLength(7);
    expect(airNodes.filter(node => Math.abs(node.pitchDeg - 24) < 1e-6)).toHaveLength(7);
  });
});
