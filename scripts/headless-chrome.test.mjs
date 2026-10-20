import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openChrome } from "./headless-chrome.mjs";

function fixture({ probeFails = false } = {}) {
  const child = new EventEmitter(), messages = [], launches = [];
  child.pid = 123;
  child.stderr = new EventEmitter();
  child.kill = () => assert.fail("Chrome cleanup must observe normal exit");
  child.stdio = [null, null, null, { write(bytes) {
    const message = JSON.parse(bytes.slice(0, -1)); messages.push(message);
    queueMicrotask(() => {
      child.stdio[4].emit("data", Buffer.from(JSON.stringify({ id: message.id,
        ...(probeFails && message.method === "Browser.getVersion" ? { error: { message: "probe failed" } } : { result: {} }) }) + "\0"));
      if (probeFails && message.method === "Browser.close") queueMicrotask(() => child.emit("exit", 0, null));
    });
  } }, new EventEmitter()];
  const ports = { access: async () => {}, spawn: (binary, args) => { launches.push({ binary, args }); return child; } };
  return { child, messages, ports, launches };
}

test("concurrent close calls share one command and wait for actual Chrome exit", async () => {
  const f = fixture(), chrome = await openChrome("fixture-profile", "fixture-chrome", [], { headed: true, ports: f.ports });
  assert.ok(!f.launches[0].args.some(arg => arg.startsWith("--headless")));
  const first = chrome.close(), second = chrome.close();
  assert.equal(first, second);
  let completed = false; void first.then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(f.messages.filter(message => message.method === "Browser.close").length, 1);
  f.child.emit("exit", 0, null); await first;
  assert.equal(completed, true);
});

test("a failed startup probe still requests close and observes exit before rejecting", async () => {
  const f = fixture({ probeFails: true });
  let exited = false; f.child.on("exit", () => { exited = true; });
  await assert.rejects(openChrome("fixture-profile", "fixture-chrome", [], { ports: f.ports }), /probe failed/);
  assert.equal(exited, true);
  assert.equal(f.messages.filter(message => message.method === "Browser.close").length, 1);
});
