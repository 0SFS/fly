import { getAppIdentity, redactIssueReport, reportSecrets } from "foss-earth/diagnostics";
import { getAppSettings } from "foss-earth/settings";

/** Keep source coordinates even when Vite puts its cache query before them. */
export function redactLoadingText(value: string): string {
  let secrets: string[] = [];
  try { secrets = reportSecrets(getAppSettings()); } catch { /* Reporting must survive broken settings. */ }
  const withoutQueries = value.replace(/https?:\/\/[^\s<>"'`]+/gi, url => {
    const query = url.search(/[?#]/);
    if (query < 0) return url;
    const suffix = url.slice(query).match(/(:\d+:\d+)?([),.]*)$/);
    return url.slice(0, query) + "[redacted]" + (suffix?.[1] ?? "") + (suffix?.[2] ?? "");
  });
  return redactIssueReport(withoutQueries, secrets);
}

function property(value: unknown, key: string): unknown {
  try { return value !== null && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
}

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? redactLoadingText(value.slice(0, 32_768)) : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export interface LoadingCause {
  name: string | null;
  message: string;
  /** The browser's stack, never a fabricated substitute for a missing stack. */
  stack: string | null;
  stackUnavailable?: string;
  source?: { url: string | null; line: number | null; column: number | null };
  module?: { kind: "missing-export"; url: string; exportName: string };
  cause?: LoadingCause;
  errors?: LoadingCause[];
}

/** Includes cross-realm errors, Error.cause and AggregateError, without serializing arbitrary objects. */
export function describeLoadingCause(value: unknown, seen = new Set<unknown>(), depth = 0): LoadingCause {
  if (seen.has(value) || depth >= 6) return { name: null, message: "[Circular or deeper error cause omitted]", stack: null };
  seen.add(value);
  const name = text(property(value, "name"));
  let message = text(property(value, "message"));
  if (message === null) {
    try { message = text(typeof value === "string" ? value : JSON.stringify(value)); } catch { /* Cyclic thrown object. */ }
  }
  const stack = text(property(value, "stack"));
  const result: LoadingCause = {
    name, message: (name ? `${name}: ` : "") + (message ?? "Unknown thrown value"), stack,
    ...(!stack?.includes("\n") ? { stackUnavailable: "The browser supplied no stack frames. See the operation's callerStack and any source/module details." } : {}),
  };
  const url = text(property(value, "fileName") ?? property(value, "filename"));
  const line = number(property(value, "lineNumber"));
  const column = number(property(value, "columnNumber"));
  if (url || line !== null || column !== null) result.source = { url, line, column };
  const missing = result.message.match(/(?:requested )?module ['"]([^'"]+)['"] (?:does not|doesn't) provide an export named:?\s*['"]([^'"]+)['"]/i);
  if (missing) result.module = { kind: "missing-export", url: missing[1], exportName: missing[2] };
  const cause = property(value, "cause");
  if (cause !== undefined) result.cause = describeLoadingCause(cause, seen, depth + 1);
  const errors = property(value, "errors");
  if (Array.isArray(errors)) result.errors = errors.slice(0, 8).map(error => describeLoadingCause(error, seen, depth + 1));
  return result;
}

interface LoadingOperation {
  operation: string;
  startedMs: number;
  elapsedMs: number | null;
  state: "running" | "ready" | "failed";
  /** Captured before awaiting: still present for module-link errors with an empty stack. */
  callerStack: string | null;
  error?: LoadingCause;
}

interface BrowserFailure {
  elapsedMs: number;
  kind: "error" | "rejection" | "resource" | "preload";
  source?: { url: string | null; line: number | null; column: number | null };
  error?: LoadingCause;
}

function readResources(entries?: PerformanceEntryList) {
  try {
    // A resource timing is evidence of a request, not proof it succeeded or failed.
    return ((entries ?? performance.getEntriesByType("resource")) as PerformanceResourceTiming[])
      .filter(entry => ["script", "link", "fetch", "xmlhttprequest", "css"].includes(entry.initiatorType))
      .slice(-80).map(entry => ({
        url: redactLoadingText(entry.name), initiator: entry.initiatorType,
        startMs: entry.startTime, durationMs: entry.duration,
        responseStatus: number(property(entry, "responseStatus")), transferBytes: entry.transferSize,
      }));
  } catch { return []; }
}

export function createLoadingDiagnostics() {
  let startedAt = performance.now();
  const operations: LoadingOperation[] = [];
  const events: BrowserFailure[] = [];
  let resources: ReturnType<typeof readResources> | null = null;
  let recentResources: ReturnType<typeof readResources> = [];
  let observer: PerformanceObserver | null = null;
  let listening = false;
  const collectResources = (entries: PerformanceEntryList) => {
    recentResources.push(...readResources(entries));
    recentResources = recentResources.slice(-80);
  };
  const elapsed = () => performance.now() - startedAt;
  const record = (event: BrowserFailure) => { events.push(event); if (events.length > 40) events.shift(); };
  const onError = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement || target instanceof HTMLImageElement) {
      record({ elapsedMs: elapsed(), kind: "resource", source: {
        url: text(target instanceof HTMLLinkElement ? target.href : target.src), line: null, column: null,
      } });
      return;
    }
    const detail = event as ErrorEvent;
    if (!detail.message && !detail.error) return;
    record({ elapsedMs: elapsed(), kind: "error", error: describeLoadingCause(detail.error ?? detail.message),
      source: { url: text(detail.filename), line: number(detail.lineno), column: number(detail.colno) } });
  };
  const onRejection = (event: Event) => record({ elapsedMs: elapsed(), kind: "rejection", error: describeLoadingCause((event as PromiseRejectionEvent).reason) });
  const onPreload = (event: Event) => record({ elapsedMs: elapsed(), kind: "preload", error: describeLoadingCause(property(event, "payload")) });
  const start = () => {
    if (listening) return;
    listening = true;
    resources = null;
    // Dev startup can exhaust the browser's resource-timing buffer before the
    // lazy import even starts. Observe new requests rather than losing them.
    try {
      observer = new PerformanceObserver(list => collectResources(list.getEntries()));
      observer.observe({ type: "resource", buffered: true });
    } catch { observer = null; }
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("vite:preloadError", onPreload);
  };
  const stop = () => {
    if (observer) {
      collectResources(observer.takeRecords());
      observer.disconnect();
      observer = null;
      resources ??= recentResources.slice();
    }
    resources ??= readResources();
    listening = false;
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("vite:preloadError", onPreload);
  };
  start();
  return {
    async trace<T>(operation: string, run: () => Promise<T>): Promise<T> {
      const entry: LoadingOperation = {
        operation: redactLoadingText(operation), startedMs: elapsed(), elapsedMs: null, state: "running",
        callerStack: text(new Error(`Starting ${operation}`).stack),
      };
      operations.push(entry);
      if (operations.length > 40) operations.shift();
      try {
        const result = await run();
        entry.state = "ready";
        return result;
      } catch (error) {
        entry.state = "failed";
        entry.error = describeLoadingCause(error);
        throw error;
      } finally { entry.elapsedMs = elapsed() - entry.startedMs; }
    },
    snapshot() {
      let build = null;
      try { build = getAppIdentity(); } catch { /* Build metadata may be unavailable in a broken page. */ }
      if (observer) collectResources(observer.takeRecords());
      return {
        context: {
          page: redactLoadingText(window.location.href), build,
          startedAtNavigationMs: startedAt,
          browser: redactLoadingText(navigator.userAgent), online: navigator.onLine,
          secureContext: window.isSecureContext ?? false, crossOriginIsolated: window.crossOriginIsolated ?? false,
          serviceWorker: text(navigator.serviceWorker?.controller?.scriptURL),
        },
        operations: operations.map(entry => ({ ...entry })), browserEvents: events.slice(),
        resources: resources ?? (observer ? recentResources.slice() : readResources()),
      };
    },
    stop,
    reset() { stop(); startedAt = performance.now(); operations.length = 0; events.length = 0; recentResources = []; start(); },
    start,
  };
}

export type LoadingDiagnosticsSnapshot = ReturnType<ReturnType<typeof createLoadingDiagnostics>["snapshot"]>;
