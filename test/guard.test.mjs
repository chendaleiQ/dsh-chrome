import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/index.js";

function fakeCtx() {
  const tools = new Map();
  return {
    tools: {
      register(def) {
        tools.set(def.name, def);
        return () => tools.delete(def.name);
      },
    },
    collected: tools,
  };
}

test("guard: private navigation is hard-denied without touching the bridge", async () => {
  const ctx = fakeCtx();
  const cleanup = apply(ctx, { autoStartBridge: false });
  try {
    const nav = ctx.collected.get("chrome_navigate");
    assert.ok(nav, "chrome_navigate not registered");
    for (const url of ["http://127.0.0.1:9222/json", "http://10.0.0.5/", "http://192.168.1.1/", "file:///etc/passwd", "ftp://example.com/x"]) {
      await assert.rejects(() => nav.run({ url }), /navigation blocked/);
    }
    const names = [...ctx.collected.keys()].sort();
    assert.deepEqual(names, ["chrome_evaluate", "chrome_navigate", "chrome_screenshot", "chrome_snapshot", "chrome_status", "chrome_tab_close", "chrome_tab_new", "chrome_tab_select", "chrome_tabs_list"]);
  } finally {
    cleanup();
  }
});
