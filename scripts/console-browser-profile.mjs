/** Synthetic desktop constraints. These numbers are test budgets, not Xbox specifications. */
export function consoleBrowserOptions(args) {
  const allowed = new Set(['dist', 'binary', 'scenarios', 'heap-mib', 'renderer-budget-mib', 'memory-metric', 'cpu-rate', 'timeout', 'settle', 'width', 'height', 'renderer', 'profile-allocations']);
  const values = {};
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || match[1] in values) throw new Error(`Unknown or repeated option: ${arg}`);
    values[match[1]] = match[2];
  }
  const number = (name, fallback, min, max, integer = false) => {
    const value = Number(values[name] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`--${name} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
    return value;
  };
  const scenarios = (values.scenarios ?? 'startup,recovery').split(',');
  if (scenarios.some(value => !['startup', 'recovery'].includes(value)) || new Set(scenarios).size !== scenarios.length) throw new Error('Choose startup and/or recovery');
  const renderer = values.renderer ?? 'webgl2';
  if (!['auto', 'webgl2', 'webgpu'].includes(renderer)) throw new Error('Choose renderer auto, webgl2, or webgpu');
  const memoryMetric = values['memory-metric'] ?? (process.platform === 'darwin' ? 'footprint' : 'rss');
  if (!['rss', 'footprint'].includes(memoryMetric)) throw new Error('Choose memory metric rss or footprint');
  return { dist: values.dist ?? 'build/console-browser/dist', binary: values.binary ?? process.env.CHROME_BIN,
    scenarios, renderer, memoryMetric, profileAllocations: number('profile-allocations', 0, 0, 1, true) === 1, heapMiB: number('heap-mib', 256, 64, 2048, true), rendererBudgetMiB: number('renderer-budget-mib', 768, 64, 4096),
    cpuRate: number('cpu-rate', 2, 1, 20), timeoutSeconds: number('timeout', 45, 5, 120), settleSeconds: number('settle', 20, 0, 20),
    width: number('width', 1920, 320, 3840, true), height: number('height', 1080, 240, 2160, true) };
}

export function classifyConsoleStartup({ crashed, budgetExceeded, snapshot, content, exceptions = [], memoryMetric = 'rss' }) {
  if (budgetExceeded) return { passed: false, reason: `synthetic-renderer-${memoryMetric}-budget-exceeded` };
  if (crashed) return { passed: false, reason: 'renderer-crashed' };
  if (snapshot?.outcome === 'failed') return { passed: false, reason: 'startup-reported-failure' };
  if (exceptions.length) return { passed: false, reason: 'unhandled-browser-exception' };
  if (snapshot?.outcome !== 'ready' || !content) return { passed: false, reason: 'startup-incomplete' };
  if (Object.values(snapshot.phases ?? {}).some(phase => /fallback|unavailable/i.test(phase.detail ?? ''))) return { passed: false, reason: 'startup-used-fallback' };
  return { passed: true, reason: 'startup-ready-within-synthetic-budget' };
}

/** Attribute RSS by PID; Chrome UI/extensions/spares are diagnostic totals only. */
export function parseRendererMemory(output, pagePid) {
  const rows = output.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  if (!rows.length || rows.some(row => row.length !== 2 || !Number.isInteger(row[0]) || row[0] <= 0 || !Number.isFinite(row[1]) || row[1] < 0)
    || new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('Invalid process observation');
  const page = rows.find(([pid]) => pid === pagePid);
  return { rssMiB: page ? page[1] / 1024 : null, pagePid,
    allRendererRssMiB: rows.reduce((sum, [, kib]) => sum + kib, 0) / 1024,
    rendererProcesses: rows.length, processes: rows.map(([pid, kib]) => ({ pid, rssMiB: kib / 1024 })) };
}

export function parseRendererFootprint(output, pagePid) {
  const value = JSON.parse(output);
  if (value.pid !== pagePid || !Number.isFinite(value.footprintMiB) || value.footprintMiB <= 0) throw new Error('Invalid owned process footprint observation');
  return { footprintMiB: value.footprintMiB };
}

export function rendererBudgetObservation(memory, metric) {
  if (!['rss', 'footprint'].includes(metric)) throw new Error('Unknown process memory metric');
  const value = metric === 'footprint' ? memory.footprintMiB : memory.rssMiB;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Page renderer ${metric} observation unavailable`);
  return { ...memory, budgetMetric: metric, budgetMiB: value };
}
