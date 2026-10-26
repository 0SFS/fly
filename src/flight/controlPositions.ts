import type { JSBSimSdk, PropertyBatch } from "@felipegalind0/jsbsim";
import type { ActualControlPositions } from "@0sfs/rc/protocol";
import type { FdmProfile } from "./jsbsim/fdmProfiles";

type PositionProfile = Pick<FdmProfile, "sf50VariantId" | "rudderSign" | "flapPosition">;

/**
 * Reads the actuators, never their commands. Trim is mixed into the elevator
 * and ailerons by these models; none has a separate physical trim observation.
 */
export function createControlPositionReader(sdk: JSBSimSdk, profile: PositionProfile): {
  read(): ActualControlPositions;
  dispose(): void;
} {
  // SF50 does not populate rudder-pos-norm. Its two ruddervators combine
  // pitch and yaw, so their differential measures the achieved yaw component,
  // including any travel lost when their combined commands reach a stop.
  const sf50 = profile.sf50VariantId !== undefined;
  const paths = ["fcs/throttle-pos-norm", profile.flapPosition.property,
    ...(sf50 ? ["fcs/left-ruddervator-pos-rad", "fcs/right-ruddervator-pos-rad"] : ["fcs/rudder-pos-norm"])];
  let batch: PropertyBatch | null = null;
  try {
    if (typeof sdk.createPropertyBatch === "function") batch = sdk.createPropertyBatch(paths, { create: false });
  } catch { /* Optional feedback stays absent when the model cannot expose it. */ }
  const missing = new Set(batch?.missing ?? paths);
  const values = new Float64Array(paths.length);
  let disposed = false;
  const withinStops = (position: number, minimum: number): number | undefined =>
    Number.isFinite(position) && position >= minimum - 1e-6 && position <= 1 + 1e-6
      ? Math.max(minimum, Math.min(1, position)) : undefined;
  const observed = (index: number, scale: number, minimum: number): number | undefined => {
    if (missing.has(paths[index]) || !Number.isFinite(scale) || scale === 0) return undefined;
    // Allow conversion roundoff at a physical stop, not impossible positions.
    return withinStops(values[index] / scale, minimum);
  };
  const rudder = (): number | undefined => {
    if (!sf50) return observed(2, 1, -1);
    if (missing.has(paths[2]) || missing.has(paths[3]) || !Number.isFinite(values[2]) || !Number.isFinite(values[3])
      || Math.abs(values[2]) > .35 || Math.abs(values[3]) > .35) return undefined;
    // The SF50 FCS maps full yaw to +/-0.16 radians on the opposing surfaces.
    return withinStops((values[2] - values[3]) / (2 * .16), -1);
  };
  return {
    read() {
      if (disposed || !batch) return {};
      try { batch.read(values); } catch { return {}; }
      const throttle = observed(0, 1, 0);
      const flaps = observed(1, profile.flapPosition.fullTravel, profile.flapPosition.minNorm ?? 0);
      const nativeRudder = rudder();
      return {
        ...(throttle === undefined ? {} : { throttle }),
        ...(flaps === undefined ? {} : { flaps }),
        ...(nativeRudder === undefined ? {} : { rudder: nativeRudder * profile.rudderSign }),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      batch?.dispose();
      batch = null;
    },
  };
}
