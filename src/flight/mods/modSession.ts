import { modAboutParts, type ModAboutPart } from "@0sfs/mods";
import { browseGithubMods, type GithubModRepository, type ModBrowseKind } from "@0sfs/mods/githubDiscovery";
import { readViewerIdentity, writeDeveloperUsername } from "@0sfs/mods/identity";
import { ModRegistry, type LoadedModRecord, type ModLoaderOptions } from "@0sfs/mods/loader";
import { normalizeModSource, type NormalizeModSourceOptions } from "@0sfs/mods/normalizeModSource";
import type { OsfsModManifest } from "@0sfs/mods/schema";
import type { ModSecurityAssessment } from "@0sfs/mods/security";
import { applyDynamicMod } from "./applyDynamicMod";
import { onModRemoved } from "../drone/droneGate";
import { quadAircraftIds, uninstallQuadLayer, uninstallQuadVehicle } from "../drone/quadRegistry";
import { uninstallCameraPreview } from "../drone/cameraPreviewRegistry";
import { unregisterAircraftMod } from "@0sfs/aircraft/aircraftCatalog";
import { unregisterFdmProfile } from "../jsbsim/fdmProfiles";
import { BUNDLED_MODS, DEFAULT_MODPACK } from "./bundledMods";

const ADDED_KEY = "osfs.mods.added";
const CONFIRMED_KEY = "osfs.mods.confirmed";

/** The default modpack and every mod it brings in. Their manifests are bundled. */
const BUNDLED_REPOS = new Set(BUNDLED_MODS.map(([source]) => source.toLowerCase()));

function dependsOn(record: LoadedModRecord, id: string): boolean {
  return record.dependencies.some(dependency => dependency.manifest.id === id || dependsOn(dependency, id));
}

/** The loaded mod with this canonical key, at the top or anywhere among the dependencies. */
function findRecord(key: string): LoadedModRecord | null {
  const stack = [...records];
  while (stack.length) {
    const record = stack.pop();
    if (!record) break;
    if (record.source.canonicalKey === key) return record;
    stack.push(...record.dependencies);
  }
  return null;
}

function findAdded(source: string): LoadedModRecord | null {
  if (!options) return null;
  try { return findRecord(normalizeModSource(source, options).canonicalKey); } catch { return null; }
}

/** True when the source names a mod the default modpack already brings in. */
function isBundled(source: string): boolean {
  try { return normalizeModSource(source, { bundledRepos: BUNDLED_REPOS }).bundled; } catch { return false; }
}

export interface ModsSessionSnapshot {
  installed: readonly ModAboutPart[];
  records: readonly LoadedModRecord[];
  developerUsername: string;
  notice: string | null;
  pendingWarning: ModSecurityAssessment | null;
  pendingSource: string | null;
  browseKind: ModBrowseKind;
  browseResults: readonly GithubModRepository[];
  browseError: string | null;
  shareUrl: string;
}

const listeners = new Set<() => void>();
let started: Promise<readonly LoadedModRecord[]> | null = null;
let registry: ModRegistry | null = null;
let options: ModLoaderOptions | null = null;
let confirmed = new Set<string>();
let added: string[] = [];
let records: LoadedModRecord[] = [];
let pendingSource: string | null = null;
let pendingWarning: ModSecurityAssessment | null = null;
let notice: string | null = null;
let browseKind: ModBrowseKind = "all";
let browseResults: readonly GithubModRepository[] = [];
let browseError: string | null = null;
let snapshot: ModsSessionSnapshot = emptySnapshot();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readList(key: string): string[] {
  const raw = storage()?.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, values: readonly string[]): void {
  storage()?.setItem(key, JSON.stringify(values));
}

function shareUrl(): string {
  if (typeof location === "undefined") return "";
  const url = new URL(location.href);
  if (added.length === 0) url.searchParams.delete("mods");
  else url.searchParams.set("mods", added.join(","));
  return url.toString();
}

function emptySnapshot(): ModsSessionSnapshot {
  return {
    installed: [],
    records: [],
    developerUsername: "",
    notice: null,
    pendingWarning: null,
    pendingSource: null,
    browseKind: "all",
    browseResults: [],
    browseError: null,
    shareUrl: "",
  };
}

function publish(): void {
  snapshot = {
    installed: modAboutParts(records),
    records,
    developerUsername: options?.viewer?.githubUsername ?? "",
    notice,
    pendingWarning,
    pendingSource,
    browseKind,
    browseResults,
    browseError,
    shareUrl: shareUrl(),
  };
  for (const listener of listeners) listener();
}

export function subscribeModsSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getModsSession(): ModsSessionSnapshot {
  return snapshot;
}

function modsFromSearch(): string[] {
  if (typeof location === "undefined") return [];
  const raw = new URL(location.href).searchParams.get("mods");
  if (!raw) return [];
  return raw.split(",").map(item => item.trim()).filter(Boolean);
}

