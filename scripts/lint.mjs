#!/usr/bin/env node
// Lints fly and the linked @0sfs packages with fly's ESLint config.
// The config is loaded with the organization folder as its base, so package
// sources outside fly are not ignored as external.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fly = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const org = path.resolve(fly, "..");
const manifest = JSON.parse(readFileSync(path.join(fly, "package.json"), "utf8"));
const dirs = [path.join(fly, "src"), path.join(fly, "scripts")];
for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
  if (!name.startsWith("@0sfs/") || !spec.startsWith("file:")) continue;
  const root = path.resolve(fly, spec.slice("file:".length));
  for (const sub of ["src", "tests"]) {
    const dir = path.join(root, sub);
    if (existsSync(dir)) dirs.push(dir);
  }
}
const result = spawnSync(process.execPath, [
  path.join(fly, "node_modules/eslint/bin/eslint.js"),
  "--config", path.join(fly, "eslint.config.js"),
  "--cache", "--cache-strategy", "content",
  "--cache-location", path.join(fly, "node_modules/.cache/eslint/"),
  ...dirs,
], { cwd: org, stdio: "inherit" });
process.exit(result.status ?? 1);
