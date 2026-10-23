import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/** Value imports and re-exports. Type-only imports are erased and fetch nothing. */
function staticPackageImport(text: string): boolean {
  const stripped = text.replace(/import\s+type\s+[^;]*;/g, "");
  return /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;\n]*["']@0sfs\/(?:multiplayer|anti-cheat)(?:\/|["'])/.test(stripped);
}

describe("multiplayer startup", () => {
  it("does not put multiplayer or anti-cheat on the flight startup graph", () => {
    const offenders = sources(SRC)
      .filter(file => !file.endsWith("multiplayerStartup.test.ts"))
      .filter(file => staticPackageImport(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
