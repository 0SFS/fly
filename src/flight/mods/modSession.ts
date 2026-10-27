import { modAboutParts, type ModAboutPart } from "@0sfs/mods";
import { browseGithubMods, type GithubModRepository, type ModBrowseKind } from "@0sfs/mods/githubDiscovery";
import { readViewerIdentity, writeDeveloperUsername } from "@0sfs/mods/identity";
import { ModRegistry, type LoadedModRecord, type ModLoaderOptions } from "@0sfs/mods/loader";
import { normalizeModSource, type NormalizeModSourceOptions } from "@0sfs/mods/normalizeModSource";
import type { OsfsModManifest } from "@0sfs/mods/schema";
import type { ModSecurityAssessment } from "@0sfs/mods/security";
import { applyDynamicMod } from "./applyDynamicMod";
import c172 from "@0sfs/c172/manifest" with { type: "json" };
import sf50 from "@0sfs/sf-50/manifest" with { type: "json" };
import f35b from "@0sfs/f-35b/manifest" with { type: "json" };
import io320 from "@0sfs/io320/manifest" with { type: "json" };
import fj33 from "@0sfs/fj33/manifest" with { type: "json" };
import f135 from "@0sfs/f135/manifest" with { type: "json" };
import aim120 from "@0sfs/aim-120/manifest" with { type: "json" };
import gbu12 from "@0sfs/gbu-12/manifest" with { type: "json" };
import gbu32 from "@0sfs/gbu-32/manifest" with { type: "json" };
import aim9x from "@0sfs/aim-9x/manifest" with { type: "json" };
import asraam from "@0sfs/asraam/manifest" with { type: "json" };
import paveway from "@0sfs/paveway-iv/manifest" with { type: "json" };
import gau22 from "@0sfs/gau-22-pod/manifest" with { type: "json" };
import tank from "@0sfs/f-35b-external-tank/manifest" with { type: "json" };

const ADDED_KEY = "osfs.mods.added";
const CONFIRMED_KEY = "osfs.mods.confirmed";

const OFFICIAL: readonly [string, OsfsModManifest][] = [
  ["0SFS/C172", c172 as OsfsModManifest],
  ["0SFS/SF-50", sf50 as OsfsModManifest],
  ["0SFS/F-35B", f35b as OsfsModManifest],
  ["0SFS/IO320", io320 as OsfsModManifest],
  ["0SFS/FJ33", fj33 as OsfsModManifest],
  ["0SFS/F135", f135 as OsfsModManifest],
  ["0SFS/AIM-120", aim120 as OsfsModManifest],
  ["0SFS/GBU-12", gbu12 as OsfsModManifest],
  ["0SFS/GBU-32", gbu32 as OsfsModManifest],
  ["0SFS/AIM-9X", aim9x as OsfsModManifest],
  ["0SFS/ASRAAM", asraam as OsfsModManifest],
  ["0SFS/Paveway-IV", paveway as OsfsModManifest],
  ["0SFS/GAU-22-pod", gau22 as OsfsModManifest],
  ["0SFS/F-35B-external-tank", tank as OsfsModManifest],
];

const BUNDLED_REPOS = new Set(OFFICIAL.map(([source]) => source.toLowerCase()));

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
  if (records.some(record => record.source.canonicalKey === normalized.canonicalKey)) return;
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

/** Loads the built-in mods, then any mods saved on this browser or named in `?mods=`. */
export function ensureModsSession(): Promise<readonly LoadedModRecord[]> {
  if (started) return started;
  started = (async () => {
    const viewer = readViewerIdentity(storage());
    confirmed = new Set(readList(CONFIRMED_KEY));
    const bundled = new Map<string, OsfsModManifest>();
    const normalizeOptions: NormalizeModSourceOptions = { bundledRepos: BUNDLED_REPOS };
    for (const [source, manifest] of OFFICIAL) {
      bundled.set(normalizeModSource(source, normalizeOptions).canonicalKey, manifest);
    }
    options = { ...normalizeOptions, bundled, entry: "startup-url", confirmed, viewer, fetch: globalThis.fetch.bind(globalThis) };
    registry = new ModRegistry(options);
    records = [];
    for (const [source, manifest] of OFFICIAL) {
      if (manifest.kind !== "aircraft" && manifest.kind !== "plugin") continue;
      const record = await registry.installBundled(manifest, source);
      records.push(record);
    }
    added = readList(ADDED_KEY);
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
