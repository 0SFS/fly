import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

/**
 * The F-35B starts with its wheels hidden, so the frame that first draws them
 * used to compile their shaders and freeze the sim. This drives a real GPU
 * through that toggle, after the same warmup the flight runs, and fails if the
 * frame still compiles or stalls.
 */
interface GearFrame {
  ms: number;
  pipelines: number;
  active: number;
  visibleGear: number;
  activeGear: number;
}

interface GearHitchReport {
  backend: "webgpu" | "webgl";
  warmed: boolean;
  observedCompiles: number;
  warmupPipelines: number;
  firstCanvasPipelines: number;
  settled: GearFrame[];
  show: GearFrame[];
  hide: GearFrame[];
  showAgain: GearFrame[];
}

const chromePath = process.env.CHROME_PATH
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? 0;
}

function compiles(frames: GearFrame[]): number {
  return frames.reduce((sum, frame) => sum + frame.pipelines, 0);
}

function describeFrames(label: string, frames: GearFrame[]): string {
  const last = frames[frames.length - 1];
  return `${label}: ${frames.map(frame => `${frame.ms.toFixed(1)}ms/${frame.pipelines} compiles`).join(", ")} (visible ${last?.visibleGear ?? "?"}, drawn ${last?.activeGear ?? "?"})`;
}

class BrowserSession {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly socket: WebSocket;
  readonly errors: string[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number; error?: { message: string }; result?: unknown;
        method?: string; params?: { exceptionDetails?: { text?: string }; type?: string; args?: { value?: unknown }[] };
      };
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params?.exceptionDetails?.text ?? "page exception");
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        this.errors.push(message.params.args?.map(arg => String(arg.value)).join(" ") ?? "console error");
      }
    });
  }

  static async connect(debuggerUrl: string): Promise<BrowserSession> {
    const socket = new WebSocket(debuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Chrome DevTools socket failed.")), { once: true });
    });
    return new BrowserSession(socket);
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as Record<string, unknown>), reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close(): void { this.socket.close(); }
}

async function launchChrome(port: number, userDataDir: string): Promise<ChildProcess> {
  const chrome = spawn(chromePath, [
    "--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu",
    "--use-angle=metal", "--remote-allow-origins=*", `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`, "--no-first-run", "--disable-extensions", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  chrome.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}.\n${stderr}`);
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (version.ok) return chrome;
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  chrome.kill("SIGKILL");
  throw new Error(`Chrome DevTools did not open.\n${stderr}`);
}

let devServer: ChildProcess | undefined;
let chrome: ChildProcess | undefined;
let userDataDir: string | undefined;

afterAll(async () => {
  const running = chrome && chrome.exitCode === null
    ? new Promise<void>(resolve => { chrome?.once("exit", () => resolve()); })
    : Promise.resolve();
  chrome?.kill("SIGKILL");
  devServer?.kill("SIGTERM");
  await running;
  if (!userDataDir) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { rmSync(userDataDir, { recursive: true, force: true }); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
});

async function launchDevServer(port: number): Promise<ChildProcess> {
  const child = spawn("npm", ["run", "dev", "--", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Dev server exited ${child.exitCode}.\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/src/flight/aircraft/stowedGearHitch.html`);
      if (response.ok) return child;
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Dev server did not serve the gear hitch page.\n${output}`);
}

it("does not stall the frame that shows or hides stowed F-35B gear", async () => {
  const appPort = await freePort();
  devServer = await launchDevServer(appPort);
  const debugPort = await freePort();
  userDataDir = mkdtempSync(path.join(tmpdir(), "stowed-gear-hitch-"));
  chrome = await launchChrome(debugPort, userDataDir);
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.json()) as { webSocketDebuggerUrl: string };
  const browser = await BrowserSession.connect(version.webSocketDebuggerUrl);
  try {
    const created = await browser.send("Target.createTarget", { url: "about:blank" });
    const attached = await browser.send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
    const sessionId = String(attached.sessionId);
    await browser.send("Runtime.enable", {}, sessionId);
    await browser.send("Page.enable", {}, sessionId);
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/src/flight/aircraft/stowedGearHitch.html` }, sessionId);
    const readyDeadline = Date.now() + 45_000;
    let ready = false;
    let bootErrors: string[] = [];
    while (Date.now() < readyDeadline) {
      const probe = await browser.send("Runtime.evaluate", {
        expression: "({ ready: typeof measureStowedGearHitch === 'function', errors: window.__gearHitchBootErrors ?? [] })",
        returnByValue: true,
      }, sessionId);
      const value = (probe.result as { value?: { ready: boolean; errors: string[] } }).value;
      ready = value?.ready ?? false;
      bootErrors = value?.errors ?? [];
      if (ready || bootErrors.length) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`The gear hitch page did not start.\n${bootErrors.join("\n")}\n${browser.errors.join("\n")}`);
    const evaluated = await browser.send("Runtime.evaluate", {
      expression: "measureStowedGearHitch()",
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (evaluated.exceptionDetails) {
      const details = evaluated.exceptionDetails as { text?: string; exception?: { description?: string } };
      throw new Error(details.exception?.description ?? details.text ?? "Gear hitch measurement failed.");
    }
    const report = (evaluated.result as { value: GearHitchReport }).value;
    const settledTail = report.settled.slice(-5);
    const baselineMs = quantile(settledTail.map(frame => frame.ms), 0.95);
    const limitMs = Math.max(250, baselineMs * 6);
    const summary = [
      `backend ${report.backend}, warmed ${report.warmed}, observed compiles ${report.observedCompiles}, warmup compiles ${report.warmupPipelines}, first canvas compiles ${report.firstCanvasPipelines}, quiet-frame limit ${limitMs.toFixed(0)} ms`,
      describeFrames("settled", settledTail),
      describeFrames("extend", report.show),
      describeFrames("retract", report.hide),
      describeFrames("extend again", report.showAgain),
    ].join("\n");
    writeFileSync(path.resolve("build/stowed-gear-hitch.json"), JSON.stringify(report, null, 2));
    console.log(summary);
    // Preparation can finish during model loading or an asynchronous readiness
    // poll, before either of these render frames. Verify the observer saw real
    // compiles without requiring redundant compilation at a particular phase.
    expect(report.observedCompiles, summary).toBeGreaterThan(0);
    expect(report.warmed, summary).toBe(true);
    expect(report.show[0]?.activeGear, summary).toBeGreaterThan(0);
    expect(report.settled.slice(-3).every(frame => frame.pipelines === 0), summary).toBe(true);
    expect(report.show.at(-1)?.visibleGear, summary).toBeGreaterThan(0);
    expect(report.hide.at(-1)?.visibleGear, summary).toBe(0);
    expect(compiles(report.show), summary).toBe(0);
    expect(compiles(report.hide), summary).toBe(0);
    expect(compiles(report.showAgain), summary).toBe(0);
    for (const frame of [...report.show, ...report.hide, ...report.showAgain]) expect(frame.ms, summary).toBeLessThan(limitMs);
  } finally {
    browser.close();
  }
}, 180_000);
