import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../src/bridge-server.js";

test("bridge: status responds and unclaimed command times out", async () => {
  const bridge = createBridge({ host: "127.0.0.1", port: 17329 });
  await bridge.listen();
  try {
    const st = await (await fetch("http://127.0.0.1:17329/status")).json();
    assert.equal(st.mode, "server");
    assert.equal(st.connected, false);
    const res = await fetch("http://127.0.0.1:17329/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "tab.list", params: {}, timeoutMs: 1500 }),
    });
    assert.equal(res.status, 504);
    const body = await res.json();
    assert.equal(body.ok, false);
  } finally {
    await bridge.close();
  }
});
