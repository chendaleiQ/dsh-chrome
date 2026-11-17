import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../src/bridge-server.js";
import { apply } from "../src/index.js";

function fakeCtx() {
  const tools = new Map();
  return { tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } }, collected: tools };
}

test("autostart: port taken falls back to client mode, teardown spares the owner", async () => {
  const owner = createBridge({ host: "127.0.0.1", port: 17336 });
  await owner.listen();
  try {
    const ctx = fakeCtx();
    const cleanup = apply(ctx, { bridgePort: 17336 });
    try {
      // 给失败的 listen 留一个事件循环再断言，避免竞态
      await new Promise((r) => setTimeout(r, 300));
      const status = await ctx.collected.get("chrome_status").run();
      assert.equal(status.mode, "server");
      assert.equal(status.connected, false);
    } finally {
      cleanup();
      await new Promise((r) => setTimeout(r, 300));
    }
    // 主人还在：我们的 teardown 没误杀别人的桥
    const again = await (await fetch("http://127.0.0.1:17336/status")).json();
    assert.equal(again.mode, "server");
  } finally {
    await owner.close();
  }
});
