const SITE_URL = "https://0sfs.github.io/";
/** The files the boot terminal fetches at once, in its graph in the built page (@foss-earth/ui's bootTerminal). */
const BOOT_PRELOAD = /,"preload":\[[^\]]*\]/;

/**
 * The home page's built index.html, retagged for /fly/ or /rc/. Only the home page
 * carries the WebSite data, /fly/ is its own search result, and /rc/ is kept out of
 * search: see docs/search-visibility.md.
 *
 * @param {"fly" | "rc"} route
 * @param {string} html
 * @returns {string}
 */
export function pageHtmlFor(route, html) {
  const title = route === "fly" ? "Fly — 0SFS" : "0SFS RC — Phone Controller";
  const url = `${SITE_URL}${route}/`;
  /** @type {Array<[RegExp, string]>} */
  const replacements = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    [/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`],
    [/(<meta property="og:url" content=")[^"]*"/, `$1${url}"`],
    [/\n\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, ""],
    route === "fly"
      ? [/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`]
      : [/<link rel="canonical" href="[^"]*" ?\/?>/, '<meta name="robots" content="noindex" />'],
  ];
  const page = replacements.reduce((page, [pattern, replacement]) => {
    if (!pattern.test(page)) throw new Error(`index.html has no match for ${pattern} to retag for /${route}/`);
    return page.replace(pattern, replacement);
  }, html);
  // The boot terminal fetches the flight's lazy modules at once (vite.config.ts, waitFor), which the controller never runs.
  return route === "rc" ? page.replace(BOOT_PRELOAD, "") : page;
}
