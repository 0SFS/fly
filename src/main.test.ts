// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouteFrom } from "@0sfs/rc/appRoute";
import { createPairingUrl } from "@0sfs/rc/pairing";
import type { FlightLoadingScreen } from "./loading/createFlightLoadingScreen";

const appMocks = vi.hoisted(() => ({
  createFlightSimApp: vi.fn(async () => ({ destroy: vi.fn() })),
  createPhoneControllerApp: vi.fn(async () => ({ destroy: vi.fn() })),
  showReportOnly: vi.fn(),
  markReady: vi.fn(),
  reportFailure: vi.fn(),
  isRecoveryPage: vi.fn(() => false),
  diagnosticsDestroy: vi.fn(),
  addDiagnosticState: vi.fn(),
  trailStep: vi.fn(),
  diagnosticLog: [] as string[],
  startDiagnostics: vi.fn((options: { log: import("foss-earth/shell").GameLog }) => ({
    log: { ...options.log, print: (entry: import("foss-earth/shell").GameLogEntry) => {
      appMocks.diagnosticLog.push(entry.text);
      return options.log.print(entry);
    } },
    destroy: appMocks.diagnosticsDestroy,
    addState: appMocks.addDiagnosticState,
    trail: { step: appMocks.trailStep },
  })),
}));

vi.mock("@foss-earth/ui/browser", async importOriginal => ({
  ...await importOriginal<typeof import("@foss-earth/ui/browser")>(),
  markBrowserAppReady: appMocks.markReady,
  reportBrowserAppFailure: appMocks.reportFailure,
  isBrowserRecoveryPage: appMocks.isRecoveryPage,
}));

vi.mock("foss-earth/diagnostics", async importOriginal => ({
  ...await importOriginal<typeof import("foss-earth/diagnostics")>(),
  startAppDiagnostics: appMocks.startDiagnostics,
  showReportOnly: appMocks.showReportOnly,
}));

vi.mock("./flight/createFlightSimApp", () => ({
  createFlightSimApp: appMocks.createFlightSimApp,
}));

