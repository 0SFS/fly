const SITE_URL = "https://0sfs.github.io/";
/** The files the boot terminal fetches at once, in its graph in the built page (@foss-earth/ui's bootTerminal). */
const BOOT_PRELOAD = /,"preload":\[[^\]]*\]/;

const TITLES = { fly: "Fly — 0SFS", rc: "0SFS RC — Phone Controller", replay: "Flight replay — 0SFS" };
const REPLAY_DESCRIPTION = "Replays of real flights from public ADS-B data, over real-world scenery in a browser tab, from 0SFS, the free, open-source flight simulator.";

/**
 * The home page's built index.html, retagged for /fly/, /rc/ or /replay/. Only
 * the home page carries the WebSite data, /fly/ and /replay/ are their own search
 * results, and /rc/ is kept out of search: see docs/search-visibility.md.
 *
 * @param {"fly" | "rc" | "replay"} route
 * @param {string} html
 * @returns {string}
 */
export function pageHtmlFor(route, html) {
  const title = TITLES[route];
  const url = `${SITE_URL}${route}/`;
  /** @type {Array<[RegExp, string]>} */
  const replacements = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    [/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`],
    [/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`],
    [/\n\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, ""],
    route === "rc"
      ? [/<link rel="canonical" href="[^"]*" ?\/?>/, '<meta name="robots" content="noindex" />']
      : [/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`],
    ...route === "replay" ? /** @type {Array<[RegExp, string]>} */ ([
      [/(<meta name="description" content=")[^"]*"/, `$1${REPLAY_DESCRIPTION}"`],
      [/(<meta property="og:description" content=")[^"]*"/, `$1${REPLAY_DESCRIPTION}"`],
    ]) : [],
  ];
  const page = replacements.reduce((page, [pattern, replacement]) => {
    if (!pattern.test(page)) throw new Error(`index.html has no match for ${pattern} to retag for /${route}/`);
    return page.replace(pattern, replacement);
  }, html);
  // The boot terminal fetches the flight's lazy modules at once (vite.config.ts, waitFor), which the controller and the replay never run.
  return route === "fly" ? page : page.replace(BOOT_PRELOAD, "");
}
