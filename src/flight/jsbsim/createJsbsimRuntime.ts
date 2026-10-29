import { buildIdentity, JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { bootstrapAircraft, type C172BootstrapOptions } from "./bootstrapC172";
import { type AircraftId, isAircraftId } from "@0sfs/aircraft/aircraftIds";
import { downloadJsbsimData, downloadModJsbsimFiles, type JsbsimLoadProgress } from "./hydrateJsbsimData";
import { readJsbsimBuildIdentity, type JsbsimBuildIdentity } from "./jsbsimBuildIdentity";
import { getFdmProfile, resolveEngineModel, type EngineModelId } from "./fdmProfiles";
import { releaseFlightStateReads } from "@0sfs/ground-contact/ecefBridge";
import { releaseSimulationCapture } from "@0sfs/ground-contact/safeFlightState";
import { DEFAULT_PHYSICS_HZ, isPhysicsHz, type PhysicsHz } from "../physics/physicsRate";

export interface JsbsimRuntimeIdentity {
  aircraftId: AircraftId;
  /** The engine model flying, for an aircraft that offers a choice. */
  engineModel: EngineModelId | null;
  build: JsbsimBuildIdentity;
  assets: { moduleUrl: string; wasmUrl: string };
}

declare global {
  interface Window {
    /** Developer diagnostics for the current runtime; contains no native handles. */
    osfsJsbsimBuild?: JsbsimRuntimeIdentity;
  }
}

export interface JsbsimRuntimeOptions {
  dataBaseUrl?: string;
  aircraftId?: AircraftId;
  /** For an aircraft that offers a choice; default its first. */
  engineModel?: EngineModelId;
  bootstrap?: Omit<C172BootstrapOptions, "engineModel">;
  /** Native steps per simulated second; the flight's loop and consumers use the same. Default 60 Hz, never 120 unless asked. */
  physicsHz?: PhysicsHz;
  onProgress?: (progress: JsbsimLoadProgress) => void;
  onLog?: (stream: "stdout" | "stderr", message: string) => void;
  /** Resolves a mod's JSBSim files when the profile's data source is that mod. */
  findMod?: (modId: string) => { baseUrl: string; files: readonly string[] } | null;
}

export interface JsbsimRuntime {
  sdk: JSBSimSdk;
  identity: JsbsimRuntimeIdentity;
  /** The rate the native model was initialized to step at: one step is 1 / physicsHz seconds. */
  physicsHz: PhysicsHz;
  dispose(): void;
}

export async function createJsbsimRuntime(options: JsbsimRuntimeOptions = {}): Promise<JsbsimRuntime> {
  const aircraftId = options.aircraftId ?? "cessna-172";
  const physicsHz = options.physicsHz ?? DEFAULT_PHYSICS_HZ;
  if (!isPhysicsHz(physicsHz)) throw new Error("Unsupported physics rate: " + String(physicsHz) + " Hz");
  if (!isAircraftId(aircraftId)) throw new Error("Unsupported aircraft: " + aircraftId);
  const engineModel = resolveEngineModel(aircraftId, options.engineModel)?.id ?? null;
  const identity: JsbsimRuntimeIdentity = {
    aircraftId,
    engineModel,
    build: readJsbsimBuildIdentity(buildIdentity),
    assets: { moduleUrl: wasmModuleUrl.toString(), wasmUrl: wasmBinaryUrl.toString() },
  };
  // Asset URLs and build identity come from the same installed SDK package.
  const sdkPromise = JSBSimSdk.create({
    moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false, stripAnsi: true },
  });
  const profile = getFdmProfile(aircraftId, engineModel ?? undefined);
  const dataPromise = profile.dataSource?.kind === "mod"
    ? (async () => {
      const found = options.findMod?.(profile.dataSource?.modId ?? "") ?? null;
      if (!found) throw new Error(`JSBSim data for ${aircraftId} is in mod ${profile.dataSource?.modId}, which is not loaded.`);
      return downloadModJsbsimFiles(found.baseUrl, found.files);
    })()
    : downloadJsbsimData(options.dataBaseUrl, options.onProgress, profile.dataPackage ?? aircraftId);
  let sdk: JSBSimSdk;
  let files: Awaited<typeof dataPromise>;
  try {
    [sdk, files] = await Promise.all([sdkPromise, dataPromise]);
  } catch (error) {
    // A late successful allocation still belongs to this failed startup.
    void sdkPromise.then(instance => instance.destroy()).catch(() => {});
    throw error;
  }
  const stdout = (entry: { message: string }) => options.onLog?.("stdout", entry.message);
  const stderr = (entry: { message: string }) => options.onLog?.("stderr", entry.message);
  sdk.on("stdout", stdout);
  sdk.on("stderr", stderr);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    sdk.off("stdout", stdout);
    sdk.off("stderr", stderr);
    if (typeof window !== "undefined" && window.osfsJsbsimBuild === identity) delete window.osfsJsbsimBuild;
    // Model views own native handles; release them while their executive lives.
    // Always destroy the SDK even when a view's cleanup fails.
    try { releaseFlightStateReads(sdk); }
    finally {
      try { releaseSimulationCapture(sdk); }
      finally { sdk.destroy(); }
    }
  };
  try {
    options.onProgress?.({ message: "Preparing flight physics", progress: null });
    for (const file of files) sdk.writeDataFile(file.path, file.contents);
    await bootstrapAircraft(sdk, aircraftId, physicsHz, { ...options.bootstrap, engineModel: engineModel ?? undefined });
    if (typeof window !== "undefined") window.osfsJsbsimBuild = identity;
    return { sdk, identity, physicsHz, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
