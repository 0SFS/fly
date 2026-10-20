import { constants } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

/** Check every existing ancestor before creating anything or placing a key in a profile. */
export async function assertFlightProfilePath(root, candidate, { ignored = async (directory, cwd) => {
  try { await runFile("git", ["check-ignore", "--quiet", "--", directory], { cwd }); return true; }
  catch { return false; }
} } = {}) {
  const absoluteRoot = path.resolve(root), absolute = path.resolve(candidate);
  const relative = path.relative(path.join(absoluteRoot, "build"), absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Flight profile output must be inside the repository's ignored build/ directory.");
  }
  let ancestor = path.parse(absolute).root;
  for (const segment of absolute.slice(ancestor.length).split(path.sep)) {
    ancestor = path.join(ancestor, segment);
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error("Flight profile paths cannot use symbolic links."); }
    catch (error) { if (error.code === "ENOENT") break; throw error; }
  }
  if (await realpath(absoluteRoot) !== absoluteRoot || !await ignored(absolute, absoluteRoot)) {
    throw new Error("Flight profile output must remain in the real, gitignored build/ tree.");
  }
  return absolute;
}

export async function prepareFlightProfileOutput(root, requested) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = requested ? path.resolve(requested) : path.join(root, "build", "profile-flight", `${stamp}-${randomUUID().slice(0, 8)}`);
  await assertFlightProfilePath(root, directory);
  await mkdir(directory, { recursive: true });
  await assertFlightProfilePath(root, directory);
  return directory;
}

/** O_NOFOLLOW also refuses a pre-existing artifact symlink at the final component. */
export async function writeFlightProfileArtifact(root, file, contents) {
  await assertFlightProfilePath(root, file);
  await writeFile(file, contents, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW });
}

export function flightProfileOptions(argv) {
  const arg = (name, fallback) => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const route = arg("route", null);
  if (route !== null && route !== "cruise" && route !== "low") throw new Error("--route must be cruise or low.");
  const positive = (name, fallback, allowZero = false) => {
    const value = Number(arg(name, fallback));
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`--${name} must be a finite ${allowZero ? "non-negative" : "positive"} number.`);
    return value;
  };
  if (argv.includes("--headed") && argv.includes("--headless")) throw new Error("Choose --headed or --headless.");
  if (argv.includes("--build-only") && argv.includes("--no-build")) throw new Error("--build-only cannot be combined with --no-build.");
  if (route && (arg("seconds") !== undefined || arg("settle") !== undefined)) throw new Error("A benchmark route measures its full 180 simulated seconds; omit --seconds and --settle.");
  return { route, headed: !argv.includes("--headless") && (Boolean(route) || argv.includes("--headed")),
    seconds: route ? 180 : positive("seconds", "10"), settleSeconds: route ? 0 : positive("settle", "5", true),
    timeoutSeconds: positive("timeout", "600"),
  };
}

/** Read only the agreed variable, never a legacy key file or another env name. */
export async function flightGoogleKey({ env = process.env, files = [
  path.join(homedir(), "gh/foss-earth/app/.env.local"),
  path.join(homedir(), "gh/UMN-VR/tour/.env.local"),
  path.join(homedir(), "gh/0sfs/fly/.env.local"),
], read = readFile } = {}) {
  if (env.FOSS_EARTH_GOOGLE_KEY?.trim()) return env.FOSS_EARTH_GOOGLE_KEY.trim();
  for (const file of files) {
    let contents;
    try { contents = await read(file, "utf8"); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const line = /^\s*(?:export\s+)?FOSS_EARTH_GOOGLE_KEY\s*=\s*(.*?)\s*$/m.exec(contents)?.[1];
    if (!line) continue;
    const value = line.startsWith('"') || line.startsWith("'")
      ? /^(["'])(.*?)\1(?:\s*#.*)?$/.exec(line)?.[2]
      : line.replace(/\s+#.*$/, "").trim();
    if (value) return value;
  }
  return null;
}

export function redactFlightProfile(value, secrets = []) {
  if (typeof value === "string") {
    let safe = value.replace(/([?&](?:key|session)=)[^&#\s"']+/gi, "$1[redacted]");
    for (const secret of secrets) if (secret) safe = safe.replaceAll(secret, "[redacted]");
    return safe;
  }
  if (Array.isArray(value)) return value.map(item => redactFlightProfile(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:key|session|googleKey)$/i.test(key) ? "[redacted]" : redactFlightProfile(item, secrets)]));
  return value;
}
