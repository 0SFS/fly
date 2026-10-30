import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubModRepository, GithubModSearchOptions } from "@0sfs/mods/githubDiscovery";

const search = vi.hoisted(() => vi.fn());
vi.mock("@0sfs/mods/githubDiscovery", () => ({ searchGithubMods: search }));
vi.mock("./applyDynamicMod", () => ({ applyDynamicMod: vi.fn() }));
vi.mock("./bundledMods", () => ({ BUNDLED_MODS: [], DEFAULT_MODPACK: "0SFS/default-modpack" }));
vi.mock("../drone/droneGate", () => ({ onModRemoved: vi.fn() }));
vi.mock("../drone/quadRegistry", () => ({ quadAircraftIds: () => [], uninstallQuadLayer: vi.fn(), uninstallQuadVehicle: vi.fn() }));
vi.mock("../drone/cameraPreviewRegistry", () => ({ uninstallCameraPreview: vi.fn() }));
vi.mock("../jsbsim/fdmProfiles", () => ({ unregisterFdmProfile: vi.fn() }));

function repository(fullName: string): GithubModRepository {
  return { fullName, description: "", stars: 0, topics: ["0sfs-mod"], url: `https://github.com/${fullName}` };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  search.mockReset();
});

describe("mod search session", () => {
  it("keeps results when the active category or source location is clicked again", async () => {
    const session = await import("./modSession");
    search.mockResolvedValue([repository("alice/camera")]);
    session.setModSource("camera");
    await session.browseMods();
    const ready = session.getModsSession();
    session.setBrowseKind("all");
    session.setModPlace("github");
    session.setModSource("camera");
    expect(session.getModsSession()).toBe(ready);
  });

  it("ignores an old result after a newer query wins, even if the service ignores cancellation", async () => {
    const session = await import("./modSession");
    const old = deferred<GithubModRepository[]>();
    const current = deferred<GithubModRepository[]>();
    search.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    session.setModSource("plane");
    const oldSearch = session.browseMods();
    const oldSignal = (search.mock.calls[0]![2] as GithubModSearchOptions).signal!;
    session.setModSource("camera");
    expect(oldSignal.aborted).toBe(true);
    const newSearch = session.browseMods();
    current.resolve([repository("alice/camera")]);
    await newSearch;
    const ready = session.getModsSession();
    old.resolve([repository("alice/plane")]);
    await oldSearch;
    expect(session.getModsSession()).toBe(ready);
    expect(ready.browseResults.map(item => item.fullName)).toEqual(["alice/camera"]);
    expect(ready.browseStatus).toBe("ready");
  });

  it("ignores stale failures and wait callbacks after changing category", async () => {
    const session = await import("./modSession");
    const old = deferred<GithubModRepository[]>();
    search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([repository("alice/quad")]);
    session.setModSource("quad");
    const oldSearch = session.browseMods();
    const oldOptions = search.mock.calls[0]![2] as GithubModSearchOptions;
    session.setBrowseKind("aircraft");
    await session.browseMods();
    const ready = session.getModsSession();
    oldOptions.onWait?.(Date.now() + 60_000);
    old.reject(new Error("Old request failed"));
    await oldSearch;
    expect(session.getModsSession()).toBe(ready);
    expect(ready.browseError).toBeNull();
    expect(search.mock.calls[1]![1]).toBe("aircraft");
  });

  it("publishes cooldown and recovery state for the current query", async () => {
    const session = await import("./modSession");
    const current = deferred<GithubModRepository[]>();
    search.mockReturnValue(current.promise);
    session.setModSource("camera");
    const pending = session.browseMods();
    const options = search.mock.calls[0]![2] as GithubModSearchOptions;
    const retryAt = Date.now() + 60_000;
    options.onWait?.(retryAt);
    expect(session.getModsSession()).toMatchObject({ browseStatus: "waiting", browseRetryAt: retryAt });
    options.onWait?.(null);
    expect(session.getModsSession()).toMatchObject({ browseStatus: "loading", browseRetryAt: null });
    current.reject(new Error("Network unavailable"));
    await pending;
    expect(session.getModsSession()).toMatchObject({ browseStatus: "error", browseError: "Network unavailable", browseResults: [] });
    search.mockResolvedValueOnce([repository("alice/camera")]);
    await session.browseMods();
    expect(session.getModsSession()).toMatchObject({ browseStatus: "ready", browseError: null });
  });

  it("clears results on input changes and blocks local or one-character searches", async () => {
    const session = await import("./modSession");
    search.mockResolvedValue([repository("alice/camera")]);
    session.setModSource("camera");
    await session.browseMods();
    session.setModSource("c");
    expect(session.getModsSession()).toMatchObject({ browseResults: [], browseError: null, browseStatus: "idle" });
    await session.browseMods();
    session.setModSource("alice/camera");
    session.setModPlace("local");
    await session.browseMods();
    expect(search).toHaveBeenCalledOnce();
  });
});
