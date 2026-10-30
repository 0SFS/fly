#!/usr/bin/env node
/** Production flight startup and renderer-kill recovery under synthetic desktop constraints. */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHeadlessChrome, evaluate } from './headless-chrome.mjs';
import { resolvePagesDistFile } from './pagesDistFile.mjs';
import { prepareFlightProfileOutput, writeFlightProfileArtifact } from './profile-flight-options.mjs';
import { consoleBrowserOptions, classifyConsoleStartup, parseRendererMemory, parseRendererFootprint, rendererBudgetObservation } from './console-browser-profile.mjs';

const options = consoleBrowserOptions(process.argv.slice(2));
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.resolve(root, options.dist);
await access(path.join(dist, 'fly', 'index.html'));
const out = await prepareFlightProfileOutput(root, path.join(root, 'build', 'console-browser', 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
const write = (name, contents) => writeFlightProfileArtifact(root, path.join(out, name), contents);
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const file = await resolvePagesDistFile(dist, new URL(request.url, 'http://local.test').pathname);
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless', 'cache-control': 'no-store' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { schema: '0sfs-console-browser-check-v2', at: new Date().toISOString(),
  scope: 'Synthetic desktop stress and recovery. Not an Xbox emulator or Xbox compatibility certification.',
  host: { platform: process.platform, architecture: process.arch }, constraints: options,
  limitations: ['Xbox Edge build, sandbox memory ceiling, GPU/driver and OS behavior are not reproduced.',
    'V8 old-space cap is not a total browser/process memory cap.',
    'Page memory is sampled once per second; the test crashes the page on the selected budget excess. This is not the Windows sandbox mechanism.',
    'macOS physical footprint counts dirty/compressed process memory; it is not Windows committed memory. RSS is retained separately, including shared code.',
    'RSS observations may count shared pages more than once; GPU memory is not fully measured.',
    'Fresh profiles use the public default terrain provider, without account credentials or Google keys.'], runs: [] };
const pageSnapshot = `(() => ({loading:window.osfsLoadingDiagnostics?.()??null, content:performance.getEntriesByName('boot:content').length>0,
  jsHeap:performance.memory?{used:performance.memory.usedJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null,
  wasm:window.__consoleCheckWasmSnapshot?.()??null,
  record:JSON.parse(localStorage.getItem('foss-earth.startup.v1 /fly/ current')??'null')}))()`;
let interrupted = false, activeBrowser;
const onSignal = () => { interrupted = true; void activeBrowser?.close(); };
process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
const beforeScripts = `(() => {
  try {Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Clipboard blocked by console test')}}});}catch{}
})()` + (options.profileAllocations ? `;(() => {
  const memories=[];
  const observe=result=>{const instance=result.instance??result;for(const [name,value] of Object.entries(instance.exports??{})){
    if(value instanceof WebAssembly.Memory&&!memories.some(entry=>entry.ref.deref()===value))memories.push({name,ref:new WeakRef(value)});
  }return result;};
  for(const name of ['instantiate','instantiateStreaming']){
    const original=WebAssembly[name];if(!original)continue;
    WebAssembly[name]=function(...args){return Reflect.apply(original,this,args).then(observe);};
  }
  window.__consoleCheckWasmSnapshot=()=>memories.map(({name,ref})=>({name,bytes:ref.deref()?.buffer.byteLength??null}));
})()` : '');
async function installedBrowser() {
  if (options.binary) { await access(options.binary); return options.binary; }
  for (const candidate of ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium']) {
    try { await access(candidate); return candidate; } catch { /* Next installed browser; no acquisition. */ }
  }
  throw new Error('Set --binary to an installed desktop Edge or Chromium executable.');
}
async function rendererMemory(browser, pagePid) {
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
  const processes = processInfo.filter(process => process.type === 'renderer');
  if (!processes.length || !['darwin', 'linux'].includes(process.platform)) return { rssMiB: null, reason: 'Renderer RSS observation unavailable on this host' };
  try {
    const { stdout } = await exec('ps', ['-o', 'pid=,rss=', '-p', processes.map(process => process.id).join(',')], { timeout: 2000 });
    const memory = parseRendererMemory(stdout, pagePid);
    if (memory.rssMiB === null) throw new Error('Attributed renderer exited');
    if (options.memoryMetric === 'footprint') {
      if (process.platform !== 'darwin') throw new Error('Footprint observation requires macOS; use --memory-metric=rss on this host');
      const { stdout: footprint } = await exec('python3', [path.join(root, 'scripts/process-footprint.py'), String(pagePid)], { timeout: 2000 });
      Object.assign(memory, parseRendererFootprint(footprint, pagePid));
    }
    return rendererBudgetObservation(memory, options.memoryMetric);
  } catch (error) { return { rssMiB: null, budgetMiB: null, reason: error.message }; }
}

try {
  const binary = await installedBrowser();
  report.browserBinary = path.basename(binary);
  for (const scenario of options.scenarios) {
    if (interrupted) break;
    const profile = path.join(out, `${scenario}-profile`);
    const run = { scenario, passed: false, timeline: [], exceptions: [], failures: [], recoveryRequests: [],
      downloads: 'denied through browser policy', clipboard: 'blocked', memoryPressure: 'not sent' };
    report.runs.push(run);
    let browser, detach, currentSession, currentTarget, heldWasm = false, crashed = false, crashing = false, recovering = false;
    let crashObserved = false, lastRecord = null, budgetExceeded = false, pagePid = null;
    let tracingDone = false; const traceEvents = [];
    const workerSessions = new Map();
    try {
      browser = await openHeadlessChrome(profile, binary, [`--js-flags=--max-old-space-size=${options.heapMiB}`, '--enable-precise-memory-info']);
      activeBrowser = browser;
      run.browser = await browser.send('Browser.getVersion');
      await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' });
      await browser.send('Target.setDiscoverTargets', { discover: true });
      run.processEvents = [];
      detach = browser.onEvent(event => {
        if (event.method === 'Target.attachedToTarget' && event.params.targetInfo.type === 'worker') {
          workerSessions.set(event.params.sessionId, event.params.targetInfo.url);
        }
        if (event.method === 'Target.detachedFromTarget') workerSessions.delete(event.params.sessionId);
        if (event.method === 'Tracing.dataCollected') traceEvents.push(...event.params.value);
        if (event.method === 'Tracing.tracingComplete') tracingDone = true;
        if (/crash|detached/i.test(event.method) && run.processEvents.length < 30) run.processEvents.push({ method: event.method, status: event.params?.status, reason: event.params?.reason, errorCode: event.params?.errorCode });
        if ((event.method === 'Inspector.targetCrashed' && event.sessionId === currentSession)
          || (event.method === 'Target.targetCrashed' && event.params.targetId === currentTarget)) { crashed = true; crashObserved = true; }
        if (event.method === 'Runtime.exceptionThrown' && event.sessionId === currentSession && run.exceptions.length < 30) {
          run.exceptions.push(String(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text).slice(0, 4000));
        }
        if (event.method === 'Network.requestWillBeSent' && recovering && event.sessionId === currentSession) {
          const pathname = new URL(event.params.request.url).pathname;
          if (run.recoveryRequests.length < 200) run.recoveryRequests.push(pathname);
        }
        if (event.method !== 'Fetch.requestPaused') return;
        const request = event.params;
        if (scenario === 'recovery' && !recovering && /jsbsim[^/]*\.wasm(?:\?|$)/i.test(request.request.url)) { heldWasm = true; return; }
        void browser.send('Fetch.continueRequest', { requestId: request.requestId }, event.sessionId).catch(() => {});
      });
      const newPage = async () => {
        const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }); currentTarget = targetId;
        const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true }); currentSession = attached.sessionId;
        await browser.send('Page.enable', {}, currentSession); await browser.send('Runtime.enable', {}, currentSession);
        await browser.send('Inspector.enable', {}, currentSession);
        // Only URL events are needed. DevTools' default response-body cache
        // otherwise retains large amounts of streamed terrain/imagery in the
        // renderer and charges our instrumentation to the application's RSS.
        await browser.send('Network.enable', { maxTotalBufferSize: 4096, maxResourceBufferSize: 1024 }, currentSession);
        run.devtoolsNetworkPayloadBufferBytes = 4096;
        await browser.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false }, currentSession);
        await browser.send('Emulation.setCPUThrottlingRate', { rate: options.cpuRate }, currentSession);
        try { await browser.send('Emulation.setHardwareConcurrency', { hardwareConcurrency: 4 }, currentSession); run.reportedCpuCount = 4; }
        catch { run.reportedCpuCount = 'override unsupported'; }
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: beforeScripts }, currentSession);
        if (options.profileAllocations) await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, currentSession);
        if (scenario === 'recovery' && !recovering) await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*jsbsim*wasm*' }] }, currentSession);
        return currentSession;
      };
      await newPage();
      const address = new URL('/fly/', origin); address.searchParams.set('renderer', options.renderer);
      if (options.profileAllocations) address.searchParams.set('terrainCapture', '1');
      if (options.profileAllocations) {
        await browser.send('HeapProfiler.startSampling', { samplingInterval: 65536 }, currentSession);
        try { await browser.send('Memory.startSampling', { samplingInterval: 65536 }, currentSession); run.nativeSampling = true; }
        catch { run.nativeSampling = false; }
      }
      await browser.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline'], recordMode: 'recordContinuously', traceBufferSizeInKb: 1024 } });
      const navigation = await browser.send('Page.navigate', { url: address.href }, currentSession);
      await sleep(200);
      await browser.send('Tracing.end');
      const traceDeadline = Date.now() + 5000;
      while (!tracingDone && Date.now() < traceDeadline) await sleep(20);
      const parses = traceEvents.filter(event => event.name === 'ParseHTML' && event.args?.beginData?.frame === navigation.frameId);
      pagePid = parses.at(-1)?.pid;
      if (!Number.isInteger(pagePid)) throw new Error('Could not attribute the flight page to its renderer process');
      run.rendererAttribution = { pid: pagePid, frameId: navigation.frameId, method: 'HTML parse trace for the navigated main frame' };
      traceEvents.length = 0;

      const started = Date.now(); let readySince = null;
      while (Date.now() - started < options.timeoutSeconds * 1000) {
        if (crashed) break;
        let state;
        try { state = await evaluate(browser, currentSession, pageSnapshot); }
        catch (error) { if (crashed) break; throw error; }
        const memory = await rendererMemory(browser, pagePid);
        if (memory.budgetMiB === null || memory.budgetMiB === undefined) throw new Error(memory.reason ?? 'Page memory could not be measured');
        const workerHeaps = options.profileAllocations ? await Promise.all([...workerSessions].map(async ([sessionId, url]) => {
          try { return { url: new URL(url).pathname, ...(await browser.send('Runtime.getHeapUsage', {}, sessionId)) }; }
          catch { return { url: new URL(url).pathname, unavailable: true }; }
        })) : undefined;
        run.timeline.push({ ms: Date.now() - started, rss: memory, jsHeap: state.jsHeap, wasm: state.wasm, workerHeaps,
          phases: state.loading?.phases, operations: state.loading?.operations?.map(operation => ({ name: operation.operation, state: operation.state })) });
        lastRecord = state.record ?? lastRecord;
        if (memory.budgetMiB > options.rendererBudgetMiB) { budgetExceeded = true; break; }
        if (scenario === 'recovery' && heldWasm && lastRecord?.sections?.['startup-state.txt']?.includes('Create JSBSim physics')) break;
        if (scenario === 'startup' && run.memoryPressure === 'not sent' && state.loading?.operations?.length) {
          try { await browser.send('Memory.simulatePressureNotification', { level: 'critical' }); run.memoryPressure = 'critical notification sent; not a memory cap'; }
          catch { run.memoryPressure = 'unsupported'; }
        }
        const classification = classifyConsoleStartup({ crashed, budgetExceeded, snapshot: state.loading, content: state.content, exceptions: run.exceptions, memoryMetric: options.memoryMetric });
        if (classification.passed) { readySince ??= Date.now(); if (Date.now() - readySince >= options.settleSeconds * 1000) { run.passed = true; run.reason = classification.reason; break; } }
        else readySince = null;
        if (state.loading?.outcome === 'failed') { run.reason = classification.reason; break; }
        await sleep(1000);
      }
      if (!crashed) {
        const state = await evaluate(browser, currentSession, pageSnapshot); lastRecord = state.record ?? lastRecord;
        run.lastLoading = state.loading;
        if (scenario === 'startup' && !run.passed) run.reason ??= classifyConsoleStartup({ crashed, budgetExceeded, snapshot: state.loading, content: state.content, exceptions: run.exceptions, memoryMetric: options.memoryMetric }).reason;
      }
      if (options.profileAllocations && !crashed) {
        run.terrainProfile = await evaluate(browser, currentSession, 'window.fossTerrainPerformance?.snapshot() ?? null');
        run.heapUsage = await browser.send('Runtime.getHeapUsage', {}, currentSession);
        run.workerHeaps = [];
        const { targetInfos } = await browser.send('Target.getTargets');
        for (const target of targetInfos.filter(item => item.type === 'worker' && (item.url.startsWith(origin + '/') || item.url.startsWith('blob:' + origin + '/')))) {
          let session;
          try {
            session = (await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
            run.workerHeaps.push({ url: new URL(target.url).pathname, ...(await browser.send('Runtime.getHeapUsage', {}, session)) });
          } catch { run.workerHeaps.push({ url: new URL(target.url).pathname, unavailable: true }); }
          finally { if (session) await browser.send('Target.detachFromTarget', { sessionId: session }).catch(() => {}); }
        }
        run.workerHeapObservation = run.workerHeaps.length ? 'Observed exposed local worker targets; shared buffers may appear in multiple heaps'
          : 'No local dedicated worker targets exposed by CDP; this does not establish zero worker memory';
        const js = await browser.send('HeapProfiler.stopSampling', {}, currentSession);
        await write(`${scenario}-js-allocations.json`, JSON.stringify(js, null, 2));
        if (run.nativeSampling) {
          const native = await browser.send('Memory.getSamplingProfile', {}, currentSession);
          await write(`${scenario}-native-allocations.json`, JSON.stringify(native, null, 2));
        }
        if (process.platform === 'darwin') {
          try {
            const { stdout } = await exec('vmmap', ['-summary', String(pagePid)], { timeout: 5000 });
            await write(`${scenario}-native-memory.txt`, stdout);
          } catch { run.nativeMemoryMap = 'unavailable'; }
        }
      }
      run.budgetExceeded = budgetExceeded;
      if (lastRecord) await write(`${scenario}-checkpoint.json`, JSON.stringify(lastRecord, null, 2));
      run.peakSampledRendererRssMiB = Math.max(0, ...run.timeline.map(sample => sample.rss.rssMiB ?? 0));
      run.peakSampledBudgetMiB = Math.max(0, ...run.timeline.map(sample => sample.rss.budgetMiB ?? 0));
      run.rssStressBudgetExceeded = run.peakSampledRendererRssMiB > options.rendererBudgetMiB;
      if (scenario === 'startup' && run.passed) {
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' }, currentSession);
        await write('startup.png', Buffer.from(shot.data, 'base64'));
      }
      const startupFailure = classifyConsoleStartup({ crashed, budgetExceeded, snapshot: run.lastLoading, exceptions: run.exceptions, memoryMetric: options.memoryMetric }).reason;
      if (scenario === 'recovery' || budgetExceeded || crashed) {
        if (!lastRecord) throw new Error('No real startup checkpoint was captured before termination');
        if (scenario === 'recovery' && !heldWasm) throw new Error('Did not reach the held JSBSim WASM request; recovery scenario did not exercise the intended phase');
        if (!crashed) {
          crashing = true;
          // Terminate only renderer PIDs reported by this newly spawned browser.
          // SIGKILL runs no pagehide/error handler and does not depend on a responsive renderer.
          const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
          const victims = processInfo.filter(item => item.type === 'renderer' && item.id === pagePid).map(item => item.id);
          if (!victims.length || victims.some(pid => !Number.isInteger(pid) || pid <= 1 || pid === process.pid)) throw new Error('No safe owned renderer PID list');
          for (const pid of victims) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
          const deadline = Date.now() + 5000;
          while (!crashed && Date.now() < deadline) {
            const gone = victims.every(pid => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
            if (gone) { crashed = true; crashObserved = true; break; }
            await sleep(50);
          }
          if (!crashed) throw new Error('Renderer termination was not observed');
        }
        run.termination = { method: crashing ? 'SIGKILL of attributed page renderer' : 'unrequested renderer crash', observed: crashObserved, xboxExitCode: 'not reproduced' };
        await browser.send('Target.closeTarget', { targetId: currentTarget }).catch(() => {});
        recovering = true; crashed = false;
        await newPage(); await browser.send('Page.navigate', { url: `${origin}/fly/?report` }, currentSession);
        const deadline = Date.now() + 15000;
        let recovered = false;
        while (Date.now() < deadline) {
          if (await evaluate(browser, currentSession, `Boolean(document.querySelector('[data-file="latest-checkpoint.txt"]'))`)) { recovered = true; break; }
          await sleep(100);
        }
        if (!recovered) throw new Error('Recovery did not display retained file tabs');
        run.recovered = await evaluate(browser, currentSession, `(() => {
          const view=document.querySelector('.foss-earth-issue-report');
          const files=[...view.querySelectorAll('[role=tab][data-file]')];
          const results=files.map(tab=>{tab.click();const range=view.querySelector('.foss-earth-issue-report__paging [role=status]').textContent;
            const total=Number(range.match(/of (\\d+)/)[1]);const jump=view.querySelector('[aria-label="Go to line"]');jump.value=String(total);
            jump.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            return {name:tab.dataset.file,total,lastLineReadable:!!view.querySelector('mark'),lastPage: view.querySelector('[aria-label="Next report page"]').disabled};});
          view.querySelector('[data-file="latest-checkpoint.txt"]').click();
          return {files:results,metadata:view.querySelector('pre').textContent,startedSimulator:!!window.osfsJsbsimBuild||!!document.querySelector('.flight-app__canvas')};
        })()`);
        run.recovered.sameAttempt = run.recovered.metadata.includes(lastRecord.id);
        run.recovered.noSimulatorRequests = !run.recoveryRequests.some(url => /createFlightSimApp|jsbsim.*\.wasm|babylon/i.test(url));
        const success = run.recovered.sameAttempt && !run.recovered.startedSimulator && run.recovered.noSimulatorRequests
          && run.recovered.files.every(file => file.lastLineReadable && file.lastPage);
        run.passed = scenario === 'recovery' && success;
        run.reason = scenario === 'startup' ? startupFailure : success ? 'real-renderer-kill-recovered-with-all-files-readable' : 'recovery-verification-failed';
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' }, currentSession);
        await write(`${scenario}-recovery.png`, Buffer.from(shot.data, 'base64'));
      }
      if (scenario === 'startup' && !run.passed) run.reason ??= startupFailure;
      console.log(`${scenario}: ${run.passed ? 'PASS' : 'FAIL'} (${run.reason})`);
    } catch (error) { run.reason ??= error.message; console.log(`${scenario}: FAIL (${error.message})`); }
    finally {
      detach?.();
      activeBrowser = undefined;
      try { await browser?.close(); } catch (error) { run.passed = false; run.cleanupFailure = error.message; }
      if (!run.cleanupFailure) await rm(profile, { recursive: true, force: true });
    }
  }
} catch (error) { report.error = error.message; }
finally {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  if (interrupted) report.error = 'Check interrupted';
  report.passed = !report.error && report.runs.length === options.scenarios.length && report.runs.every(run => run.passed);
  await write('report.json', JSON.stringify(report, null, 2));
  console.log(`Report: ${path.join(out, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}
