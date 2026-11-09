import type { JSBSimSdk, PropertyBatch } from "@felipegalind0/jsbsim";

/** A fixed list of JSBSim properties read together. */
export interface PropertySampler {
  /** The values in slot order, in an array every read reuses. */
  read(): Float64Array;
  dispose(): void;
}

export type PropertySamplerSdk = Pick<JSBSimSdk, "getPropertyValue"> & Partial<Pick<JSBSimSdk, "createPropertyBatch">>;

/**
 * Reads a fixed list of properties through one native batch instead of one
 * scalar read each. Every slot holds what a scalar read of its path gives at
 * the same moment: a path the model lacks is read with a scalar read, since
 * the batch gives NaN where a scalar read gives zero. The SDK disposes every
 * batch when a model loads; the next read makes a batch for the new model.
 * Without the native batch, every slot is a scalar read.
 */
export function createPropertySampler(sdk: PropertySamplerSdk, paths: readonly string[]): PropertySampler {
  const values = new Float64Array(paths.length);
  let batch: PropertyBatch | null = null;
  let scalarSlots: readonly number[] = [];
  let disposed = false;
  const make = (): void => {
    batch = null;
    if (typeof sdk.createPropertyBatch === "function") {
      try { batch = sdk.createPropertyBatch(paths, { create: false }); }
      catch { /* An older WASM artifact may not expose the native binding. */ }
    }
    const missing = new Set(batch?.missing ?? []);
    scalarSlots = paths.flatMap((path, index) => !batch || missing.has(path) ? [index] : []);
  };
  make();
  return {
    read() {
      if (disposed) throw new Error("This property sampler has been disposed.");
      if (batch) {
        try { batch.read(values); }
        catch {
          // Disposed by a model load: read the new model's nodes once more.
          try { batch.dispose(); } catch { /* Already disposed. */ }
          make();
          if (batch) (batch as PropertyBatch).read(values);
        }
      }
      // An indexed loop: a for-of iterator would be an allocation per read.
      for (let slot = 0; slot < scalarSlots.length; slot++) {
        const index = scalarSlots[slot]!;
        values[index] = sdk.getPropertyValue(paths[index]!);
      }
      return values;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      batch?.dispose();
      batch = null;
    },
  };
}
