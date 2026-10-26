import { LoadAssetContainerAsync, type AssetContainer, type ISceneLoaderProgressEvent, type Scene } from "@babylonjs/core";

/**
 * A dev server's way to fly an aircraft with models other than the ones public/
 * serves, for comparing a model change in the flight view and on the engine test
 * stand: `?modelOverride=<set>` loads every asset the set lists from
 * build/model-overrides/<set>/, which scripts/model-override.mjs fills, and every
 * other asset as usual. A production build ignores the address.
 */
export const MODEL_OVERRIDE_SCHEMA = "0sfs-model-override/1";

export interface ModelOverrideManifest {
  schema: typeof MODEL_OVERRIDE_SCHEMA;
  /** Keyed by the asset's path as public/ serves it; `file` is relative to the set. */
  assets: Record<string, { file: string }>;
}

export type ContainerLoader = (url: string, scene: Scene, onProgress: (event: ISceneLoaderProgressEvent) => void) => Promise<AssetContainer>;

export interface ModelOverrideLoaderOptions {
  base?: string;
  fetchManifest?(url: string): Promise<unknown>;
  load?: ContainerLoader;
  /** Called for each asset taken from the set instead of public/. */
  onSubstitute?(assetPath: string, url: string): void;
}

const SET_NAME = /^[\w.-]+$/;

/** The override set an address asks for, or null; only a dev server honours one. */
export function requestedModelOverride(search: string, dev: boolean = import.meta.env.DEV): string | null {
  if (!dev) return null;
  const set = new URLSearchParams(search).get("modelOverride");
  if (!set) return null;
  if (!SET_NAME.test(set)) throw new Error(`modelOverride must be a set name such as before-closeout, not ${JSON.stringify(set)}`);
  return set;
}

function parseManifest(set: string, value: unknown): ModelOverrideManifest {
  const manifest = value as Partial<ModelOverrideManifest> | null;
  if (manifest?.schema !== MODEL_OVERRIDE_SCHEMA || typeof manifest.assets !== "object" || manifest.assets === null) {
    throw new Error(`Model override ${set} has no ${MODEL_OVERRIDE_SCHEMA} manifest`);
  }
  for (const [assetPath, asset] of Object.entries(manifest.assets)) {
    if (typeof asset?.file !== "string" || asset.file.startsWith("/") || asset.file.split("/").includes("..")) {
      throw new Error(`Model override ${set} lists ${assetPath} with no file inside the set`);
    }
  }
  return manifest as ModelOverrideManifest;
}

/**
 * Wraps the aircraft model's loader so each asset the set lists comes from the
 * set. A set that cannot be read fails the load rather than quietly showing the
 * public model, so a comparison never shows the wrong one.
 */
export function createModelOverrideLoader(set: string, options: ModelOverrideLoaderOptions = {}): ContainerLoader {
  if (!SET_NAME.test(set)) throw new Error(`Not a model override set name: ${set}`);
  const rawBase = options.base ?? (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  const directory = `${base}build/model-overrides/${set}/`;
  const fetchManifest = options.fetchManifest ?? (async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Model override ${set} has no manifest at ${url} (${response.status}); run scripts/model-override.mjs`);
    return response.json();
  });
  const load = options.load ?? ((url, scene, onProgress) => LoadAssetContainerAsync(url, scene, { onProgress }));
  let manifest: Promise<ModelOverrideManifest> | null = null;
  return async (url, scene, onProgress) => {
    manifest ??= fetchManifest(`${directory}manifest.json`).then(value => parseManifest(set, value));
    const assets = (await manifest).assets;
    const assetPath = url.startsWith(base) ? url.slice(base.length) : null;
    const asset = assetPath === null ? undefined : assets[assetPath];
    if (!asset) return load(url, scene, onProgress);
    const overridden = `${directory}${asset.file}`;
    options.onSubstitute?.(assetPath!, overridden);
    return load(overridden, scene, onProgress);
  };
}
