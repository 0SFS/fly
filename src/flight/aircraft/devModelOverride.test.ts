import type { AssetContainer, Scene } from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";
import { createModelOverrideLoader, MODEL_OVERRIDE_SCHEMA, requestedModelOverride } from "./devModelOverride";

const scene = {} as Scene;
const container = {} as AssetContainer;
const manifest = {
  schema: MODEL_OVERRIDE_SCHEMA,
  assets: { "aircraft/f-35b/F-35B_AF267-airframe.glb": { file: "aircraft/f-35b/F-35B_AF267-airframe.glb" } },
};

describe("dev model override", () => {
  it("is asked for by the address, on a dev server only", () => {
    expect(requestedModelOverride("?modelOverride=before-closeout", true)).toBe("before-closeout");
    expect(requestedModelOverride("?modelOverride=before-closeout", false)).toBeNull();
    expect(requestedModelOverride("?aircraft=f-35b", true)).toBeNull();
    expect(() => requestedModelOverride("?modelOverride=../public", true)).toThrow(/set name/);
  });

  it("loads the assets the set lists from the set and every other asset as usual", async () => {
    const fetchManifest = vi.fn(async () => manifest);
    const load = vi.fn(async () => container);
    const onSubstitute = vi.fn();
    const loader = createModelOverrideLoader("before-closeout", { base: "/", fetchManifest, load, onSubstitute });
    const onProgress = (): void => {};

    for (const createInstances of [true, false]) {
      await loader("/aircraft/f-35b/F-35B_AF267-airframe.glb", scene, onProgress, { createInstances });
      await loader("/aircraft/f-35b/engine/F135-PW-600-installed.glb", scene, onProgress, { createInstances });
    }

    expect(fetchManifest).toHaveBeenCalledOnce();
    expect(fetchManifest).toHaveBeenCalledWith("/build/model-overrides/before-closeout/manifest.json");
    expect(load.mock.calls.map(call => [call[0], call[3]])).toEqual([true, false].flatMap(createInstances => [
      ["/build/model-overrides/before-closeout/aircraft/f-35b/F-35B_AF267-airframe.glb", { createInstances }],
      ["/aircraft/f-35b/engine/F135-PW-600-installed.glb", { createInstances }],
    ]));
    expect(onSubstitute.mock.calls).toEqual(Array(2).fill([
      "aircraft/f-35b/F-35B_AF267-airframe.glb",
      "/build/model-overrides/before-closeout/aircraft/f-35b/F-35B_AF267-airframe.glb",
    ]));
  });

  it("fails the load when the set cannot be read rather than showing the public model", async () => {
    const load = vi.fn(async () => container);
    const missing = createModelOverrideLoader("missing", { base: "/", fetchManifest: async () => { throw new Error("404"); }, load });
    await expect(missing("/aircraft/f-35b/F-35B_AF267-airframe.glb", scene, () => {}, { createInstances: false })).rejects.toThrow("404");
    const escaping = createModelOverrideLoader("bad", {
      base: "/", load,
      fetchManifest: async () => ({ schema: MODEL_OVERRIDE_SCHEMA, assets: { "a.glb": { file: "../../public/a.glb" } } }),
    });
    await expect(escaping("/a.glb", scene, () => {}, { createInstances: false })).rejects.toThrow(/no file inside the set/);
    expect(load).not.toHaveBeenCalled();
  });
});
