import { f135ExhaustOpticalData } from "@0sfs/f135/generated/f135ExhaustOpticalData";
import { F135_ENGINE_GEOMETRY } from "@0sfs/f135/generated/f135EngineData";
import { registerEngineExhaustOpticalProfile, type EngineExhaustOpticalProfile } from "@0sfs/exhaust/engineExhaustProfiles";
import { engineGasRing, type EngineGasSupportDefinition } from "@0sfs/exhaust/engineGasSupport";

/**
 * The F135 as this simulator installs it: its exhaust optics, built from the
 * F135 package's generated tables and registered with the exhaust's profiles
 * when this module is evaluated, and the gas support of its installed mesh.
 */

const f135OpticalProfile: EngineExhaustOpticalProfile = {
  ...f135ExhaustOpticalData,
  textureUrl: new URL("../../../../F135/src/generated/f135-exhaust-lut.png", import.meta.url).href,
  provenanceUrl: new URL("../../../../F135/src/generated/f135-exhaust-lut.manifest.json", import.meta.url).href,
  spatialEmission: {
    ...f135ExhaustOpticalData.spatialEmission,
    textureUrl: new URL("../../../../F135/src/generated/f135-exhaust-spatial.png", import.meta.url).href,
  },
};

registerEngineExhaustOpticalProfile(f135OpticalProfile);

/** 0sfs owns this aircraft-specific gas support; it never changes rigid metal. */
const g = F135_ENGINE_GEOMETRY, beta = g.bearingTiltDegrees * Math.PI / 180;

/**
 * These stations describe the retained original mesh, not measured engine stations.
 * The opaque centrebody ends at −0.08 m; its finite last ring is represented by
 * a radius discontinuity at that station, not invented glowing gas inside metal.
 */
export const F135_ENGINE_GAS_SUPPORT: EngineGasSupportDefinition = {
  rootNode: "F135_Engine", nozzleNode: "F135_Nozzle", nozzleInletRadiusMeters: g.aperture.inletRadius,
  nozzleSegmentCount: g.aperture.segmentCount, nozzleSealHalfWidthMeters: g.aperture.sealHalfWidth,
  ducts: [
    { id: "augmentor", attachmentNode: "F135_Engine", start: engineGasRing(-0.75, g.ductInnerRadius), end: engineGasRing(0, g.ductInnerRadius),
      innerRadiusKnots: [[0, 0.29], [0.32 / 0.75, 0.26], [0.60 / 0.75, 0.15], [0.67 / 0.75, 0.015], [0.67 / 0.75, 0], [1, 0]] },
    { id: "forward-duct", attachmentNode: "F135_Bearing1", start: engineGasRing(0, g.ductInnerRadius),
      end: engineGasRing(g.forwardBearingLength, g.ductInnerRadius, beta) },
    { id: "middle-duct", attachmentNode: "F135_Bearing2", start: engineGasRing(0, g.ductInnerRadius),
      end: engineGasRing(0, g.ductInnerRadius, -2 * beta, [-Math.sin(beta) * g.middleBearingLength, 0, Math.cos(beta) * g.middleBearingLength]) },
    { id: "aft-duct", attachmentNode: "F135_Bearing3", start: engineGasRing(0, g.ductInnerRadius),
      end: engineGasRing(0, g.ductInnerRadius, beta, [Math.sin(beta) * g.aftBearingLength, 0, Math.cos(beta) * g.aftBearingLength]) },
  ],
};
