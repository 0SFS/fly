// Runs this audit's measurements with fly's own Vite setup, limited to this
// folder. From the fly checkout:
//
//   npx vitest run --configLoader native --config docs/performance/2026-11-05/harness/vitest.config.ts
//
// Results are appended to build/perf-20261105/results.jsonl (ignored).
// Set COUNT_INVOKES=1 to count Emscripten exception trampolines; counting
// adds work, so step times from that run are not comparable.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fly = path.resolve(here, "../../../..");
const harness = { dir: here, include: ["**/*.perf.ts"], testTimeout: 600_000, maxWorkers: 1 };

async function config() {
  try {
    const base = (await import(path.join(fly, "vite.config.ts"))).default;
    return { ...base, root: fly, test: { ...base.test, ...harness } };
  } catch (error) {
    // A checkout whose FOSS Earth packages are not built cannot load fly's
    // config. The measurements need only source resolution, so fall back to it.
    console.warn(`fly's vite.config.ts did not load (${String(error)}); using a reduced config.`);
    const { defaultClientConditions, defaultServerConditions } = await import("vite");
    const gamepadTools = path.resolve(fly, "../../Felipegalind0/gamepad-tools/src");
    return {
      root: fly,
      resolve: {
        conditions: ["source", ...defaultClientConditions],
        alias: [
          { find: /^@felipegalind0\/gamepad-tools\/(core|browser|viewer|ui)$/, replacement: `${gamepadTools}/$1/index.ts` },
          { find: /^@felipegalind0\/gamepad-tools$/, replacement: `${gamepadTools}/index.ts` },
        ],
      },
      ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
      test: { ...harness, server: { deps: { inline: [/@0sfs\//, /foss-earth\//, /@foss-earth\//] } } },
    };
  }
}

export default await config();
