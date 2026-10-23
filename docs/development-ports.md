# Local app ports

These defaults were selected on 2026-10-21 so the three apps can run together
at predictable addresses.

| App | Checkout under `~/gh/` | Default address | Mnemonic |
| --- | --- | --- | --- |
| 0SFS | `0sfs/fly` | `http://localhost:7470/fly/` (controller: `/rc/`) | 747 plus zero, for aviation |
| UMN Tour | `UMN-VR/tour` | `http://localhost:8660/tour/` | U–M–N is 8–6–6 on a phone keypad, plus zero |
| FOSS Earth | `foss-earth/app` | `http://localhost:3600/app/` | 360 degrees, for the globe |

## Starting and overriding

Run `npm run dev` in each app's checkout. `npm run preview` serves its existing
production build on the same default port; run `npm run build` first when a
fresh build is needed.

Both commands use `strictPort: true`: an occupied port stops startup rather
than silently assigning the app another address. Dev and preview for the
same app therefore need different ports if run together. An explicit
override remains supported, for example in `0sfs/fly`:

```sh
npm run dev -- --port 7471
npm run preview -- --port 7472
npm run dev:lan -- --port 7471
```

The 0SFS `dev:lan` launcher also defaults to `7470`. It supplies the chosen
port to Vite and to the phone-controller invitation URL. Its default and the
one in `vite.config.ts` must stay in sync.

Restart an existing server to use the new defaults. A server launched with
an explicit `--port` keeps that override.

## Phones and saved browser data

`npm run dev -- --host` enables LAN access and the existing shared HTTPS
plugin in all three apps. Use the HTTPS address Vite prints on a phone and
accept the self-signed certificate warning once. 0SFS also has the explicit
`npm run dev:lan` launcher. These commands keep the app's assigned port.

The browser's origin includes the scheme, hostname and port. Settings and
API keys saved at `localhost:5173` are not automatically available at the new
address. The old saved data remains on the old origin; changing ports does
not migrate or erase it. `localhost`, `127.0.0.1` and a LAN IP also have
separate origins.

## Implementation and retained validation

Each app's `vite.config.ts` sets both `server.port` and `preview.port`, with
`strictPort: true` for each. The 0SFS LAN launcher is
`0sfs/fly/scripts/dev-lan.mjs`. All three READMEs, 0SFS's development guide,
and FOSS Earth's headset-check usage example were updated to the matching
addresses; tour examples use `8660` even when run from the Earth checkout.

Validation completed on 2026-10-21:

- Loaded each actual config with Vite's `resolveConfig` and the native loader;
  verified its dev/preview port, strict-port settings and explicit overrides.
- `npm run typecheck` passed in `0sfs/fly` and `foss-earth/app`.
- Targeted ESLint passed for the changed Vite configs and launcher/usage scripts.
- `node --check` passed for the LAN launcher and headset-check script.
- In `UMN-VR/tour`, `npm run test:changed -- vite.config.ts` found no related
  tests and exited successfully. The required `npm run ci` passed: lint,
  74 tests passed and 1 skipped, fixed-height checks, typechecks and production build.
- `git diff --check` passed in all three app repositories.

Verification loaded configuration without starting an app server. Live
port binding and phone access were not exercised for this change.

The changes are saved in the local working trees; no commits, pushes or
deploys were made for this task. Other work is present in the 0SFS and Earth
working trees, including a separate change elsewhere in 0SFS's README.
Preserve it and stage only the port-related files or hunks if committing.
