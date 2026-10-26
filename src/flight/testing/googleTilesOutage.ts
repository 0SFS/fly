export type GoogleTilesFault = "403" | "429" | "503" | "offline" | "timeout";
const FAULTS: readonly string[] = ["403", "429", "503", "offline", "timeout"];

/** A dev server alone honours these links; deployed builds ignore both switches. */
export function requestedGoogleTilesFault(search: string, dev = import.meta.env.DEV): GoogleTilesFault | null {
  const fault = new URLSearchParams(search).get("googleTilesFault");
  return dev && fault && FAULTS.includes(fault) ? fault as GoogleTilesFault : null;
}

export function terrainRecoveryDisabled(search: string, dev = import.meta.env.DEV): boolean {
  return dev && new URLSearchParams(search).get("mapRecovery") === "off";
}

/**
 * Intercept only Google's 3D tile requests, before its auth plugin captures
 * fetch. Backup maps, elevation, aircraft and WASM still use the normal network.
 * No intercepted request reaches Google, including a cached root or auth retry.
 */
export function installGoogleTilesOutage(host: Pick<Window, "fetch" | "location">, fault: GoogleTilesFault, delayMs = 1000): () => void {
  const original = host.fetch;
  const fetch = original.bind(host);
  const pending = new Set<() => void>();
  let active = true;
  const intercepted: typeof host.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, host.location.href);
    if (!active || url.hostname !== "tile.googleapis.com" || !url.pathname.startsWith("/v1/3dtiles/")) return fetch(input, init);
    const signal = init?.signal ?? (typeof input === "object" && "signal" in input ? input.signal : null);
    if (signal?.aborted) return Promise.reject(new DOMException("Simulated tile request cancelled.", "AbortError"));
    const respond = () => {
      if (fault === "offline") throw new TypeError("Simulated Google 3D Tiles network outage.");
      const status = Number(fault);
      return new Response(JSON.stringify({ error: {
        code: status, status: status === 403 ? "PERMISSION_DENIED" : status === 429 ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE",
        message: `Simulated Google 3D Tiles HTTP ${status} outage.`,
      } }), { status, headers: { "Content-Type": "application/json" } });
    };
    if (fault === "timeout" || delayMs > 0) return new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const release = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        pending.delete(cancel);
      };
      const cancel = () => {
        release();
        reject(new DOMException("Simulated tile request cancelled.", "AbortError"));
      };
      pending.add(cancel);
      signal?.addEventListener("abort", cancel, { once: true });
      // Let the flight enter terrain preparation before returning a failure.
      // This makes the in-progress provider transition repeatable on a warm page.
      if (fault !== "timeout") timer = setTimeout(() => {
        release();
        try { resolve(respond()); } catch (error) { reject(error); }
      }, delayMs);
    });
    return Promise.resolve().then(respond);
  };
  host.fetch = intercepted;
  return () => {
    active = false;
    if (host.fetch === intercepted) host.fetch = original;
    for (const cancel of [...pending]) cancel();
  };
}
