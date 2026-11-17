import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../src/bridge-server.js";
import { ensureBridge } from "../src/auto-bridge.js";

test("autostart: free port is owned and closed on dispose", async () => {
  const auto = ensureBridge({ bridgeHost: "127.0.0.1", bridgePort: 17337 });
  await auto.started;
  assert.equal(auto.isOwned(), true);
  const st = await (await fetch("http://127.0.0.1:17337/status")).json();
  assert.equal(st.mode, "server");
  await auto.dispose();
  await assert.rejects(() => fetch("http://127.0.0.1:17337/status"), /fetch failed|refused|ECONNREFUSED/);
});

test("autostart: taken port falls back to client, dispose spares the owner", async () => {
  const owner = createBridge({ host: "127.0.0.1", port: 17338 });
  await owner.listen();
  try {
    const auto = ensureBridge({ bridgeHost: "127.0.0.1", bridgePort: 17338 });
    await auto.started;
    assert.equal(auto.isOwned(), false);
    await auto.dispose();
    await new Promise((r) => setTimeout(r, 200));
    const again = await (await fetch("http://127.0.0.1:17338/status")).json();
    assert.equal(again.mode, "server");
  } finally {
    await owner.close();
  }
});
