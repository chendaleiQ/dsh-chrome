#!/usr/bin/env node
/**
 * dsh-chrome 本地桥独立入口：node scripts/bridge.mjs [--port 17319]
 * DSH 插件加载时会自动起桥（端口被占则当 client）；这个脚本用于
 * LaunchAgent 开机自启，或手动常驻。
 */
import { createBridge } from "../src/bridge-server.js";

const portArg = process.argv.indexOf("--port");
const port = Number(portArg === -1 ? process.env.DSH_CHROME_BRIDGE_PORT || 17319 : process.argv[portArg + 1]);
const host = process.env.DSH_CHROME_BRIDGE_HOST || "127.0.0.1";

const bridge = createBridge({ host, port });
bridge
  .listen()
  .then(() => console.log(`[dsh-chrome] bridge listening on http://${host}:${port}`))
  .catch((e) => {
    console.error(`[dsh-chrome] cannot listen on ${host}:${port}: ${e.message}`);
    process.exit(1);
  });

process.on("SIGTERM", () => bridge.close().then(() => process.exit(0)));
process.on("SIGINT", () => bridge.close().then(() => process.exit(0)));
