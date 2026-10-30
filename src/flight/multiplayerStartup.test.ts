import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

/**
 * The transport-free world: messages, poses and the bullet and missile
 * integrators. Offline weapons fly on it, so it may load with the flight.
 * Sessions, transports and anti-cheat wait for the Multiplayer tab.
 */
const OFFLINE_WORLD = new Set([
  "@0sfs/multiplayer/ballistics",
  "@0sfs/multiplayer/geodetic",
  "@0sfs/multiplayer/guidance",
  "@0sfs/multiplayer/posePlayout",
  "@0sfs/multiplayer/protocol",
  "@0sfs/multiplayer/sessionWorld",
  "@0sfs/multiplayer/sharedSettings",
]);

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
function packageImports(text: string): string[] {
  const stripped = text.replace(/import\s+type\s+[^;]*;/g, "");
  return [...stripped.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s*)?["'](@0sfs\/(?:multiplayer|anti-cheat)(?:\/[^"']*)?)["']/g)]
    .map(match => match[1]);
}

describe("multiplayer startup", () => {
  it("does not put a session, transport or anti-cheat on the flight startup graph", () => {
    const offenders = startupSources(path.join(SRC, "flight/createFlightSimApp.ts"))
      .flatMap(file => packageImports(readFileSync(file, "utf8"))
        .filter(specifier => !OFFLINE_WORLD.has(specifier))
        .map(specifier => `${path.relative(SRC, file)} imports ${specifier}`));
    expect(offenders).toEqual([]);
  });

  it("keeps the offline world free of transports", () => {
    const root = path.resolve(SRC, "../../multiplayer/src");
    for (const specifier of OFFLINE_WORLD) {
      const file = path.join(root, `${specifier.slice("@0sfs/multiplayer/".length)}.ts`);
      const text = readFileSync(file, "utf8").replace(/import\s+type\s+[^;]*;/g, "");
      const imports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/g)]
        .map(match => match[1]);
      expect(imports.filter(target => !OFFLINE_WORLD.has(`@0sfs/multiplayer/${target.replace(/^\.\//, "")}`)), specifier).toEqual([]);
    }
  });
});
