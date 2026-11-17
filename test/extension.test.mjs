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
  const store = {};
  let releaseHold = () => {};
  const sandbox = {
    console,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (url) => {
      polls += 1;
      assert.match(String(url), /127\.0\.0\.1:17319/);
      // 模拟 25s 长轮询 hold：测试手动放行，避免紧循环空转卡住进程退出
      await new Promise((r) => { releaseHold = r; });
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
      storage: {
        local: {
          get: async (key) => ({ [key]: store[key] }),
          set: async (obj) => { Object.assign(store, obj); },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "service_worker.js" });
  // 模块求值 + 顶层 pollOnce（hold 住）+ 手动放行，看紧循环是否立刻跟上下一次
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await tick();
  assert.equal(polls, 1, "top-level pollOnce");
  assert.equal(typeof listeners.installed, "function");
  assert.equal(typeof listeners.startup, "function");
  assert.equal(typeof listeners.message, "function");
  releaseHold();
  await tick();
  assert.equal(polls, 2, "tight loop re-polls after idle");
  // 心跳每次完成都写 storage（跨 vm 上下文按值比）；
  // 紧循环下第二次轮询已在途，所以 state 是 attempt（= 存活证明），polls 只计完成的
  assert.equal(JSON.stringify(store.swHeartbeat && store.swHeartbeat.polls), "1");
  assert.equal(store.swHeartbeat && store.swHeartbeat.state, "attempt");
});

test("extension: tab.new/tab.close dispatch through a scripted bridge", async () => {
  const store = {};
  const removed = [];
  const script = [
    { type: "command", command: { id: "c1", action: "tab.new", params: { url: "https://example.com/" } } },
    { type: "command", command: { id: "c2", action: "tab.close", params: { tabId: "42" } } },
  ];
  const results = {};
  const sandbox = {
    console,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (url, opts = {}) => {
      if (String(url).includes("/result")) {
        const body = JSON.parse(opts.body);
        results[body.id] = body;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      const next = script.shift();
      // 脚本走完就 park 住（模拟长轮询 hold），否则紧循环空转饿死 tick
      if (!next) await new Promise(() => {});
      return { ok: true, json: async () => next };
    },
    navigator: { userAgent: "TestAgent/1.0" },
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      tabs: {
        query: async () => [],
        update: async () => ({}),
        get: async () => ({}),
        create: async (opts) => ({ id: 42, title: "", url: opts.url }),
        remove: async (id) => { removed.push(id); },
      },
      scripting: { executeScript: async () => [{ result: [] }] },
      storage: {
        local: {
          get: async (key) => ({ [key]: store[key] }),
          set: async (obj) => { Object.assign(store, obj); },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "service_worker.js" });
  const tick = () => new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 20 && (!results.c1 || !results.c2); i++) await tick();
  assert.equal(results.c1?.ok, true);
  assert.equal(results.c1?.result?.id, "42");
  assert.deepEqual(removed, [42]);
  assert.equal(results.c2?.ok, true);
  // store.ownedTabs 是 vm 上下文里建的数组（原型不同），按值比。
  assert.equal(JSON.stringify(store.ownedTabs), "[]");
});
