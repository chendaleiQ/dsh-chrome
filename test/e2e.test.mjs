import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../src/bridge-server.js";
import { bridgeSend } from "../src/bridge-client.js";

test("bridge e2e: command round-trips through a fake extension", async () => {
  const bridge = createBridge({ host: "127.0.0.1", port: 17332 });
  await bridge.listen();
  try {
    const poller = (async () => {
      const res = await fetch("http://127.0.0.1:17332/next?name=fake-ext");
      assert.equal(res.status, 200);
      const msg = await res.json();
      assert.equal(msg.type, "command");
      const { id, action } = msg.command;
      assert.equal(action, "tab.list");
      const result = [{ id: "1", title: "Fake", url: "https://example.com/" }];
      const back = await fetch("http://127.0.0.1:17332/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ok: true, result }),
      });
      assert.equal(back.status, 200);
    })();
    const result = await bridgeSend("http://127.0.0.1:17332", "tab.list", { sessionKey: "session:test" }, 10000);
    await poller;
    assert.ok(Array.isArray(result));
    assert.equal(result[0].title, "Fake");
  } finally {
    await bridge.close();
  }
});
