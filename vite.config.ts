import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultClientConditions, defaultServerConditions, type Plugin } from 'vite'
import { babylonBarrels, babylonShaderChunks, builtFrom, crossOriginIsolation, deployedIsolation, headsetEmulator, localSource, networkHttps } from 'foss-earth/vite'
import { appFiles, bootTerminal, browserRecovery } from '@foss-earth/ui/vite'
import { findLanAddress } from './scripts/dev-lan.mjs'
import { linkPackPublicFiles } from './scripts/link-packs.mjs'
import { pageHtmlFor } from './scripts/pages-html.mjs'

/**
 * The dev server stamps `?v=<optimizer hash>` on a bare import of a linked
 * checkout's file, and not on a relative import of the same file. The browser
 * then evaluates that file twice, and its state splits: the fleet filled one
 * aircraft catalog while the flight read the other, still empty one. Linked
 * source files keep one URL here, without the stamp.
 */
function oneUrlPerSourceFile(): Plugin {
  return {
    name: 'osfs-one-url-per-source-file',
    apply: 'serve',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!/^[\w@]/.test(id) || id.includes(':')) return null
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external) return resolved
      const [file, query] = resolved.id.split('?', 2)
      if (!query || !path.isAbsolute(file) || file.includes('/node_modules/')) return resolved
      const params = new URLSearchParams(query)
      if (!params.has('v')) return resolved
      params.delete('v')
      const rest = params.toString()
      return { ...resolved, id: rest ? `${file}?${rest}` : file }
    },
  }
}

/**
 * public/.gitignore lists the linked package files for this repository's git.
 * In a published site it would keep those same files out of the commit that
 * deploys them.
 */
function dropLinkList(): Plugin {
  let outDir = 'dist'
  return {
    name: 'osfs-drop-link-list',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      rmSync(path.join(outDir, '.gitignore'), { force: true })
    },
  }
}

/** GitHub Pages has no SPA fallback; /fly/ and /rc/ must be real files. */
function copyIndexToPagesPaths(): Plugin {
  let outDir = 'dist'
  return {
    name: 'copy-index-to-pages-paths',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const index = path.join(outDir, 'index.html')
      if (!existsSync(index)) return
      const html = readFileSync(index, 'utf8')
      for (const dir of ['fly', 'rc'] as const) {
        mkdirSync(path.join(outDir, dir), { recursive: true })
        writeFileSync(path.join(outDir, dir, 'index.html'), pageHtmlFor(dir, html))
      }
    },
  }
}

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
// A `<owner>.github.io` repository is served from the domain root; any other
// repository is served from `/<repository>/`.
const isRootPagesSite = repositoryName?.endsWith('.github.io') ?? false
const base = process.env.GITHUB_ACTIONS && repositoryName && !isRootPagesSite ? `/${repositoryName}/` : '/'

