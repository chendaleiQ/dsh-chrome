import test from "node:test";
import assert from "node:assert/strict";
import { buildTools, compileToolDefinition } from "../src/tools.js";

const exec = { signal: new AbortController().signal };

function harness(sendImpl) {
  return buildTools({
    send: sendImpl,
    bridgeStatus: async () => ({ connected: true }),
    config: { blockPrivateIPs: true, snapshotMaxChars: 8000, evaluateMaxChars: 4000, dataDir: "" },
    saveScreenshot: () => ({ path: "/tmp/x.png", bytes: 1, width: 1, height: 1 }),
    sessionKey: "session:test",
  });
}

test("compile: registry shape passes the host activation gate", () => {
  for (const def of harness(async () => ({}))) {
    const c = compileToolDefinition(def);
    // 复刻宿主 register() 的三道检查：output 对象 + render 函数 + schema 存在
    assert.ok(c.output && typeof c.output === "object", `${def.name}: output`);
    assert.equal(typeof c.output.render, "function", `${def.name}: render`);
    assert.ok(c.output.schema && c.output.schema.type === "object", `${def.name}: schema`);
    // DSL 的 required:true 标记必须收拢，不能残留在编译产物里（布尔 required 非法）
    assert.ok(!JSON.stringify([c.parameters, c.output.schema]).includes('"required":true'), `${def.name}: stray required:true`);
    assert.equal(typeof c.execute, "function");
  }
});

test("compile: missing required args fail fast with a clear message", async () => {
  const byName = new Map(harness(async () => ({})).map((t) => [t.name, compileToolDefinition(t)]));
  await assert.rejects(() => byName.get("chrome_navigate").execute({}, exec), /invalid arguments: url: required/);
  await assert.rejects(() => byName.get("chrome_tab_select").execute({}, exec), /tabId: required/);
  await assert.rejects(() => byName.get("chrome_evaluate").execute({ expression: 42 }, exec), /expression: expected string/);
});
