import test from "node:test";
import assert from "node:assert/strict";
import { buildTools } from "../src/tools.js";

const exec = { signal: new AbortController().signal };
const byName = (tools) => new Map(tools.map((t) => [t.name, t]));

function harness(sendImpl) {
  return buildTools({
    send: sendImpl,
    bridgeStatus: async () => ({ connected: true }),
    config: { blockPrivateIPs: true, snapshotMaxChars: 8000, evaluateMaxChars: 4000, dataDir: "" },
    saveScreenshot: () => ({ path: "/tmp/x.png", bytes: 1, width: 1, height: 1 }),
    sessionKey: "session:test",
    doOnboard: async () => ({ connected: false, bridgeUp: true, extensionDir: "/x/extension", opened: true, steps: [] }),
  });
}

test("tools: nine definitions with output schemas", () => {
  const names = [...byName(harness(async () => ({}))).keys()].sort();
  assert.deepEqual(names, ["chrome_evaluate", "chrome_fill", "chrome_navigate", "chrome_onboard", "chrome_screenshot", "chrome_snapshot", "chrome_status", "chrome_tab_close", "chrome_tab_new", "chrome_tab_select", "chrome_tabs_list"]);
  for (const t of harness(async () => ({}))) {
    assert.equal(typeof t.output.render, "function");
    assert.equal(typeof t.execute, "function");
    assert.ok(t.output.schema && t.output.schema.type === "object");
  }
});

test("guard: private navigation is hard-denied without touching the bridge", async () => {
  let called = 0;
  const tools = byName(harness(async () => { called += 1; return {}; }));
  for (const url of ["http://127.0.0.1:9222/json", "http://10.0.0.5/", "http://192.168.1.1/", "file:///etc/passwd", "ftp://example.com/x"]) {
    await assert.rejects(() => tools.get("chrome_navigate").execute({ url }, exec), /navigation blocked/);
    await assert.rejects(() => tools.get("chrome_tab_new").execute({ url }, exec), /navigation blocked/);
  }
  assert.equal(called, 0);
});

test("tabs: list mapping, bounds and query filter", async () => {
  const tools = byName(harness(async () => ([
    { id: 1, title: "A", url: "https://a.example/" },
    { id: 2, title: "B", url: "https://b.example/" },
  ])));
  const all = await tools.get("chrome_tabs_list").execute({}, exec);
  assert.equal(all.total, 2);
  assert.equal(all.tabs[0].id, "1");
  const q = await tools.get("chrome_tabs_list").execute({ query: "b.example" }, exec);
  assert.equal(q.total, 1);
  assert.equal(q.tabs[0].title, "B");
});