async function loadSource(source: string, fromUrl: boolean): Promise<void> {
  if (!registry || !options) return;
  const normalized = normalizeModSource(source, options);
  if (findRecord(normalized.canonicalKey)) return;
  options.entry = fromUrl ? "startup-url" : "user-add";
  const preview = await registry.preview(source);
  if (fromUrl && preview.security.blockAutomaticUrl) {
    notice = `${preview.manifest.name} is unsandboxed code. Add it from the Mods tab. It does not start from a shared link.`;
    return;
  }
  if (preview.security.requiresConfirmation && !confirmed.has(normalized.canonicalKey)) {
    pendingSource = source;
    pendingWarning = preview.security;
    return;
  }
  const record = await registry.load(source);
  applyDynamicMod(record);
  records = [...records, record];
  if (!normalized.bundled && !added.includes(source)) added = [...added, source];
  writeList(ADDED_KEY, added);
}

/** Installs the default modpack, then any mods saved on this browser or named in `?mods=`. */
export function ensureModsSession(): Promise<readonly LoadedModRecord[]> {
  if (started) return started;
  started = (async () => {
    const viewer = readViewerIdentity(storage());
    confirmed = new Set(readList(CONFIRMED_KEY));
    const bundled = new Map<string, OsfsModManifest>();
    const normalizeOptions: NormalizeModSourceOptions = { bundledRepos: BUNDLED_REPOS };
    for (const [source, manifest] of BUNDLED_MODS) {
      bundled.set(normalizeModSource(source, normalizeOptions).canonicalKey, manifest);
    }
    // scripts/link-packs.mjs links each bundled mod's public/ files into this app's root.
    options = { ...normalizeOptions, bundled, bundledBaseUrl: import.meta.env.BASE_URL, entry: "startup-url", confirmed, viewer };
    registry = new ModRegistry(options);
    const pack = bundled.get(normalizeModSource(DEFAULT_MODPACK, normalizeOptions).canonicalKey);
    if (!pack) throw new Error(`${DEFAULT_MODPACK} is not bundled. Run node scripts/link-packs.mjs.`);
    const record = await registry.installBundled(pack, DEFAULT_MODPACK);
    applyDynamicMod(record);
    records = [record];
    // A mod saved before the pack brought it in is part of the pack now.
    added = readList(ADDED_KEY).filter(source => !isBundled(source));
    writeList(ADDED_KEY, added);
    const requested = [...added];
    for (const source of modsFromSearch()) {
      if (!requested.includes(source)) requested.push(source);
    }
    for (const source of requested) {
      try {
        await loadSource(source, true);
      } catch (error) {
        notice = error instanceof Error ? error.message : String(error);
      }
    }
    publish();
    return records;
  })();
  return started;
}

function dropRecord(record: LoadedModRecord): void {
  const manifest = record.manifest;
  uninstallCameraPreview(manifest.id);
  if (manifest.kind === "aircraft" && manifest.aircraft) {
    const familyId = String((manifest.aircraft.family as { id?: string }).id ?? "");
    const ids = manifest.aircraft.definitions.map(definition => String((definition as { id?: string }).id ?? "")).filter(Boolean);
    for (const id of ids) uninstallQuadVehicle(id);
    unregisterAircraftMod(familyId, ids);
    for (const id of Object.keys(manifest.aircraft.fdmProfiles)) unregisterFdmProfile(id);
  }
  uninstallQuadLayer(manifest.id);
  records = records.filter(item => item.source.canonicalKey !== record.source.canonicalKey);
  if (options) {
    added = added.filter(item => {
      try { return normalizeModSource(item, options!).canonicalKey !== record.source.canonicalKey; }
      catch { return true; }
    });
    writeList(ADDED_KEY, added);
    confirmed.delete(record.source.canonicalKey);
    writeList(CONFIRMED_KEY, [...confirmed]);
  }
  onModRemoved(manifest.id);
}

export async function removeMod(source: string): Promise<void> {
  await ensureModsSession();
  const record = findAdded(source);
  if (!record || record.source.bundled) return;
  const dependents = records.filter(item => item !== record && dependsOn(item, record.manifest.id));
  for (const dependent of dependents) dropRecord(dependent);
  dropRecord(record);
  if (quadAircraftIds().length === 0) {
    uninstallQuadLayer("0sfs/quadcopter");
    uninstallQuadLayer("0sfs/dji-quadcopter");
  }
  publish();
}

export async function addMod(source: string): Promise<void> {
  await ensureModsSession();
  notice = null;
  try {
    await loadSource(source, false);
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  }
  publish();
}

export async function confirmPendingMod(): Promise<void> {
  if (!pendingSource || !options) return;
  const source = pendingSource;
  const key = normalizeModSource(source, options).canonicalKey;
  confirmed.add(key);
  writeList(CONFIRMED_KEY, [...confirmed]);
  pendingSource = null;
  pendingWarning = null;
  try {
    await loadSource(source, false);
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  }
  publish();
}

export function dismissPendingMod(): void {
  pendingSource = null;
  pendingWarning = null;
  publish();
}

export function setDeveloperUsername(username: string): void {
  const box = storage();
  if (box) writeDeveloperUsername(box, username);
  if (options) options.viewer = readViewerIdentity(box);
  publish();
}

export function setBrowseKind(kind: ModBrowseKind): void {
  browseKind = kind;
  publish();
}

export async function browseMods(): Promise<void> {
  browseError = null;
  try {
    const session = typeof sessionStorage === "undefined" ? null : sessionStorage;
    browseResults = await browseGithubMods(browseKind, globalThis.fetch.bind(globalThis), session);
  } catch (error) {
    browseError = error instanceof Error ? error.message : String(error);
    browseResults = [];
  }
  publish();
}
