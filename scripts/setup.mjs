#!/usr/bin/env node
/**
 * dsh-chrome 一键安装检查：node scripts/setup.mjs [--install-launchd|--uninstall-launchd]
 * 中文说明见 README.md，English version see README.en.md.
 *
 * 做的事：
 *  1. Node 版本检查（>= 22）
 *  2. 跑全量单测（node --test）
 *  3. 桥状态检查（17319 有没有在跑、谁在跑）
 *  4. 打印扩展加载步骤（带绝对路径，开箱即贴）
 *  5. --install-launchd：写入 ~/Library/LaunchAgents 开机自启并立即启动
 *  6. 打印 DSH 侧安装提示
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "com.chendaleiq.dsh-chrome-bridge";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const args = new Set(process.argv.slice(2));
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const fail = (m) => {
  console.error(`  ✗ ${m}`);
  process.exitCode = 1;
};

console.log("== 1/5 Node 版本 / Node version ==");
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) ok(`node ${process.versions.node}`);
else fail(`need node >= 22, got ${process.versions.node}`);

console.log("== 2/5 单测 / tests ==");
const t = spawnSync(process.execPath, ["--test", "test/*.test.mjs"], { cwd: root, encoding: "utf8" });
if (t.status === 0) ok("all tests pass");
else {
  fail("tests failed");
  console.error((t.stdout || "").split("\n").slice(-15).join("\n"));
}

console.log("== 3/5 桥状态 / bridge ==");
try {
  const st = await (await fetch("http://127.0.0.1:17319/status")).json();
  ok(`bridge up: connected=${st.connected} client=${st.clientName || "(none)"}`);
} catch {
  warn("bridge not running (DSH 插件加载时会自动起；或见第 5 步开机自启)");
}

console.log("== 4/5 扩展 / extension ==");
console.log(`  chrome://extensions → 开发者模式 → 加载已解压的扩展 → 选择：\n  ${join(root, "extension")}`);
console.log("  Load unpacked at chrome://extensions (Developer mode on):");
console.log(`  ${join(root, "extension")}`);

if (args.has("--install-launchd")) {
  console.log("== 5/5 开机自启 / LaunchAgent ==");
  mkdirSync(dirname(PLIST), { recursive: true });
  const plist =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>\n` +
    `  <key>Label</key><string>${LABEL}</string>\n` +
    `  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${join(root, "scripts", "bridge.mjs")}</string></array>\n` +
    `  <key>WorkingDirectory</key><string>${root}</string>\n` +
    `  <key>RunAtLoad</key><true/>\n` +
    `  <key>KeepAlive</key><true/>\n` +
    `  <key>StandardOutPath</key><string>/tmp/dsh-chrome-bridge.log</string>\n` +
    `  <key>StandardErrorPath</key><string>/tmp/dsh-chrome-bridge.err</string>\n` +
    `</dict></plist>\n`;
  writeFileSync(PLIST, plist);
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST], { stdio: "ignore" });
  } catch { /* not loaded yet */ }
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST]);
  ok(`installed ${PLIST} and started`);
} else if (args.has("--uninstall-launchd")) {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST], { stdio: "ignore" });
  } catch { /* ignore */ }
  if (existsSync(PLIST)) rmSync(PLIST);
  ok("launchd entry removed (bridge stops being auto-started)");
} else {
  console.log("== 5/5 开机自启（可选） / autostart (optional) ==");
  console.log("  node scripts/setup.mjs --install-launchd    开机自启桥 / autostart bridge on login");
}

console.log("");
console.log("DSH 侧安装 / install into DSH:");
console.log(`  plugin_manager → install_bundle → target: ${resolve(root)}`);
console.log("  (当面装：插件页 → Add plugin → 选上面这个目录 / Plugins → Add plugin → pick it)");
if (process.exitCode) console.log("\nDone with errors — fix the ✗ lines above.");
else console.log("\nDone. Bridge + extension + DSH 三件套按上面 4/5/DSH 三步走。");
