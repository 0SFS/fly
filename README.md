# 0SFS fly

The 0SFS flight simulator app. It serves the simulator at `/fly/` and the phone controller at `/rc/`.

Aircraft, engines, and features live in the sibling repositories (`aircraft`, `C172`, `SF-50`, `F-35B`, `engines`, `F135`, `FJ33`, `IO320`, `sound`, `rc`, and the others). This app depends on them with `file:` links and runs their tests. Documentation is in the `docs` repository. The site's landing page, its build and its deploy to GitHub Pages are in [0sfs.github.io](https://github.com/0SFS/0SFS.github.io).

## Run it locally

From this directory, with the FOSS Earth and gamepad-tools checkouts beside the 0SFS organization as `package.json` describes ([Development](docs/development.md) has the layout):

```sh
npm install
npm run dev
```

Open the URL Vite prints and add `/fly/` for the simulator or `/rc/` for the phone controller. For example, `http://127.0.0.1:5173/fly/`. The server's `/` goes to `/fly/`: the landing page is the website's, and its README shows how to build and preview the whole site.

For a phone on the same network, use `npm run dev -- --host`. The server then uses HTTPS with a self-signed certificate. The browser warns once per address; in Chrome, tap Advanced, then Proceed. After that the page is secure and can use WebGPU. A plain `http://` network address can't. `FOSS_EARTH_DEV_HTTPS=off` keeps http.

To use Google Photorealistic 3D Tiles, add `?key=YOUR_GOOGLE_MAPS_API_KEY` once. The key is saved in the browser and removed from the URL. JSBSim comes from the tarball in `deps/`.

Open **+ → Browser data** to review clearing this site's saved settings, window layout and caches. **Keep API keys** starts checked. The phone controller has the same review. After two failed or stalled starts, the page offers that review before the app loads. Nothing is deleted until you confirm.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` runs this app's tests and the tests in the linked packages. `npm run build` checks the JSBSim, audio, exhaust, and engine artifacts, then builds `/fly/` and `/rc/` into `dist/`, which the website's build serves under its landing page.

## Community

- [Code of conduct](https://github.com/0SFS/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/0SFS/.github/blob/main/CONTRIBUTING.md)
- [License](LICENSE)
- [Security](https://github.com/0SFS/.github/blob/main/SECURITY.md)
