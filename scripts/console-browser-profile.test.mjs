import { describe, expect, it } from 'vitest';
import { classifyConsoleStartup, consoleBrowserOptions, parseRendererMemory, parseRendererFootprint, rendererBudgetObservation } from './console-browser-profile.mjs';
describe('synthetic console-browser acceptance', () => {
  it('rejects invalid or unbounded runs and preserves explicit constraints', () => {
    for (const arg of ['--timeout=999', '--heap-mib=NaN', '--width=0', '--scenarios=xbox', '--cpu-rate=0', '--renderer=unknown']) expect(() => consoleBrowserOptions([arg])).toThrow();
    expect(consoleBrowserOptions(['--scenarios=recovery', '--heap-mib=128'])).toMatchObject({ scenarios: ['recovery'], heapMiB: 128 });
  });
  it('requires complete startup, content, no exceptions and no fallback within budget', () => {
    const ready = { snapshot: { outcome: 'ready', phases: { assets: { state: 'ready' } } }, content: true };
    expect(classifyConsoleStartup(ready).passed).toBe(true);
    expect(classifyConsoleStartup({ ...ready, crashed: true }).passed).toBe(false);
    expect(classifyConsoleStartup({ ...ready, budgetExceeded: true }).reason).toContain('budget');
    expect(classifyConsoleStartup({ ...ready, exceptions: ['unexpected failure'] }).passed).toBe(false);
    expect(classifyConsoleStartup({ ...ready, content: false }).passed).toBe(false);
    expect(classifyConsoleStartup({ snapshot: { outcome: 'loading' }, content: true }).passed).toBe(false);
    expect(classifyConsoleStartup({ ...ready, snapshot: { outcome: 'ready', phases: { assets: { detail: 'Using fallback aircraft' } } } }).passed).toBe(false);
  });
});

it('labels the selected counter and never substitutes RSS for missing footprint data', () => {
  const memory = { rssMiB: 900, ...parseRendererFootprint('{"pid":41,"footprintMiB":500}', 41) };
  expect(rendererBudgetObservation(memory, 'footprint')).toMatchObject({ budgetMiB: 500, budgetMetric: 'footprint', rssMiB: 900 });
  expect(rendererBudgetObservation(memory, 'rss').budgetMiB).toBe(900);
  expect(() => rendererBudgetObservation({ rssMiB: 200 }, 'footprint')).toThrow();
  expect(() => parseRendererFootprint('{"pid":42,"footprintMiB":500}', 41)).toThrow();
  expect(() => parseRendererFootprint('{"pid":41,"footprintMiB":null}', 41)).toThrow();
  expect(() => parseRendererFootprint('{"pid":41,"footprintMiB":-1}', 41)).toThrow();
  expect(() => consoleBrowserOptions(['--memory-metric=heap'])).toThrow();
  expect(consoleBrowserOptions(['--memory-metric=rss']).memoryMetric).toBe('rss');
  expect(classifyConsoleStartup({ budgetExceeded: true, memoryMetric: 'footprint' }).reason).toBe('synthetic-renderer-footprint-budget-exceeded');
});

it('budgets the attributed page renderer and exposes other renderer memory separately', () => {
  const memory = parseRendererMemory('40 2097152\n41 204800\n42 307200', 41);
  expect(memory.rssMiB).toBe(200);
  expect(memory.allRendererRssMiB).toBe(2548);
  expect(parseRendererMemory('40 2097152', 41).rssMiB).toBeNull();
  expect(() => parseRendererMemory('41 NaN', 41)).toThrow();
  expect(() => parseRendererMemory('41 12\n41 14', 41)).toThrow();
});