function getGitOutput(command: string): string | null {
  try {
    return execSync(command, { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function getRepositorySlug(): string {
  const envRepository = process.env.GITHUB_REPOSITORY?.trim()
  if (envRepository) return envRepository

  const remoteUrl = getGitOutput('git config --get remote.origin.url') ?? ''
  const githubMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+)$/)
  return githubMatch?.[1].replace(/\.git$/, '') ?? ''
}

const sourceCommit = getGitOutput('git rev-parse --short=12 HEAD') ?? 'unknown'
const sourceDirty = Boolean(getGitOutput('git status --short'))
const sourceVersion = `${sourceCommit}${sourceDirty ? '-dirty' : ''}`

/**
 * Tells the page which address other devices can reach this dev server on.
 *
 * A browser cannot discover its own LAN address — WebRTC stopped handing that
 * out years ago — but the dev server knows it. The phone controller QR needs
 * it, because a QR pointing at `localhost` is unreachable from a phone.
 *
 * Injected only when the server is actually bound to something other than
 * loopback, so the QR never advertises an address nothing is listening on.
 */
function lanOriginPlugin(): Plugin {
  let origin: string | null = null
  return {
    name: 'osfs-lan-origin',
    apply: 'serve',
    configureServer(server) {
      const publish = () => {
        const address = server.httpServer?.address()
        if (!address || typeof address === 'string') return
        const bound = address.address
        const loopback = bound === '127.0.0.1' || bound === '::1' || bound === 'localhost'
        if (loopback) return
        // `0.0.0.0`/`::` means every interface; pick the routable one.
        const host = bound === '0.0.0.0' || bound === '::' ? findLanAddress()?.address : bound
        if (!host) return
        origin = `${server.config.server.https ? 'https' : 'http'}://${host}:${address.port}`
      }
      server.httpServer?.once('listening', publish)
    },
    transformIndexHtml() {
      if (!origin) return
      return [{
        tag: 'script',
        injectTo: 'head-prepend' as const,
        children: `window.__OSFS_LAN_ORIGIN__=${JSON.stringify(origin)}`,
      }]
    },
  }
}

/**
 * The engine comes as a packed tarball, whose package.json names no commit;
 * its build metadata records the fork's, which About shows with the rest of
 * what the app is built from.
 */
function jsbsimBuild({ name, dir }: { name: string; dir: string }) {
  if (name !== '@felipegalind0/jsbsim') return undefined
  try {
    const { identity } = JSON.parse(readFileSync(path.join(dir, 'dist/build-metadata.json'), 'utf8'))
    const native = identity?.native
    if (typeof native?.commit !== 'string') return undefined
    return { commit: native.commit, dirty: native.dirty === true, ...(typeof native.origin === 'string' ? { repository: native.origin.replace(/\.git$/, '') } : {}) }
  } catch {
    // No metadata: About gives the package's version alone.
    return undefined
  }
}

/** Vitest include globs for each linked @0sfs package's tests. Paths are real, not through node_modules. */
function linkedPackageTests(): string[] {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> }
  return Object.entries(manifest.dependencies ?? {}).flatMap(([name, spec]) => {
    if (!name.startsWith('@0sfs/') || !spec.startsWith('file:')) return []
    const repo = spec.slice('file:'.length)
    return [`${repo}/tests/**/*.test.ts`, `${repo}/tests/**/*.test.tsx`, `${repo}/src/**/*.test.ts`, `${repo}/src/**/*.test.tsx`]
  })
}

// https://vite.dev/config/
export default defineConfig({
  base,
  server: {
    port: 7470,
    strictPort: true,
    fs: { allow: ['.', '..', '../../foss-earth', '../../Felipegalind0/gamepad-tools'] },
    // `scripts/dev-lan.mjs` supplies these so a phone gets a secure context on
    // the LAN; `crypto.randomUUID` and the wake lock need one. Plain `npm run
    // dev` uses the shared networkHttps certificate instead.
    ...(process.env.DEV_TLS_CERT && process.env.DEV_TLS_KEY
      ? { https: { cert: readFileSync(process.env.DEV_TLS_CERT), key: readFileSync(process.env.DEV_TLS_KEY) } }
      : {}),
  },
  preview: { port: 7470, strictPort: true },
  resolve: {
    dedupe: ['@babylonjs/core', '@babylonjs/loaders', '3d-tiles-renderer', 'react', 'react-dom'],
    // FOSS Earth is linked from its checkout beside this organization's and used from
    // source, as its own app uses its libraries: "source" selects their TypeScript
    // entry points, and localSource() watches them and shares Earth's node_modules.
    conditions: ['source', ...defaultClientConditions],
    preserveSymlinks: true,
  },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  optimizeDeps: {
    // /fly/ and /rc/ share this entry. Other HTML files are retained research
    // or scratch checkouts, not additional application entry points.
    entries: ['index.html'],
    // Lazy flight/globe/phone modules reveal these only after the initial scan.
    // Prepare them together so opening the app does not trigger reload rounds.
    include: [
      '3d-tiles-renderer/babylonjs',
      '3d-tiles-renderer/core/plugins',
      '@babylonjs/loaders/glTF',
      '@babylonjs/core/Collisions/collisionCoordinator.js',
      '@babylonjs/core/Engines/Extensions/engine.query.js',
      '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture.js',
      '@babylonjs/core/Engines/WebGPU/webgpuCacheBindGroups.js',
      '@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipelineTree.js',
      '@babylonjs/core/Rendering/depthRendererSceneComponent',
      '@babylonjs/core/Rendering/edgesRenderer.js',
      '@babylonjs/core/ShadersWGSL/ShadersInclude/helperFunctions',
      '@babylonjs/core/ShadersWGSL/ShadersInclude/imageProcessingDeclaration',
      '@babylonjs/core/ShadersWGSL/ShadersInclude/imageProcessingFunctions',
      '@babylonjs/core/Shaders/ShadersInclude/helperFunctions',
      '@babylonjs/core/Shaders/ShadersInclude/imageProcessingDeclaration',
      '@babylonjs/core/Shaders/ShadersInclude/imageProcessingFunctions',
      '@babylonjs/core/Materials/PBR/pbrMaterial.js',
      '@babylonjs/core/Materials/Textures/texture.js',
      '@babylonjs/core/Materials/material.js',
      '@babylonjs/core/Maths/math.color.js',
      '@babylonjs/core/Maths/math.vector.js',
      '@babylonjs/core/Meshes/mesh.js',
      '@babylonjs/core/Meshes/mesh.vertexData.js',
      '@babylonjs/core/Meshes/transformNode.js',
      '@babylonjs/core/assetContainer.js',
      'peerjs',
      'qrcode',
    ],
    exclude: ['@felipegalind0/jsbsim'],
  },
  assetsInclude: ['**/*.wasm'],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __SOURCE_VERSION__: JSON.stringify(sourceVersion),
    __REPOSITORY_SLUG__: JSON.stringify(getRepositorySlug()),
  },
  // Each page says what it is built from, for the About tab, which /fly/ and /rc/ copy with it.
  // The flight loads the globe lazily, so Babylon's shaders would otherwise be hundreds of chunks.
  // The boot terminal follows the flight's own chunk too, which the page imports lazily and needs before its first frame.
  // It shows on the flight's page only; the test pages under src/ have no boot to show.
  plugins: [
    // Off unless FOSS_EARTH_ISOLATION asks: a threaded WebAssembly core needs an isolated page.
    crossOriginIsolation(),
    // Dev defaults to LAN HTTPS and prints a QR for the flight page.
    networkHttps({ path: "/fly/" }),
    // GitHub Pages sends no such headers, so in a build a service worker adds them, and each page, /fly/ and /rc/
    // copied with it, starts with the script that asks for it (FOSS Earth's docs/docs/proposals/webassembly.md,
    // step 3). The worker keeps none of the flight's files. FOSS_EARTH_ISOLATION=report-only or off at build time
    // changes what it may do.
    appFiles({ keepFiles: false, isolation: deployedIsolation(), cacheNamespace: '0sfs-app-files' }),
    bootTerminal({ title: '0SFS · Open Source Flight Simulator', theme: 'dark', waitFor: ['src/flight/createFlightSimApp.ts'], pages: page => page === '/index.html' }),
    browserRecovery({ appId: '0sfs' }),
    oneUrlPerSourceFile(),
    localSource(),
    localSource({ root: import.meta.dirname }),
    { name: 'osfs-link-packs', config: () => { linkPackPublicFiles(import.meta.dirname) } },
    dropLinkList(),
    react(), copyIndexToPagesPaths(), lanOriginPlugin(), builtFrom({ describe: jsbsimBuild }), babylonBarrels(), babylonShaderChunks(),
    // npm run dev only: a page opened with ?headsetEmulator=quest3 gets an emulated VR headset (FOSS Earth's docs/agent-testing.md).
    headsetEmulator(),
  ],
  test: {
    maxWorkers: '50%',
    // Tests read the JSBSim data and the aircraft assets from disk, not
    // through imports, so `vitest related` and `--changed` cannot see which
    // tests use them and would select none. A change there runs every test.
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, '**/public/jsbsim-data/**', '**/public/aircraft/**', '**/deps/*.tgz'],
    // `build/` holds gitignored validation sandboxes, some of which symlink to
    // sibling packages. App-managed worktrees hold other checkouts too.
    // Collecting those runs another package's tests under
    // this config and fails on environment it never opted into.
    exclude: [...configDefaults.exclude, 'build/**', '.delta/**'],
    // The aircraft catalog is filled by the fleet fly assembles; tests read it as the app does.
    setupFiles: ['./src/flight/aircraft/fleet.ts'],
    // FOSS Earth and its libraries are TypeScript source, so they go through the transform too;
    // gamepad-tools ships a stylesheet the flight imports. The JSBSim engine stays external:
    // transformed, its Emscripten loader would ask Node to import an http: URL.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{ts,tsx,js,mjs}',
      'benchmarks/**/*.{test,spec}.{ts,tsx,js,mjs}',
      // Phase 3 moved some scripts and benchmarks into their owning repos.
      '../{F135,exhaust,fuel,sound,SF-50,F-35B,aircraft,rc,research,ground-contact}/scripts/**/*.{test,spec}.{ts,tsx,js,mjs}',
      '../sound/benchmarks/**/*.{test,spec}.{ts,tsx,js,mjs}',
      ...linkedPackageTests(),
    ],
    server: { deps: { inline: [/3d-tiles-renderer\//, /foss-earth\//, /@foss-earth\//, /@felipegalind0\/gamepad-tools\//, /@0sfs\//] } },
  },
})
