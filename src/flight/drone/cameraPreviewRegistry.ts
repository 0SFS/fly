import type { LoadedModRecord } from "@0sfs/mods";

export interface CameraPreviewProvider {
  readonly id: string;
  readonly label: string;
  readonly moduleUrl: string;
}

const providers = new Map<string, CameraPreviewProvider>();
const listeners = new Set<() => void>();

/** Registration stores data only. The Camera tab imports the selected provider on demand. */
export function installCameraPreview(record: Pick<LoadedModRecord, "manifest" | "baseUrl">): void {
  const { manifest, baseUrl } = record;
  if (!manifest.cameraPreview || !manifest.js) return;
  // ModRegistry validates the API and relative entry before applying the record.
  const origin = "https://mod.invalid";
  const resolved = new URL(manifest.js.path, new URL(baseUrl, origin));
  const moduleUrl = baseUrl.startsWith("/") ? resolved.pathname + resolved.search + resolved.hash : resolved.href;
  const previous = providers.get(manifest.id);
  if (previous?.moduleUrl === moduleUrl && previous.label === manifest.name) return;
  providers.set(manifest.id, Object.freeze({ id: manifest.id, label: manifest.name, moduleUrl }));
  for (const listener of listeners) listener();
}

export function uninstallCameraPreview(id: string): void {
  if (!providers.delete(id)) return;
  for (const listener of listeners) listener();
}

export function cameraPreviewProviders(): readonly CameraPreviewProvider[] {
  return [...providers.values()];
}

export function getCameraPreviewProvider(id: string): CameraPreviewProvider | null {
  return providers.get(id) ?? null;
}

export function subscribeCameraPreviewProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
