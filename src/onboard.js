/**
 * dsh-chrome — 首次引导（纯模块，可单测）。
 * 扩展目录藏在包里，用户自己找很烦：连不上时直接把文件管理器打开并选中
 * extension/ 文件夹，用户拖进 chrome://extensions 就行。
 * macOS 用 open -R（定位并选中），Windows 用 explorer /select，Linux 用 xdg-open。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function defaultOpener(dir) {
  return new Promise((resolve) => {
    const plat = process.platform;
    const cmd = plat === "darwin" ? "open" : plat === "win32" ? "explorer" : "xdg-open";
    const args = plat === "darwin" ? ["-R", dir] : plat === "win32" ? [`/select,${dir}`] : [dir];
    execFile(cmd, args, (error) => resolve(!error));
  });
}

/**
 * @param deps.bridgeStatus () => Promise<status>
 * @param deps.dataDir 落盘目录（放 .onboarded 标记，避免每次启动都弹）
 * @param deps.extensionDir 扩展绝对路径
 * @param deps.openDir (dir) => Promise<boolean>，默认按平台打开文件管理器
 * @param deps.markAttempt 无论是否打开成功都写标记（自动引导用一次即止）
 * @returns { connected, bridgeUp, extensionDir, opened, steps }
 */
export async function onboard({ bridgeStatus, dataDir, extensionDir, openDir = defaultOpener, markAttempt = false }) {
  let status = { connected: false };
  try {
    status = (await bridgeStatus()) || status;
  } catch { /* 桥没起也继续走引导 */ }
  const connected = status.connected === true;
  let opened = false;
  if (!connected) {
    try {
      opened = await openDir(extensionDir);
    } catch {
      opened = false;
    }
  }
  try {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      if (opened || markAttempt) writeFileSync(join(dataDir, ".onboarded"), `${new Date().toISOString()}\n`);
    }
  } catch { /* 标记写失败不影响引导 */ }
  return {
    connected,
    bridgeUp: status.mode === "server" || connected,
    extensionDir,
    opened,
    steps: [
      "1. 打开 chrome://extensions，打开右上角「开发者模式」",
      "2. 点「加载已解压的扩展程序」，选择上面的 extensionDir（也可直接从文件管理器拖进去）",
      "3. 点工具栏 DSH Chrome Connector 图标，按「立即连接」",
      "1. Open chrome://extensions, turn on Developer mode",
      "2. Load unpacked and pick extensionDir above (or drag it in from the file manager)",
      "3. Click the toolbar icon and press Connect",
    ],
  };
}

export function alreadyOnboarded(dataDir) {
  try {
    return existsSync(join(dataDir || "", ".onboarded"));
  } catch {
    return false;
  }
}
