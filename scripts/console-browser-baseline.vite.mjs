/** Comparison build: same app/kernel fixes, with inherited globe resource defaults. */
import { mergeConfig } from 'vite';
import config from '../vite.config.ts';

export default mergeConfig(config, {
  plugins: [{
    name: 'compare-inherited-flight-resource-defaults',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('/src/flight/settings/flightResourceDefaults.ts')) return;
      return `export function applyFlightResourceDefaults(settings) {
        return Object.fromEntries([
          'map.source.elevation', 'map.terrain.tileSegments', 'map.imagery.gpuBudget',
          'map.imagery.pageTablePatches', 'map.terrain.maxTiles', 'map.terrain.cachedTiles',
          'wasm.core.terrain', 'wasm.workers', 'wasm.threads', 'map.loader.requests', 'map.loader.cacheEntries',
        ].map(id => [id, settings.get(id)]));
      }`;
    },
  }],
});
