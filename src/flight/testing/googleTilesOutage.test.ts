import { describe, expect, it, vi } from "vitest";
import { installGoogleTilesOutage, requestedGoogleTilesFault, terrainRecoveryDisabled } from "./googleTilesOutage";

const tile = "https://tile.googleapis.com/v1/3dtiles/root.json?key=unused-test-key";
const host = () => ({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("ordinary request")), location: { href: "https://localhost:7470/fly/" } as Location });

describe("development tile outage simulation", () => {
  it("ignores every test switch in production and rejects unknown faults", () => {
    expect(requestedGoogleTilesFault("?googleTilesFault=403", false)).toBeNull();
    expect(requestedGoogleTilesFault("?googleTilesFault=unknown", true)).toBeNull();
    expect(requestedGoogleTilesFault("?googleTilesFault=timeout", true)).toBe("timeout");
    expect(terrainRecoveryDisabled("?mapRecovery=off", false)).toBe(false);
    expect(terrainRecoveryDisabled("?mapRecovery=off", true)).toBe(true);
  });

  it.each(["403", "429", "503"] as const)("returns HTTP %s without contacting Google", async fault => {
    const page = host(); const original = page.fetch;
    const restore = installGoogleTilesOutage(page, fault, 0);
    try {
      const response = await page.fetch(tile);
      expect(response.status).toBe(Number(fault));
      expect((await response.json()).error.code).toBe(Number(fault));
      expect(original).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it("leaves backup terrain, imagery, assets and similar hostnames alone", async () => {
    const page = host(); const original = page.fetch;
    const restore = installGoogleTilesOutage(page, "403");
    try {
      for (const url of ["https://tile.openstreetmap.org/1/0/0.png", "https://tile.googleapis.com/v1/2dtiles/1/0/0", "https://tile.googleapis.com.example.test/v1/3dtiles/root.json", "/aircraft/Cessna.glb"]) await page.fetch(url);
      expect(original).toHaveBeenCalledTimes(4);
    } finally { restore(); }
    expect(page.fetch).toBe(original);
  });

  it("simulates a network rejection", async () => {
    const page = host(); const restore = installGoogleTilesOutage(page, "offline", 0);
    try { await expect(page.fetch(tile)).rejects.toThrow("Simulated Google 3D Tiles network outage"); }
    finally { restore(); }
  });

  it("hangs until cancelled and releases all requests on disposal", async () => {
    const page = host(); const restore = installGoogleTilesOutage(page, "timeout");
    const abort = new AbortController();
    const cancelled = expect(page.fetch(new Request(tile, { signal: abort.signal }))).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await cancelled;
    const disposed = expect(page.fetch(new URL(tile))).rejects.toMatchObject({ name: "AbortError" });
    restore(); await disposed;
  });
});
