import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

function startupSources(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = readFileSync(file, "utf8").replace(/import\s+type\s+[^;]*;/g, "");
  // Follow value imports only. Dynamic imports remain the feature boundary.
  const imports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s*)?["'](\.[^"']+)["']/g)];
  return [file, ...imports.flatMap(match => {
    const base = path.resolve(path.dirname(file), match[1]);
    const target = [base, `${base}.ts`, `${base}.tsx`].find(candidate => /\.tsx?$/.test(candidate) && existsSync(candidate));
    return target ? startupSources(target, seen) : [];
  })];
}

/** Value imports and re-exports. Type-only imports are erased and fetch nothing. */
function staticPackageImport(text: string): boolean {
  const stripped = text.replace(/import\s+type\s+[^;]*;/g, "");
  return /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;\n]*["']@0sfs\/(?:multiplayer|anti-cheat)(?:\/|["'])/.test(stripped);
}

describe("multiplayer startup", () => {
  it("does not put multiplayer or anti-cheat on the flight startup graph", () => {
    const offenders = startupSources(path.join(SRC, "flight/createFlightSimApp.ts"))
      .filter(file => staticPackageImport(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
