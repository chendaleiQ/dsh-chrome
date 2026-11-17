import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(join(root, "extension", "service_worker.js"), "utf8");

test("extension: service worker module evaluates and polls without throwing", async () => {
  let polls = 0;
  const listeners = {};
  const sandbox = {
    console,
    setInterval: () => 0,
    // SW 只在出错重试时用 setTimeout；happy path 不需要，悬空返回即可。
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (url) => {
      polls += 1;
      assert.match(String(url), /127\.0\.0\.1:17319/);
      return { ok: true, json: async () => ({ type: "none" }) };
    },
    navigator: { userAgent: "TestAgent/1.0" },
    chrome: {
      runtime: {
        onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
        onStartup: { addListener: (fn) => { listeners.startup = fn; } },
        onMessage: { addListener: (fn) => { listeners.message = fn; } },
      },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      tabs: { query: async () => [], update: async () => ({}), get: async () => ({}) },
      scripting: { executeScript: async () => [{ result: [] }] },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "service_worker.js" });
  // 模块求值 + 顶层 pollOnce + 手动触发 installed/startup/message，逐步数轮询
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await tick();
  assert.equal(polls, 1, "top-level pollOnce");
  listeners.installed();
  await tick();
  assert.equal(polls, 2, "onInstalled pollOnce");
  listeners.startup();
  await tick();
  assert.equal(polls, 3, "onStartup pollOnce");
  await listeners.message({ type: "poll-now" });
  await tick();
  assert.equal(polls, 4, "poll-now pollOnce");
});
