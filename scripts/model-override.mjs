#!/usr/bin/env node
// Collects models for the dev server's `?modelOverride=<set>` (src/flight/aircraft/devModelOverride.ts).
//
//   node scripts/model-override.mjs <set> <asset-path>[=<file>] ...
//
// Each asset path is one the catalog loads, as public/ serves it, such as
// aircraft/f-35b/F-35B_AF267-airframe.glb. Its file (by default the one public/
// serves now) is copied into build/model-overrides/<set>/ under the same path and
// recorded in that set's manifest.json, so a later build that replaces the
// public file leaves the set as it was. Everything stays in the gitignored build/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [set, ...entries] = process.argv.slice(2);
if (!set || !/^[\w.-]+$/.test(set) || !entries.length) {
  console.error("Usage: node scripts/model-override.mjs <set> <asset-path>[=<file>] ...");
  process.exit(2);
}
const directory = path.join(root, "build", "model-overrides", set);
const manifestPath = path.join(directory, "manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { schema: "0sfs-model-override/1", assets: {} };

for (const entry of entries) {
  const [assetPath, file = path.join(root, "public", entry)] = entry.split("=");
  if (path.isAbsolute(assetPath) || assetPath.split("/").includes("..")) throw new Error(`Not a public asset path: ${assetPath}`);
  const source = path.resolve(file);
  const bytes = readFileSync(source);
  const target = path.join(directory, assetPath);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  manifest.assets[assetPath] = {
    file: assetPath,
    from: path.relative(root, source),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    copied: new Date().toISOString(),
  };
  console.log(`${set}: ${assetPath} <- ${path.relative(root, source)}`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Open the dev server with ?modelOverride=${set}`);
