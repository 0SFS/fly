import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedModRecord } from "@0sfs/mods";
import { cameraPreviewProviders, getCameraPreviewProvider, installCameraPreview, subscribeCameraPreviewProviders, uninstallCameraPreview } from "./cameraPreviewRegistry";
import { applyDynamicMod } from "../mods/applyDynamicMod";

function record(id: string, baseUrl: string): LoadedModRecord {
  return {
    baseUrl, dependencies: [],
    manifest: {
      schemaVersion: 1, id, name: id, summary: "Preview provider", kind: "plugin", execution: "js",
      provenance: { owner: "0SFS", repository: `https://github.com/${id}`, license: "AGPL-3.0-only", authors: [] },
      cameraPreview: { apiVersion: 1 }, js: { path: "./preview.js" },
    },
  } as LoadedModRecord;
}

afterEach(() => {
  for (const provider of cameraPreviewProviders()) uninstallCameraPreview(provider.id);
});

describe("optional camera preview providers", () => {
  it("adds provider descriptors without importing code, and removes them independently", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeCameraPreviewProviders(changed);
    try {
      // These module URLs do not exist: registering them must never import them.
      const local = record("0sfs/camera-preview", "/dev-mods/camera-preview/");
      applyDynamicMod(local);
      installCameraPreview(local);
      applyDynamicMod(record("0sfs/other-preview", "https://example.test/provider/"));
      expect(changed).toHaveBeenCalledTimes(2);
      expect(cameraPreviewProviders()).toEqual([
        { id: "0sfs/camera-preview", label: "0sfs/camera-preview", moduleUrl: "/dev-mods/camera-preview/preview.js" },
        { id: "0sfs/other-preview", label: "0sfs/other-preview", moduleUrl: "https://example.test/provider/preview.js" },
      ]);
      uninstallCameraPreview(local.manifest.id);
      expect(getCameraPreviewProvider(local.manifest.id)).toBeNull();
      expect(cameraPreviewProviders()).toHaveLength(1);
      expect(changed).toHaveBeenCalledTimes(3);
      uninstallCameraPreview("missing");
      expect(changed).toHaveBeenCalledTimes(3);
    } finally { unsubscribe(); }
  });

  it("updates a replaced provider and stops notifying disposed subscribers", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeCameraPreviewProviders(changed);
    installCameraPreview(record("0sfs/camera-preview", "/dev-mods/camera-preview/"));
    unsubscribe();
    installCameraPreview(record("0sfs/camera-preview", "https://example.test/replacement/"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(cameraPreviewProviders()).toHaveLength(1);
    expect(getCameraPreviewProvider("0sfs/camera-preview")?.moduleUrl).toBe("https://example.test/replacement/preview.js");
  });
});