vi.mock("@0sfs/rc/createPhoneControllerApp", () => ({
  createPhoneControllerApp: appMocks.createPhoneControllerApp,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  appMocks.diagnosticLog.length = 0;
  appMocks.isRecoveryPage.mockReturnValue(false);
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  for (const call of appMocks.createFlightSimApp.mock.calls as unknown[][]) {
    (call[1] as { loadingScreen?: FlightLoadingScreen } | undefined)?.loadingScreen?.destroy();
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("application route", () => {
  it("opens the retained report without starting the flight or replacing its trail", async () => {
    window.history.replaceState(null, "", "/fly/?report");

    await import("./main");

    expect(appMocks.showReportOnly).toHaveBeenCalledWith(document.getElementById("root"), {
      settings: expect.objectContaining({ get: expect.any(Function) }),
      identity: expect.objectContaining({ source: expect.any(String) }),
    });
    expect(appMocks.startDiagnostics).not.toHaveBeenCalled();
    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
    expect(appMocks.createPhoneControllerApp).not.toHaveBeenCalled();
    expect(document.getElementById("app-log")).toBeNull();
    expect(appMocks.markReady).toHaveBeenCalledWith(document);
  });

  it("loads only 0SFS when mode=flight", async () => {
    window.history.replaceState(null, "", "/?mode=flight&mapSource=google&key=test-key");

    await import("./main");
    await vi.waitFor(() => expect(appMocks.createFlightSimApp).toHaveBeenCalledOnce());

    expect(appMocks.createPhoneControllerApp).not.toHaveBeenCalled();
    expect(appMocks.createFlightSimApp).toHaveBeenCalledWith(document.getElementById("root"), {
      loadingScreen: expect.objectContaining({ show: expect.any(Function), setPhase: expect.any(Function) }),
      log: expect.objectContaining({ print: expect.any(Function) }),
      diagnostics: expect.objectContaining({ log: expect.objectContaining({ print: expect.any(Function) }), destroy: appMocks.diagnosticsDestroy }),
    });
    expect(appMocks.startDiagnostics).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(appMocks.markReady).toHaveBeenCalledWith(document));
    expect(appMocks.reportFailure).not.toHaveBeenCalled();
    expect(appMocks.diagnosticLog).toContain("Application: Downloading application code");
    expect(document.getElementById("app-log")!.textContent).toContain("Application ready");
    // The route keeps the query; FOSS Earth's registry saves the key and takes it off the address bar.
    expect(`${window.location.pathname}${window.location.search}`).toBe("/fly/?mapSource=google");
  });

  it.each(["/fly", "/fly/", "/?mode=flight"])("loads the flight simulator at %s", async (route) => {
    window.history.replaceState(null, "", route);

    await import("./main");
    await vi.waitFor(() => expect(appMocks.createFlightSimApp).toHaveBeenCalledOnce());

    expect(appMocks.createPhoneControllerApp).not.toHaveBeenCalled();
  });

  it.each([
    ["/", "/fly/"],
    ["/?mode=unknown&renderer=webgl2#view", "/fly/?renderer=webgl2#view"],
  ])("sends %s to the flight at %s, as the home page is the website's", async (route, flight) => {
    const replace = vi.fn();
    const href = `https://0sfs.github.io${route}`;
    const url = new URL(href);
    vi.stubGlobal("location", {
      ...window.location,
      href,
      search: url.search,
      pathname: url.pathname,
      hash: url.hash,
      replace,
      // FOSS Earth's modules resolve their asset URLs when imported; the copied
      // toString belongs to the real Location and refuses this stand-in.
      toString: () => href,
    });

    await import("./main");

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(flight));
    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
    expect(appMocks.createPhoneControllerApp).not.toHaveBeenCalled();
  });

  it("sends ?mode=globe to the FOSS Earth site", async () => {
    const replace = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      href: "https://0sfs.github.io/?mode=globe",
      search: "?mode=globe",
      pathname: "/",
      hash: "",
      replace,
      // FOSS Earth's modules resolve their asset URLs when imported; the copied
      // toString belongs to the real Location and refuses this stand-in.
      toString: () => "https://0sfs.github.io/?mode=globe",
    });

    await import("./main");

    expect(replace).toHaveBeenCalledWith("https://foss-earth.github.io/");
    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
    expect(appMocks.createPhoneControllerApp).not.toHaveBeenCalled();
  });

  it("loads the phone controller at /rc/ without booting either simulator", async () => {
    window.history.replaceState(null, "", "/rc/#v=1&peer=desktop-id&join=invitation");

    await import("./main");
    await vi.waitFor(() => expect(appMocks.createPhoneControllerApp).toHaveBeenCalledOnce());

    expect(appMocks.createPhoneControllerApp).toHaveBeenCalledWith(document.getElementById("root"));
    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
  });

  it("loads the phone controller from a generated pairing URL", async () => {
    // An explicit base: this test is about routing a generated URL, not about
    // which origin the QR defaults to (jsdom runs on loopback, which a phone
    // could not reach and which `createPairingUrl` refuses without a LAN one).
    const pairing = new URL(createPairingUrl("desktop-id", "a".repeat(43), "https://fly.example.test/"));
    expect(pairing.pathname).toBe("/rc/");
    expect(appRouteFrom(pairing)).toBe("remote");
    window.history.replaceState(null, "", `${pairing.pathname}${pairing.search}${pairing.hash}`);

    await import("./main");
    await vi.waitFor(() => expect(appMocks.createPhoneControllerApp).toHaveBeenCalledOnce());

    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
  });

  it("loads the phone controller from a legacy ?mode=remote pairing URL", async () => {
    window.history.replaceState(null, "", "/?mode=remote#v=1&peer=desktop-id&join=invitation");

    await import("./main");
    await vi.waitFor(() => expect(appMocks.createPhoneControllerApp).toHaveBeenCalledOnce());

    expect(window.location.pathname).toMatch(/^\/rc\/?$/);
    expect(window.location.search).toBe("");
    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
  });

  it("keeps a useful loading error visible when application initialization rejects", async () => {
    window.history.replaceState(null, "", "/?mode=flight");
    const failure = new Error("Offline");
    appMocks.createFlightSimApp.mockRejectedValueOnce(failure);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./main");

    await vi.waitFor(() => expect(document.querySelector('#app-log [data-tone="error"]')).not.toBeNull());
    expect(document.getElementById("app-log")!.hidden).toBe(false);
    expect(document.querySelector('#app-log [data-tone="error"] .game-log__actions button')!.textContent).toBe("Reload and try again");
    expect(document.querySelector('#app-log .game-log__line[data-tone="error"]')!.textContent).toContain("could not initialize. Copy the loading report for details, then reload to try again.\nError: Offline");
    expect(window.osfsLoadingDiagnostics?.()).toMatchObject({
      version: 2, operations: [
        { operation: expect.stringContaining("Import flight"), state: "ready" },
        { operation: "Initialize flight application", state: "failed", error: { message: "Error: Offline" }, callerStack: expect.stringContaining("main.tsx:") },
      ],
    });
    expect(appMocks.addDiagnosticState).toHaveBeenCalledOnce();
    const readState = appMocks.addDiagnosticState.mock.calls[0][0] as () => string;
    expect(readState()).toContain('"operation": "Initialize flight application"');
    expect(appMocks.trailStep).toHaveBeenCalledWith("Startup failed: Initialize flight application");
    expect(appMocks.trailStep).toHaveBeenCalledWith(expect.stringContaining("main.tsx:"));
    expect(appMocks.diagnosticsDestroy).toHaveBeenCalledOnce();
    expect(appMocks.reportFailure).toHaveBeenCalledExactlyOnceWith(document, "The application could not initialize.");
    expect(appMocks.markReady).not.toHaveBeenCalled();
  });

  it("says once what stopped a flight that reported its own failure", async () => {
    window.history.replaceState(null, "", "/fly/");
    appMocks.createFlightSimApp.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[1] as { loadingScreen: FlightLoadingScreen };
      const failure = new DOMException("Terrain preparation was replaced by another destination.", "AbortError");
      options.loadingScreen.fail("Flight could not start safely. Check your connection and map access, then retry.", { cause: failure });
      throw failure;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./main");

    await vi.waitFor(() => expect(appMocks.diagnosticsDestroy).toHaveBeenCalledOnce());
    const errors = [...document.querySelectorAll('#app-log .game-log__line[data-tone="error"]')].map(line => line.textContent);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Flight paused. Flight could not start safely. Check your connection and map access, then retry.\nAbortError: Terrain preparation");
    expect(window.osfsLoadingDiagnostics?.()).toMatchObject({ outcome: "failed", failure: expect.stringContaining("could not start safely"), cause: { message: expect.stringContaining("AbortError") } });
    expect(appMocks.reportFailure).toHaveBeenCalledOnce();
  });

  it("keeps the original generic error behavior when a non-flight route fails", async () => {
    window.history.replaceState(null, "", "/rc/");
    document.body.insertAdjacentHTML("beforeend", '<div id="app-log"></div>');
    appMocks.createPhoneControllerApp.mockRejectedValueOnce(new Error("Offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./main");

    await vi.waitFor(() => expect(document.querySelector(".boot-error")?.textContent).toBe("Failed to initialize the application."));
    expect(document.getElementById("app-log")).toBeNull();
    expect(appMocks.reportFailure).toHaveBeenCalledOnce();
  });

  it("leaves the standalone browser data review free of flight or phone startup", async () => {
    window.history.replaceState(null, "", "/rc/?resetBrowserData=1");
    appMocks.isRecoveryPage.mockReturnValue(true);

    await import("./main");

    expect(appMocks.createFlightSimApp).not.toHaveBeenCalled();
    expect(appMocks.createPhoneControllerApp).not.toHaveBeenCalled();
    expect(appMocks.startDiagnostics).not.toHaveBeenCalled();
    expect(appMocks.markReady).not.toHaveBeenCalled();
    expect(appMocks.reportFailure).not.toHaveBeenCalled();
  });
});
