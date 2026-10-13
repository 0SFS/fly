import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every page loads src/main.tsx and all it imports statically before it shows anything, and
 * /rc/ loads the phone controller's code; only the flight needs the engine. On 2026-10-08 one
 * import of `foss-earth/diagnostics`, which then also held the mesh inspector, put all of
 * Babylon into the code every page loads, and the bundler's handling of that broke every glTF
 * load in the built flight while every unit test passed.
 *
 * These tests read the sources from disk, so `vitest related` does not select them for a change
 * elsewhere; `npm run ci` runs them, and scripts/check-landing-page.mjs checks the built pages.
 */
const ENGINE = ["@babylonjs/core", "@babylonjs/loaders", "3d-tiles-renderer"];

function packageName(specifier: string): string {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

/** A package's target for the browser bundle, from its `exports` conditions. */
function exportTarget(target: unknown): string | null {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.map(exportTarget).find(Boolean) ?? null;
  if (!target || typeof target !== "object") return null;
  for (const condition of ["browser", "import", "module", "default"]) {
    const found = condition in target ? exportTarget((target as Record<string, unknown>)[condition]) : null;
    if (found) return found;
  }
  return null;
}

/**
 * The file a package import loads, found as Node finds the package, from the importing file
 * up, so every package is followed, the checkouts this app is built from and whatever they
 * become; null for one that cannot be read, such as a CommonJS package's dynamic parts.
 */
function resolvePackage(specifier: string, from: string): string | null {
  const name = packageName(specifier);
  let directory: string | null = null;
  for (let at = dirname(from); !directory; at = dirname(at)) {
    if (existsSync(join(at, "node_modules", name, "package.json"))) directory = join(at, "node_modules", name);
    else if (dirname(at) === at) break;
  }
  // Packages extracted beside this app have no node_modules of their own. The
  // flight and the phone page resolve their imports from this app, so follow
  // the same node_modules when the file itself sits outside it.
  if (!directory) {
    const appPackage = join(realpathSync("."), "node_modules", name);
    if (existsSync(join(appPackage, "package.json"))) directory = appPackage;
  }
  if (!directory) return null;
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { exports?: unknown; module?: string; main?: string };
  const subpath = "." + specifier.slice(name.length);
  const exports = manifest.exports;
  const target = exports === undefined ? (subpath === "." ? manifest.module ?? manifest.main ?? "index.js" : subpath)
    : typeof exports === "object" && exports !== null && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith("."))
      ? exportTarget((exports as Record<string, unknown>)[subpath])
      : subpath === "." ? exportTarget(exports) : null;
  if (!target) return null;
  const base = join(directory, target);
  const file = ["", ".js", ".mjs", "/index.js"].map((ending) => base + ending).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return file ? realpathSync(file) : null;
}

/**
 * The packages a module loads with everything it imports statically, each with the chain of
 * modules that reaches it first. `import type` and `export type` load nothing; an import that
 * names only types still loads its module, as `verbatimModuleSyntax` keeps it. A dynamic
 * `import()` loads later, and an import with a query brings a string or a chunk of its own, so
 * both are left out.
 */
function packagesLoadedBy(entry: string): Map<string, string[]> {
  const root = realpathSync(".");
  const start = realpathSync(entry);
  const reachedFrom = new Map<string, string | null>([[start, null]]);
  const packages = new Map<string, string[]>();
  const chain = (file: string): string[] => {
    const files: string[] = [];
    for (let at: string | null | undefined = file; at; at = reachedFrom.get(at)) files.unshift(relative(root, at));
    return files;
  };
  const queue = [start];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    for (const statement of source.statements) {
      const specifier = ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly ? statement.moduleSpecifier
        : ts.isExportDeclaration(statement) && !statement.isTypeOnly ? statement.moduleSpecifier : undefined;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const name = specifier.text;
      let target: string | undefined;
      if (name.includes("?")) {
        continue; // `?raw`, `?url` and `?worker` give a string or a chunk of its own, not the module's code
      } else if (name.startsWith(".")) {
        const base = join(dirname(file), name);
        target = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"].map((ending) => base + ending)
          .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
        // A broken path in a package is the package's business; in this app's or a checkout's sources it is a fault.
        if (!target && !file.includes(`${sep}node_modules${sep}`)) throw new Error(`${file} imports ${name}, which is not a file`);
        if (!target) continue;
      } else {
        if (!packages.has(packageName(name))) packages.set(packageName(name), chain(file));
        target = ENGINE.includes(packageName(name)) ? undefined : resolvePackage(name, file) ?? undefined;
        if (!target) continue;
      }
      if (/\.[mc]?[jt]sx?$/.test(target) && !reachedFrom.has(target)) {
        reachedFrom.set(target, file);
        queue.push(target);
      }
    }
  }
  return packages;
}

const engineLoadedBy = (entry: string) => Object.fromEntries([...packagesLoadedBy(entry)].filter(([name]) => ENGINE.includes(name)));

describe("what each page loads before it shows anything", () => {
  it("does not load the engine on any page", () => {
    expect(engineLoadedBy("src/main.tsx")).toEqual({});
  });

  it("does not load the engine for the phone controller", () => {
    expect(engineLoadedBy("../rc/src/createPhoneControllerApp.tsx")).toEqual({});
  });

  it("finds the engine where the flight loads it", () => {
    expect(Object.keys(engineLoadedBy("src/flight/createFlightSimApp.ts"))).toEqual(expect.arrayContaining(["@babylonjs/core"]));
  });
});
