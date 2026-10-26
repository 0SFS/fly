import "./styles/earth.css";
import { capturePendingMultiplayerInvitation } from "./flight/multiplayer/invitationHandoff";
import { createGameLog, trackViewportInsets, type GameLog, type GameLogLine } from "foss-earth/shell";
import { getAppIdentity, showReportOnly, startAppDiagnostics, wantsReportOnly, type AppDiagnostics } from "foss-earth/diagnostics";
import { getAppSettings } from "foss-earth/settings";
import { attachBootLog, isBrowserRecoveryPage, markBrowserAppReady, reportBrowserAppFailure, whenIsolationSettled } from "@foss-earth/ui/browser";
import { appRouteFrom, canonicalAppLocation, flightHref, FOSS_EARTH_URL, type AppRoute } from "@0sfs/rc/appRoute";
import { offerFullscreen } from "./fullscreen/fullscreen";
import { createFlightLoadingScreen, type FlightLoadingScreen } from "./loading/createFlightLoadingScreen";
import type { LoadingDiagnosticsSnapshot } from "./loading/loadingDiagnostics";
import { installGoogleTilesOutage, requestedGoogleTilesFault } from "./flight/testing/googleTilesOutage";

function appRoute(): AppRoute {
  return appRouteFrom(new URL(window.location.href));
}

function canonicalizeLocation(): void {
  const here = new URL(window.location.href);
  if (appRouteFrom(here) === "globe") {
    window.location.replace(FOSS_EARTH_URL);
    return;
  }
  const next = canonicalAppLocation(here);
  if (next) window.history.replaceState(window.history.state, "", next);
}

function isFlightMode(): boolean {
  return appRoute() === "flight";
}

function clearBootShell(): void {
  document.getElementById("app-log")?.remove();
}

async function bootApp(rootElement: HTMLElement, loading: FlightLoadingScreen | null, log: GameLog | null, diagnostics: AppDiagnostics | null): Promise<void> {
  const route = appRoute();
  const trace = <T,>(operation: string, run: () => Promise<T>): Promise<T> => loading?.trace ? loading.trace(operation, run) : run();

  if (route === "remote") {
    const { createPhoneControllerApp } = await import("@0sfs/rc/createPhoneControllerApp");
    await createPhoneControllerApp(rootElement);
    clearBootShell();
    markBrowserAppReady(document);
    return;
  }

  if (route === "flight") {
    const fault = requestedGoogleTilesFault(window.location.search);
    if (fault) {
      installGoogleTilesOutage(window, fault);
      log?.print({ text: `Testing Google 3D Tiles outage: ${fault}. Remove googleTilesFault from the address to stop simulating it.`, tone: "warning" });
    }
    const { createFlightSimApp } = await trace("Import flight application (src/flight/createFlightSimApp.ts)", () => import("./flight/createFlightSimApp"));
    loading?.setPhase("app", { state: "ready" });
    await trace("Initialize flight application", () => createFlightSimApp(rootElement, {
      loadingScreen: loading ?? undefined, log: log ?? undefined, diagnostics: diagnostics ?? undefined,
      ...(fault ? { googleApiKey: "0sfs-outage-test", preferGoogleTiles: true } : {}),
    }));
    markBrowserAppReady(document);
    return;
  }

  if (route === "globe") {
    window.location.replace(FOSS_EARTH_URL);
    return;
  }

  // The home page is the website's (0sfs.github.io); this app's own root is the flight.
  window.location.replace(flightHref(new URL(window.location.href)));
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Expected to find a root element with id "root".');
}

/**
 * The visit's log, each line recorded in the diagnostics trail until `end`.
 * FOSS Earth's diagnostics log ignores new lines and updates once destroyed; the
 * old one kept passing them to the page's log, so after a failed start the
 * loading report, its Try again and Copy confirmations and the fullscreen offer
 * keep working while the trail stops.
 */
function startRecordedLog(): { log: GameLog; diagnostics: AppDiagnostics; end(): void } {
  const base = createGameLog();
  let printed: GameLogLine | null = null;
  const diagnostics = startAppDiagnostics({
    log: { ...base, get element() { return base.element; }, print(entry) { printed = base.print(entry); return printed; } },
    settings: getAppSettings(), identity: getAppIdentity(),
  });
  let ended = false;
  const log: GameLog = {
    ...diagnostics.log,
    get element() { return base.element; },
    print(entry) {
      if (ended) return base.print(entry);
      printed = null;
      const line = diagnostics.log.print(entry);
      const own = printed as GameLogLine | null;
      return own ? { ...line, update: next => { if (ended) own.update(next); else line.update(next); } } : line;
    },
  };
  return { log, diagnostics, end() { ended = true; diagnostics.destroy(); } };
}

function startPage(rootElement: HTMLElement): void {
  if (isFlightMode() && wantsReportOnly(window.location.search)) {
    clearBootShell();
    showReportOnly(rootElement, { settings: getAppSettings(), identity: getAppIdentity() });
    markBrowserAppReady(document);
    return;
  }
  const recorded = isFlightMode() ? startRecordedLog() : null;
  const diagnostics = recorded?.diagnostics ?? null;
  const log = recorded?.log ?? null;
  // The log's history starts with the boot terminal's lines, and the log takes over from it at the first frame.
  if (log) attachBootLog(log);
  const loading = log ? createFlightLoadingScreen(log) : null;
  if (loading) diagnostics?.addState(() => `Loading diagnostics:\n${JSON.stringify(window.osfsLoadingDiagnostics?.(), null, 2)}`);
  loading?.setPhase("app", { state: "loading", detail: "Downloading application code" });
  if (log) offerFullscreen(log);

  void bootApp(rootElement, loading, log, diagnostics).catch((error: unknown) => {
    reportBrowserAppFailure(document, "The application could not initialize.");
    console.error("Failed to bootstrap application.", error);
    if (loading) {
      loading.fail("The application could not initialize. Copy the loading report for details, then reload to try again.", { cause: error });
      // Retain the useful frames before end() disposes the visit. A report-only
      // page after a reload can then identify the failed operation too.
      try {
        const snapshot = window.osfsLoadingDiagnostics?.() as LoadingDiagnosticsSnapshot | undefined;
        for (const operation of snapshot?.operations ?? []) {
          if (operation.state !== "failed") continue;
          const lines = [`Startup failed: ${operation.operation}`, operation.error?.message,
            ...(operation.error?.stack?.split("\n") ?? []), "Startup operation requested from:",
            ...(operation.callerStack?.split("\n") ?? [])];
          for (const line of lines.slice(0, 40)) if (line) diagnostics?.trail.step(line);
        }
      } catch { /* Retention must not hide the failure or prevent cleanup. */ }
      recorded?.end();
      return;
    }
    clearBootShell();
    rootElement.innerHTML = '<div class="boot-error">Failed to initialize the application.</div>';
  });
}

if (!isBrowserRecoveryPage(document)) {
  canonicalizeLocation();
  // Lift the fixed HUD clear of any browser toolbar overlaying the page bottom
  // (Firefox Android's URL bar, Chrome's dynamic toolbar).
  trackViewportInsets();
  // A first visit may reload once to be isolated (index.html's first script); until it knows, nothing starts.
  void whenIsolationSettled(window).then(() => {
    capturePendingMultiplayerInvitation();
    startPage(rootElement);
  });
}
