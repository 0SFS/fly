#!/usr/bin/env node
/** Real flight application, JSBSim/WASM and GLBs; an offline fallback globe, no server. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome, waitForExpression } from "./headless-chrome.mjs";
import { newOutputDirectory } from "./outputDirectory.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = newOutputDirectory("validation", "aircraft-switch");
const fixtureRoot = path.join(out, "fixture"), bundleRoot = path.join(out, "bundle");
await mkdir(fixtureRoot);
const source = relative => JSON.stringify(path.join(root, relative));
// Select the actual runtime's documented offline mode. Every runtime method,
// scene, renderer and flight consumer remains real. Observe its run/pause gate.
const runtimeWrapper = path.join(fixtureRoot, "offline-runtime.ts");
await writeFile(runtimeWrapper, `
export * from ${source("node_modules/foss-earth/src/runtime/index.ts")};
import {createBabylonRuntime as create} from ${source("node_modules/foss-earth/src/runtime/index.ts")};
export async function createBabylonRuntime(canvas,options){
 const runtime=await create(canvas,{...options,googleApiKey:null,preferGoogleTiles:false,rasterBaseMap:null,getSurfaceHeightMeters:()=>0});
 const run=runtime.setSimRunning.bind(runtime);
 runtime.setSimRunning=value=>{window.__aircraftSwitch.running=value;run(value);};
 return runtime;
}
`);
await writeFile(path.join(fixtureRoot, "entry.ts"), String.raw`
import ${source("src/styles/globe.css")};
import ${source("src/styles/flight.css")};
import {getAppSettings} from 'foss-earth/settings';
const test=window.__aircraftSwitch={ready:false,error:null,running:false};
getAppSettings(); // As in main.tsx, diagnostics precede aircraft registration.
import(${source("src/flight/createFlightSimApp.ts")}).then(({createFlightSimApp})=>createFlightSimApp(document.getElementById('root'),{googleApiKey:null,preferGoogleTiles:false})).then(app=>{
 test.app=app;test.runtime=app.runtime;test.canvas=document.querySelector('canvas.flight-app__canvas');
 test.world=app.runtime.getWorldRoot();test.origin=performance.timeOrigin;test.ready=true;
}).catch(error=>{const explain=e=>(e.stack??String(e))+(e.cause?'\nCaused by: '+explain(e.cause):'')+(e.errors?'\n'+e.errors.map(explain).join('\n'):'');test.error=explain(error);test.ready=true;});
`);
await writeFile(path.join(fixtureRoot, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aircraft switching integration</title></head><body><div id="root"></div><script type="module" src="/entry.ts"></script></body></html>');
const { default: appConfig } = await import("../vite.config.ts");
await build({
  ...appConfig, configFile: false,
  // The fixture owns startup; production boot-terminal graph assertions name
  // the production entry, rather than this instrumented entry.
  plugins: [
    ...appConfig.plugins.filter(plugin => !["foss-earth-boot-terminal", "copy-index-to-pages-paths"].includes(plugin?.name)),
    { name: "observe-real-flight-snapshots", enforce: "pre", transform(code, id) {
      if (!id.endsWith("/src/flight/hud/createFlightControlPanel.tsx")) return null;
      return code.replace("let snapshot = initialSnapshot;", "let snapshot = initialSnapshot; window.__aircraftSwitch.snapshot = snapshot;")
        .replace("snapshot = nextSnapshot;", "snapshot = nextSnapshot; window.__aircraftSwitch.snapshot = snapshot;");
    } },
  ],
  root: fixtureRoot, publicDir: false, base: "/", logLevel: "warn",
  resolve: { ...appConfig.resolve, alias: [{ find: /^foss-earth\/runtime$/, replacement: runtimeWrapper }] },
  build: { outDir: bundleRoot, emptyOutDir: false, minify: false },
});

const ORIGIN = "https://0sfs.test";
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".xml": "text/xml", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".glb": "model/gltf-binary" };
const failures = [], browserErrors = [], network = [], checks = [];
let chrome, detach, sessionId, firstOrigin, holdCirrus = true, held = [], failFighter = true;
const respond = async ({ requestId, request }, targetSession) => {
  const url = new URL(request.url);
  if (url.origin !== ORIGIN) {
    failures.push("Unexpected external request: " + url.origin);
    await chrome.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, targetSession);
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  if (holdCirrus && /\/jsbsim-data\/.*(sf50|fj33)/i.test(pathname)) {
    held.push([{ requestId, request }, targetSession]);
    return;
  }
  if (failFighter && /\/aircraft\/f-35b\/F-35B_AF267-airframe\.glb$/i.test(pathname)) {
    failFighter = false;
    network.push({ path: pathname, injectedFailure: true });
    await chrome.send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: Buffer.from("Injected aircraft asset failure").toString("base64") }, targetSession);
    return;
  }
  const base = /^\/(aircraft|jsbsim-data)\//.test(pathname) ? path.join(root, "public") : bundleRoot;
  const file = path.resolve(base, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(base + path.sep)) throw new Error("Unsafe fixture request");
  try {
    const bytes = await readFile(file);
    network.push({ path: pathname, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    await chrome.send("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: mime[path.extname(file)] ?? "application/octet-stream" }, { name: "Cache-Control", value: "no-store" }], body: bytes.toString("base64") }, targetSession);
  } catch (error) {
    if (pathname !== "/favicon.ico") failures.push(`Local asset ${pathname}: ${error.message}`);
    await chrome.send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }, targetSession);
  }
};
const run = expression => evaluate(chrome, sessionId, expression);
const wait = expression => waitForExpression(chrome, sessionId, expression, 60000);
const screenshot = async name => {
  const shot = await chrome.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
  await writeFile(path.join(out, name), Buffer.from(shot.data, "base64"));
};
const clickText = text => run(`(()=>{const e=Array.from(document.querySelectorAll('button,[role=tab]')).find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Missing control '+${JSON.stringify(text)});e.click();})()`);
const key = async () => {
  await chrome.send("Input.dispatchKeyEvent", { type: "keyDown", key: "p", code: "KeyP", windowsVirtualKeyCode: 80 }, sessionId);
  await chrome.send("Input.dispatchKeyEvent", { type: "keyUp", key: "p", code: "KeyP", windowsVirtualKeyCode: 80 }, sessionId);
};
const openAircraft = async () => {
  if (await run(`Boolean(document.querySelector('.flight-panel__aircraft-picker'))`)) return;
  await run(`document.querySelector('[aria-label="Open right panel"]')?.click()`);
  await wait(`Boolean(document.querySelector('[data-tab-id="aircraft"]'))`);
  await run(`document.querySelector('[data-tab-id="aircraft"]').click()`);
  await wait(`Boolean(document.querySelector('.flight-panel__aircraft-picker'))`);
};
const select = async family => {
  const current = await run(`(()=>{const header=document.querySelector('.flight-panel__aircraft-current');return {label:header.querySelector('strong').textContent,image:header.querySelector('img')?.getAttribute('src')};})()`);
  if (!current.image) throw new Error("The current aircraft has no family thumbnail: " + JSON.stringify(current));
  await clickText("Switch");
  const gallery = await run(`(()=>{const selected=document.querySelector('.flight-panel__aircraft-card.is-selected');const edit=selected?.querySelector('.flight-panel__command');const image=selected?.querySelector('img');return {duplicateHeader:!!document.querySelector('.flight-panel__aircraft-current'),tag:selected?.tagName,label:selected?.querySelector('strong')?.textContent,image:image?.getAttribute('src'),editLabel:selected?.getAttribute('aria-label'),editText:edit?.textContent.trim(),currentCards:document.querySelectorAll('.flight-panel__aircraft-card.is-selected').length};})()`);
  if (gallery.duplicateHeader || gallery.tag !== "BUTTON" || gallery.label !== current.label || gallery.image !== current.image
    || gallery.editText !== "Edit" || gallery.editLabel !== `Edit ${current.label}` || gallery.currentCards !== 1) {
    throw new Error("Gallery did not keep the active aircraft identity and Edit action in one card: " + JSON.stringify({ current, gallery }));
  }
  checks.push({ galleryOwnership: gallery });
  await run(`document.querySelector('.flight-panel__aircraft-card[aria-label^="Switch to ${family}"]').click()`);
  await wait(`Boolean(document.querySelector('dialog[open] button'))`);
  await clickText("Confirm");
};
const generation = async value => {
  await run(`(()=>{const e=document.querySelector('.flight-panel__generation-field select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`Boolean(document.querySelector('dialog[open] button'))`);
  await clickText("Confirm");
};
const ready = async id => {
  await wait(`window.osfsJsbsimBuild?.aircraftId===${JSON.stringify(id)}&&window.__aircraftSwitch.snapshot?.aircraftId===${JSON.stringify(id)}&&window.__aircraftSwitch.snapshot?.modelStatus==='ready'&&!document.querySelector('.flight-aircraft-switch:not([hidden])')`);
  await openAircraft();
  await wait(`document.querySelector('.flight-panel__aircraft-picker')?.getAttribute('aria-busy')==='false'`);
  const result = await run(`({id:window.osfsJsbsimBuild.aircraftId,origin:performance.timeOrigin,sameCanvas:document.querySelector('canvas.flight-app__canvas')===window.__aircraftSwitch.canvas,sameRuntime:window.__aircraftSwitch.app.runtime===window.__aircraftSwitch.runtime,sameWorld:window.__aircraftSwitch.app.runtime.getWorldRoot()===window.__aircraftSwitch.world,worldDisposed:window.__aircraftSwitch.world.isDisposed(),running:window.__aircraftSwitch.running,model:window.__aircraftSwitch.snapshot.modelStatus,triangles:window.__aircraftSwitch.snapshot.modelTriangles,geometry:window.__aircraftSwitch.app.runtime.scene.meshes.filter(m=>m.getTotalVertices()>0).length})`);
  if (!result.sameCanvas || !result.sameRuntime || !result.sameWorld || result.worldDisposed || !result.geometry) throw new Error("Aircraft switch lost the canvas, runtime, world or geometry: " + JSON.stringify(result));
  if (firstOrigin !== undefined && result.origin !== firstOrigin) throw new Error("Aircraft switch reloaded the page.");
  firstOrigin ??= result.origin;
  checks.push(result);
  console.log("Activated " + id);
};
try {
  chrome = await openHeadlessChrome(path.join(out, "chrome-profile"));
  detach = chrome.onEvent(message => {
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") void respond(message.params, message.sessionId).catch(error => failures.push(error.message));
  });
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true }));
  await chrome.send("Runtime.enable", {}, sessionId);
  await chrome.send("Page.enable", {}, sessionId);
  await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  await chrome.send("Page.addScriptToEvaluateOnNewDocument", { source: `if(!localStorage.getItem('foss-earth.settings.v1'))localStorage.setItem('foss-earth.settings.v1',JSON.stringify({version:1,values:{'renderer.mode':'webgl2','osfs.sound.enabled':false,'osfs.start.resume':false}}));` }, sessionId);
  await chrome.send("Page.navigate", { url: `${ORIGIN}/?renderer=webgl2` }, sessionId);
  await wait("window.__aircraftSwitch?.ready===true");
  const error = await run("window.__aircraftSwitch.error");
  if (error) throw new Error(error);
  await ready("cessna-172");
  await select("Cirrus Vision Jet");
  await wait(`Boolean(document.querySelector('.flight-aircraft-switch:not([hidden])'))`);
  await key();
  const gate = await run(`({running:window.__aircraftSwitch.running,progress:!!document.querySelector('[role=progressbar][aria-label="Loading aircraft"]'),resumeDisabled:document.querySelector('.flight-panel__aircraft-edit [aria-label="Resume simulation"]')?.disabled})`);
  if (gate.running || !gate.progress || !gate.resumeDisabled) throw new Error("Loading did not block resume: " + JSON.stringify(gate));
  checks.push({ loadingGate: gate });
  await screenshot("switch-loading.png");
  holdCirrus = false;
  const requests = held; held = [];
  await Promise.all(requests.map(([request, targetSession]) => respond(request, targetSession)));
  await ready("cirrus-vision-jet");
  await generation("g2");
  await ready("cirrus-vision-jet-g2");
  await generation("g3");
  await ready("cirrus-vision-jet-g3");
  await select("Lockheed Martin F-35B Lightning II");
  await wait(`document.querySelector('dialog[aria-label="Aircraft switch failed"]')?.open===true`);
  await run(`document.querySelector('[role=tab][data-file="failure.txt"]').click()`);
  const failure = await run(`({report:document.querySelector('.foss-earth-issue-report__text')?.textContent,running:window.__aircraftSwitch.running,id:window.osfsJsbsimBuild?.aircraftId})`);
  if (failure.running || !failure.report?.includes("Aircraft switch failed") || failure.id !== "cirrus-vision-jet-g3") throw new Error("Failed switch did not restore paused aircraft/report: " + JSON.stringify(failure));
  checks.push({ failedSwitch: failure });
  await screenshot("switch-failure.png");
  await clickText("Close");
  await openAircraft();
  await select("Lockheed Martin F-35B Lightning II");
  await ready("f-35b");
  await select("Cessna 172 Skyhawk");
  await ready("cessna-172");
  await select("Cirrus Vision Jet");
  await ready("cirrus-vision-jet");
  await screenshot("switched.png");
  await chrome.send("Page.reload", { ignoreCache: true }, sessionId);
  firstOrigin = undefined;
  await wait("window.__aircraftSwitch?.ready===true");
  if (await run("window.__aircraftSwitch.error")) throw new Error(await run("window.__aircraftSwitch.error"));
  await ready("cirrus-vision-jet");
  checks.push({ savedSelectionRestored: true });
  await run("window.__aircraftSwitch.app.destroy()");
} catch (error) {
  failures.push(error.stack ?? String(error));
  if (chrome && sessionId) {
    try {
      await writeFile(path.join(out, "failure.html"), await run("document.documentElement.outerHTML"));
      const shot = await chrome.send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(path.join(out, "failure.png"), Buffer.from(shot.data, "base64"));
    } catch { /* Preserve the original failure. */ }
  }
} finally { detach?.(); await chrome?.close(); }
const report = { scope: "Full flight app, real WASM/aircraft data/GLBs/UI; actual WebGL fallback globe with zero ground height, external network forbidden. No terrain fidelity or aircraft performance qualification.", checks, network, browserErrors, failures, passed: failures.length === 0 && browserErrors.length === 0 && checks.some(check => check.savedSelectionRestored) };
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, report: path.join(out, "report.json"), failures, browserErrors }, null, 2));
if (!report.passed) process.exitCode = 1;
