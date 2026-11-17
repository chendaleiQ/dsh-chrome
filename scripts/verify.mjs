/**
 * dsh-chrome 一键真机验证（全新重写）。
 * 用法：node scripts/verify.mjs [--port 17319] [--wait-secs 120] [--snapshot]
 * 桥没在跑就先起桥（见 docs/TESTING.md）；扩展没连就等到 --wait-secs，超时报 2。
 */
import { bridgeSend, bridgeStatus } from "../src/bridge-client.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const port = Number(arg("--port", "17319"));
const waitSecs = Number(arg("--wait-secs", "120"));
const wantSnapshot = process.argv.includes("--snapshot");
const baseUrl = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deadline = Date.now() + waitSecs * 1000;
let status = await bridgeStatus(baseUrl);
while (!status.connected && Date.now() < deadline) {
  const left = Math.ceil((deadline - Date.now()) / 1000);
  process.stdout.write(`\rwaiting for extension… ${left}s `);
  await sleep(2000);
  status = await bridgeStatus(baseUrl);
}
process.stdout.write("\n");
if (!status.connected) {
  console.error(`timeout: no extension polled ${baseUrl} within ${waitSecs}s (lastSeenAt=${status.lastSeenAt || 0})`);
  process.exit(2);
}
console.log(`connected: ${status.clientName || "(unknown client)"}`);

const send = (action, params = {}, timeoutMs = 20000) => bridgeSend(baseUrl, action, params, timeoutMs);

const version = await send("tab.version", {});
console.log(`extensionVersion=${version.extensionVersion} userAgent=${String(version.userAgent || "").slice(0, 80)}`);

const tabs = await send("tab.list", {});
const list = Array.isArray(tabs) ? tabs : [];
console.log(`tabs=${list.length}`);
for (const t of list.slice(0, 10)) console.log(` - [${t.id}] ${String(t.title || "").slice(0, 60)} ${t.url || ""}`);

if (wantSnapshot) {
  const snap = await send("page.snapshot", { maxNodes: 40 }, 25000);
  const text = String(snap.snapshot || "").slice(0, 2000);
  console.log(`--- snapshot (${snap.truncated || 0} more) ---`);
  console.log(text);
}
console.log("VERIFY_PASS");
