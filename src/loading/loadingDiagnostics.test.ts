// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoadingDiagnostics, describeLoadingCause, redactLoadingText } from "./loadingDiagnostics";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("loading traceback", () => {
  it.each([
    "The requested module 'http://localhost:7470/src/flight/physics/fixedStepLoop.ts?t=123' doesn't provide an export named: 'FIXED_DT'",
    "The requested module '/src/flight/physics/fixedStepLoop.ts?t=123' does not provide an export named 'FIXED_DT'",
  ])("identifies a missing export even when the browser supplies an empty stack: %s", async message => {
    const diagnostics = createLoadingDiagnostics();
    try {
      const error = new SyntaxError(message);
      error.stack = "";
      const importFlight = () => diagnostics.trace("Import flight application", async () => { throw error; });
      await expect(importFlight()).rejects.toBe(error);
      const report = diagnostics.snapshot();
      expect(report.operations).toMatchObject([{
        operation: "Import flight application", state: "failed", elapsedMs: expect.any(Number),
        callerStack: expect.stringContaining("importFlight"),
        error: { name: "SyntaxError", stack: null, stackUnavailable: expect.stringContaining("no stack"),
          module: { kind: "missing-export", exportName: "FIXED_DT", url: expect.stringContaining("fixedStepLoop.ts[redacted]") } },
      }]);
      expect(JSON.stringify(report)).not.toContain("t=123");
    } finally { diagnostics.stop(); }
  });

  it("keeps full supplied stacks, nested and aggregate causes, and source coordinates", () => {
    const root = new TypeError("fetch failed");
    root.stack = "TypeError: fetch failed\n" + Array.from({ length: 14 }, (_, i) => `    at frame${i} (https://app.test/src/load.ts?t=123:${i + 1}:7)`).join("\n");
    Object.assign(root, { fileName: "https://app.test/src/load.ts?t=123", lineNumber: 15, columnNumber: 7 });
    const aggregate = new AggregateError([root], "Assets failed", { cause: new Error("Network unavailable") });
    const result = describeLoadingCause(new Error("Flight failed", { cause: aggregate }));
    expect(result.cause?.cause?.message).toBe("Error: Network unavailable");
    expect(result.cause?.errors?.[0]).toMatchObject({ source: { url: "https://app.test/src/load.ts[redacted]", line: 15, column: 7 } });
    expect(result.cause?.errors?.[0].stack).toContain("frame13 (https://app.test/src/load.ts[redacted]:14:7)");
    expect(result.cause?.errors?.[0].stack).not.toContain("t=123");
  });

  it("handles foreign errors, cyclic causes and throwing getters without breaking reporting", () => {
    const foreign = { name: "Error", message: "Foreign error", stack: "", cause: null as unknown };
    foreign.cause = foreign;
    expect(describeLoadingCause(foreign)).toMatchObject({ message: "Error: Foreign error", cause: { message: expect.stringContaining("Circular") } });
    const hostile = Object.defineProperties({}, { stack: { get() { throw new Error("getter failed"); } }, message: { get() { throw new Error("getter failed"); } } });
    expect(() => describeLoadingCause(hostile)).not.toThrow();
    expect(describeLoadingCause("plain rejection").message).toBe("plain rejection");
  });

  it("captures browser source locations and failed resources, freezes on stop, and resets for a retry", () => {
    const diagnostics = createLoadingDiagnostics();
    try {
      window.dispatchEvent(new ErrorEvent("error", { message: "Module failed", filename: "https://app.test/app.js?key=private", lineno: 22, colno: 8 }));
      const script = document.createElement("script");
      script.src = "https://app.test/chunk.js?token=secret";
      document.head.append(script);
      script.dispatchEvent(new Event("error"));
      script.remove();
      expect(diagnostics.snapshot().browserEvents).toMatchObject([
        { kind: "error", source: { url: "https://app.test/app.js[redacted]", line: 22, column: 8 } },
        { kind: "resource", source: { url: "https://app.test/chunk.js[redacted]" } },
      ]);
      diagnostics.stop();
      window.dispatchEvent(new ErrorEvent("error", { message: "After startup" }));
      expect(diagnostics.snapshot().browserEvents).toHaveLength(2);
      diagnostics.reset();
      expect(diagnostics.snapshot().browserEvents).toEqual([]);
      window.dispatchEvent(new ErrorEvent("error", { message: "Retry failed" }));
      expect(diagnostics.snapshot().browserEvents).toHaveLength(1);
    } finally { diagnostics.stop(); }
  });

  it("records response status without treating zero timing or byte size as a failed request", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const diagnostics = createLoadingDiagnostics();
    try {
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { name: "https://app.test/failed.js?key=secret", initiatorType: "script", responseStatus: 404, transferSize: 0, startTime: 1, duration: 2 },
        { name: "https://app.test/cached.js", initiatorType: "script", responseStatus: 200, transferSize: 0, startTime: 2, duration: 0 },
      ] as unknown as PerformanceEntry[]);
      expect(diagnostics.snapshot().resources).toMatchObject([
        { url: "https://app.test/failed.js[redacted]", responseStatus: 404 },
        { url: "https://app.test/cached.js", responseStatus: 200, transferBytes: 0 },
      ]);
    } finally { diagnostics.stop(); }
  });

  it("keeps new resource timings when the browser's initial timing buffer is already full", () => {
    let pending: PerformanceEntry[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal("PerformanceObserver", class {
      observe() {}
      takeRecords() { const entries = pending; pending = []; return entries; }
      disconnect = disconnect;
    });
    const diagnostics = createLoadingDiagnostics();
    pending = [{ name: "https://app.test/new-flight.js", initiatorType: "script", startTime: 3, duration: 1, transferSize: 0, responseStatus: 200 }] as unknown as PerformanceEntry[];
    diagnostics.stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(diagnostics.snapshot().resources).toMatchObject([{ url: "https://app.test/new-flight.js", responseStatus: 200 }]);
  });

  it("redacts credentials while keeping Vite stack coordinates", () => {
    const redacted = redactLoadingText("at load (https://user:password@app.test/main.ts?t=123&key=secret:45:9) Bearer abcdefg user@example.com");
    expect(redacted).toContain("main.ts[redacted]:45:9)");
    for (const secret of ["password", "t=123", "key=secret", "abcdefg", "user@example.com"]) expect(redacted).not.toContain(secret);
  });
});
