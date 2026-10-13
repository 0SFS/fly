import "./styles/earth.css";
import { createGameLog, trackViewportInsets, type GameLog, type GameLogLine } from "foss-earth/shell";
import { getAppIdentity, showReportOnly, startAppDiagnostics, wantsReportOnly, type AppDiagnostics } from "foss-earth/diagnostics";
import { getAppSettings } from "foss-earth/settings";
import { appRouteFrom, canonicalAppLocation, flightHref, FOSS_EARTH_URL, type AppRoute } from "@0sfs/rc/appRoute";
import { offerFullscreen } from "./fullscreen/fullscreen";
import { createFlightLoadingScreen, type FlightLoadingScreen } from "./loading/createFlightLoadingScreen";

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

  if (route === "remote") {
    const { createPhoneControllerApp } = await import("@0sfs/rc/createPhoneControllerApp");
    await createPhoneControllerApp(rootElement);
    clearBootShell();
    return;
  }

  if (route === "flight") {
    const { createFlightSimApp } = await import("./flight/createFlightSimApp");
    loading?.setPhase("app", { state: "ready" });
    await createFlightSimApp(rootElement, { loadingScreen: loading ?? undefined, log: log ?? undefined, diagnostics: diagnostics ?? undefined });
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

canonicalizeLocation();

// Lift the fixed HUD clear of any browser toolbar overlaying the page bottom
// (Firefox Android's URL bar, Chrome's dynamic toolbar).
trackViewportInsets();

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
    return;
  }
  const recorded = isFlightMode() ? startRecordedLog() : null;
  const diagnostics = recorded?.diagnostics ?? null;
  const log = recorded?.log ?? null;
  const loading = log ? createFlightLoadingScreen(log) : null;
  loading?.setPhase("app", { state: "loading", detail: "Downloading application code" });
  if (log) offerFullscreen(log);

  void bootApp(rootElement, loading, log, diagnostics).catch((error: unknown) => {
    console.error("Failed to bootstrap application.", error);
    if (loading) {
      loading.fail("The application could not initialize. Check your connection and reload to try again.", { cause: error });
      recorded?.end();
      return;
    }
    clearBootShell();
    rootElement.innerHTML = '<div class="boot-error">Failed to initialize the application.</div>';
  });
}

startPage(rootElement);
