# 0SFS fly

The 0SFS flight simulator app. It serves the simulator at `/fly/` and the phone controller at `/rc/`.

Aircraft, engines, and features live in the sibling repositories (`aircraft`, `C172`, `SF-50`, `F-35B`, `engines`, `F135`, `FJ33`, `IO320`, `sound`, `rc`, and the others). This app depends on them with `file:` links and runs their tests. Development, ports, benchmarks, bug reporting and performance sessions are in this repository's [docs/](docs/): [Development](docs/development.md), [local app ports](docs/development-ports.md), [benchmark routes](docs/benchmark-routes.md), [bug reporting](docs/bug-reporting.md), and the [performance sessions](docs/performance/2026-10-27/session-handoff.md). Cross-repo proposals and split status are in the [docs repository](https://github.com/0SFS/docs). The site's landing page, its build and its deploy to GitHub Pages are in [0sfs.github.io](https://github.com/0SFS/0SFS.github.io). `npm run deploy` here publishes a new flight and phone controller to the site, keeping its landing page; [Deploying](https://github.com/0SFS/0SFS.github.io/blob/main/docs/deploying.md) has the details.

Fresh flights start without external fuel tanks. Install them in the Fuel tab when needed; resuming a saved flight restores its selected attachments.

## Run it locally

From this directory, with the FOSS Earth and gamepad-tools checkouts beside the 0SFS organization as `package.json` describes ([Development](docs/development.md) has the layout):

```sh
npm install
npm run dev
```

Open the URL Vite prints and add `/fly/` for the simulator or `/rc/` for the phone controller. For example, `https://127.0.0.1:7470/fly/`. The server's `/` goes to `/fly/`: the landing page is the website's, and its README shows how to build and preview the whole site.

Development and preview default to port `7470` and stop if it is occupied. Use `-- --port <number>` to choose another port explicitly.

[Local app ports](docs/development-ports.md) records all three apps' assignments,
override commands, browser-storage implications and validation results.

`npm run dev` listens on the network by default and prints a network URL and QR code to `/fly/`. The server uses HTTPS with a self-signed certificate. The browser warns once per address; in Chrome, tap Advanced, then Proceed. After that the page is secure and can use WebGPU. A plain `http://` network address can't. `FOSS_EARTH_DEV_HTTPS=off` keeps http.

For local-only development use `npm run dev -- --host localhost`. HTTPS setup
requires `openssl`; startup fails clearly if a certificate cannot be created.

Use `npm run llm-dev` for automated checks, or `npm run dev -- --no-qr`,
to omit QR art while keeping HTTPS and network links.
The `--` passes the flag through npm. Other Vite options still work, for example
`npm run llm-dev -- --port 9000`.

Normal `npm run dev` also reads `GOOGLE_3D_TILES_KEY` from the environment or
`.env.local` (this app first, then the linked FOSS Earth app). It appends
`?gkey=YOUR_GOOGLE_MAPS_API_KEY` to the printed startup URLs and the QR code.
Opening the link saves the key on that device and removes it from the address
bar. Use `npm run dev -- --no-gkey` to omit the key (`--no-key` also works).
`npm run llm-dev` omits both the key and QR output.

Manual `?gkey=YOUR_GOOGLE_MAPS_API_KEY` links save a key on the device and remove
it from the address bar. Existing `?key=` / `?googleKey=` links and saved keys
still work; `gkey` takes precedence. Existing `FOSS_EARTH_GOOGLE_KEY` environment
setups are accepted as a legacy fallback.

QR codes appear automatically in interactive terminals and are omitted from
captured output and CI logs. `FOSS_EARTH_DEV_QR=on npm run dev` forces a QR when
output is redirected; `--no-qr` takes precedence. Agents stop their temporary
servers after checking; to test a change yourself, run `npm run dev` in this
repo in your own terminal.

To use Google Photorealistic 3D Tiles, add `?gkey=YOUR_GOOGLE_MAPS_API_KEY` once. The key is saved in the browser and removed from the URL. JSBSim comes from the tarball in `deps/`.

To fly an aircraft with other models than the ones `public/` serves, for example to compare a model change, copy them into an override set and open the dev server with `?modelOverride=<set>`. The set keeps each file under the path the catalog loads it from, so it can stand for the airframe, the installed engine and the test-stand engine at once:

```sh
npm run model-override -- before-closeout aircraft/f-35b/F-35B_AF267-airframe.glb aircraft/f-35b/engine/F135-PW-600-installed.glb
npm run model-override -- candidate aircraft/f-35b/F-35B_AF267-airframe.glb=../F135/build/candidate/airframe.glb
```

The first copies the files `public/` serves now. The second takes `<asset-path>=<file>` and copies another file in its place. The sets and their `manifest.json` are kept in the ignored `build/model-overrides/`, so a later build that replaces a public file leaves them unchanged. `https://127.0.0.1:7470/fly/?modelOverride=before-closeout` then loads every asset the set lists from the set and every other asset as usual, in the flight view and on the engine test stand, and the flight log records each substitution. A set that cannot be read fails the aircraft's load. A production build ignores the parameter.

Open **+ → Browser data** to review clearing this site's saved settings, window layout and caches. **Keep API keys** starts checked. The phone controller has the same review. After two failed or stalled starts, the page offers that review before the app loads. Nothing is deleted until you confirm.

## Map outage testing

On the dev server, open `/fly/?mapSource=google&googleTilesFault=403` to simulate
Google rejecting tile requests without using a real key. `429`, `503`, `offline`
and `timeout` cover other failures. Add `&mapRecovery=off` to compare the original
startup failure. Production builds ignore these switches.

[Outage recovery and test cases](docs/proposals/google-tiles-outage-recovery.md)
describes the backup preparation, Google retry and automated checks.

## Multiplayer local preview

Open **+ → Multiplayer → Host flight**, copy the invitation, and open it in a
second browser or device. Press **Join flight** there. The invitation admits
one guest and expires after two minutes. The guest arrives paused beside the
host; press Resume to fly. Use the network address printed by `npm run dev`
when sharing with another device.

Host flight connects two pilots through PeerJS Cloud and a direct WebRTC
aircraft channel. Host on server connects each pilot to a flight server. From
a checkout beside `multiplayer` and `anti-cheat`:

```sh
cd ~/gh/0sfs/multiplayer-server && npm install && npm start
```

Paste the printed address and certificate hash into Multiplayer, then Host on
server. The invitation admits guests until it expires or the flight reaches 16
pilots. The server drops a pose that fails the anti-cheat envelope and removes
a pilot after three failures. Local pause preserves the connection; disconnect
or an aircraft switch ends it. Multiplayer is off until Host/Join, and its
code loads with the tab. Shared weather, voice and hybrid mode are later work.

## Aircraft damage

Open **+ → Damage** for one 100-point health bar covering the entire aircraft.
Under **Test damage**, **Apply 25 damage** simulates a hit. At zero, flight
pauses and Resume stays blocked until **Repair aircraft** or a new flight.
Repair restores health without resuming. Partial damage leaves handling
unchanged. Gun hits and terrain impacts are not connected yet.

A connected pilot can see your reported health in Multiplayer, including
damage and repair while paused. Reloading or changing aircraft starts healthy;
health is not saved with a resumed flight. The [damage models](https://github.com/0SFS/docs/blob/main/proposals/aircraft-damage.md)
and [physical component design](https://github.com/0SFS/docs/blob/main/proposals/aircraft-damage-physical.md)
describe the separate implementations to compare and retain.

**+ → Shared settings** selects **Off / Health** for damage. Before connecting,
this is local; in multiplayer every pilot uses the host's accepted model and
version. Only the host may edit by default. The host can set **Settings editors
→ Everyone** to let guests request changes; permission changes always belong
to the host. Model changes reset health and pause both flights. Resume is
blocked until settings synchronize, then pilots resume manually. Older v1
multiplayer clients need to update. Component/physical models remain proposals.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` runs this app's tests and the tests in the linked packages. `npm run build` checks the JSBSim, audio, exhaust, and engine artifacts, then builds `/fly/` and `/rc/` into `dist/`, which the website's build serves under its landing page.

`npm run check:aircraft-ui` checks the aircraft picker at wide, narrow and short window sizes. `npm run check:aircraft-switch` runs the actual flight application, JSBSim and aircraft meshes in headless Chrome, checking switches, loading holds, failure recovery and saved selection. Both write reports and screenshots under ignored `build/` directories and require installed Chrome (`CHROME_BIN` can select its executable). The UI fixture alone does not validate aircraft activation.

[Aircraft switching](docs/aircraft-switching.md) records the settings-reset cause, runtime ownership, UI decisions and validation scope for future changes.

The [cockpit screen](docs/proposals/cockpit-screen.md) shows the flight's interface in the cockpit, and in a VR headset, which seats the pilot there. `npm run dev` gives a page opened with `?headsetEmulator=quest3` an emulated headset; [Testing as an agent](https://github.com/foss-earth/docs/blob/main/docs/agent-testing.md) has the rest.

## Performance work

Session notes are under [docs/performance/](docs/performance/). The latest
handoff is [2026-10-27](docs/performance/2026-10-27/session-handoff.md). Earlier
sessions are [2026-10-26](docs/performance/2026-10-26/session-handoff.md),
[2026-10-22](docs/performance/2026-10-22/session-handoff.md) and
[2026-10-21](docs/performance/2026-10-21/session-handoff.md). The
[2026-10-21 findings](docs/performance/2026-10-21/README.md) record the F-35 CPU
fixes, measurements, validation, repository boundaries, retained evidence and
independent implementation specifications.

## Community

- [Code of conduct](https://github.com/0SFS/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/0SFS/.github/blob/main/CONTRIBUTING.md)
- [License](LICENSE)
- [Security](https://github.com/0SFS/.github/blob/main/SECURITY.md)
