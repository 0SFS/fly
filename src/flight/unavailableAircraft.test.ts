import { describe, expect, it } from "vitest";
import { createSettingsRegistry, SETTINGS_STORAGE_KEY } from "foss-earth/settings";
import { OSFS_PARAMETERS } from "./settings/flightParameters";
import { unavailableAircraftRequest } from "./unavailableAircraft";

const AIRCRAFT = OSFS_PARAMETERS.find(spec => spec.id === "osfs.aircraft.id")!;

function memoryStorage(values: Record<string, unknown> = {}): Storage {
  const items = new Map<string, string>([[SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values })]]);
  return {
    get length() { return items.size; },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: key => { items.delete(key); },
    clear: () => { items.clear(); },
  };
}

function settingsWith(options: { saved?: string; url?: string }) {
  const settings = createSettingsRegistry({
    storage: memoryStorage(options.saved ? { "osfs.aircraft.id": options.saved } : {}),
    searchParams: new URLSearchParams(options.url ? { "set.osfs.aircraft.id": options.url } : {}),
  });
  settings.register([AIRCRAFT]);
  return settings;
}

const withDrone = [...AIRCRAFT.choices!, { id: "dji-mini2", label: "DJI Mini 2" }];

describe("unavailable aircraft request", () => {
  it("names a URL's aircraft until a mod adds it", () => {
    const settings = settingsWith({ url: "dji-mini2" });
    expect(settings.get("osfs.aircraft.id")).toBe("cessna-172");
    expect(unavailableAircraftRequest(settings)).toBe("dji-mini2");
    settings.setChoices("osfs.aircraft.id", withDrone);
    expect(settings.get("osfs.aircraft.id")).toBe("dji-mini2");
    expect(unavailableAircraftRequest(settings)).toBeNull();
  });

  it("names a saved aircraft nothing installed supplies, and the URL's ahead of it", () => {
    expect(unavailableAircraftRequest(settingsWith({ saved: "dji-mini2" }))).toBe("dji-mini2");
    expect(unavailableAircraftRequest(settingsWith({ saved: "dji-mini2", url: "dji-air2s" }))).toBe("dji-air2s");
  });

  it("is null for an aircraft that flies, nothing asked, or a choice the app holds", () => {
    expect(unavailableAircraftRequest(settingsWith({}))).toBeNull();
    expect(unavailableAircraftRequest(settingsWith({ saved: "f-35b" }))).toBeNull();
    expect(unavailableAircraftRequest(settingsWith({ url: "f-35b", saved: "dji-mini2" }))).toBeNull();
    const held = settingsWith({ url: "dji-mini2" });
    held.force("osfs.aircraft.id", "cessna-172", "a benchmark route flies the Cessna");
    expect(unavailableAircraftRequest(held)).toBeNull();
  });

  it("forgets the request once the pilot chooses another aircraft", () => {
    const settings = settingsWith({ url: "dji-mini2" });
    settings.set("osfs.aircraft.id", "cessna-172");
    expect(unavailableAircraftRequest(settings)).toBeNull();
    settings.setChoices("osfs.aircraft.id", withDrone);
    expect(settings.get("osfs.aircraft.id")).toBe("cessna-172");
  });
});
