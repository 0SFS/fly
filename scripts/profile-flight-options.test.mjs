import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { assertFlightProfilePath, flightGoogleKey, flightProfileOptions, redactFlightProfile } from "./profile-flight-options.mjs";

test("routes default to headed 180s; ordinary profiles keep existing defaults", () => {
  assert.deepEqual(flightProfileOptions([]), { route: null, headed: false, seconds: 10, settleSeconds: 5, timeoutSeconds: 600 });
  assert.deepEqual(flightProfileOptions(["--route=low"]), { route: "low", headed: true, seconds: 180, settleSeconds: 0, timeoutSeconds: 600 });
  assert.equal(flightProfileOptions(["--route=cruise", "--headless"]).headed, false);
  assert.deepEqual(flightProfileOptions(["--build-only"]), flightProfileOptions([]));
  for (const args of [["--route=bad"], ["--seconds=NaN"], ["--timeout=0"], ["--headed", "--headless"], ["--route=low", "--seconds=10"], ["--build-only", "--no-build"]]) {
    assert.throws(() => flightProfileOptions(args));
  }
});

test("key lookup reads only the named variable, preferring environment then agreed files", async () => {
  assert.equal(await flightGoogleKey({ env: { FOSS_EARTH_GOOGLE_KEY: "env-key" }, read: () => assert.fail("should not read") }), "env-key");
  const seen = [];
  const key = await flightGoogleKey({ env: { GOOGLE_MAPS_API_KEY: "ignored" }, files: ["first", "second"], read: async file => {
    seen.push(file);
    return file === "first" ? "ANOTHER_KEY=ignored\n" : 'export FOSS_EARTH_GOOGLE_KEY="named-key" # local\n';
  } });
  assert.equal(key, "named-key");
  assert.deepEqual(seen, ["first", "second"]);
});

test("report redaction covers nested URLs and exact key occurrences", () => {
  const safe = redactFlightProfile({ exceptions: ["https://tiles.test/?key=secret&session=token"], nested: { googleKey: "secret", text: "secret was omitted" } }, ["secret"]);
  assert.deepEqual(safe, { exceptions: ["https://tiles.test/?key=[redacted]&session=[redacted]"], nested: { googleKey: "[redacted]", text: "[redacted] was omitted" } });
});

test("profile output rejects paths outside build, ignored-state failures and symlink ancestors", async () => {
  const build = path.join(await realpath(process.cwd()), "build");
  await mkdir(build, { recursive: true });
  const root = await mkdtemp(path.join(build, "profile-output-test-"));
  const options = { ignored: async () => true };
  try {
    await mkdir(path.join(root, "build"));
    assert.equal(await assertFlightProfilePath(root, path.join(root, "build", "safe", "profile"), options), path.join(root, "build", "safe", "profile"));
    await assert.rejects(assertFlightProfilePath(root, path.join(root, "outside"), options), /inside/);
    await assert.rejects(assertFlightProfilePath(root, path.join(root, "build", "safe"), { ignored: async () => false }), /gitignored/);
    await symlink(root, path.join(root, "build", "linked"));
    await assert.rejects(assertFlightProfilePath(root, path.join(root, "build", "linked", "profile"), options), /symbolic links/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
