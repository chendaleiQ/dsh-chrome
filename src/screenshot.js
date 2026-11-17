/**
 * dsh-chrome — 截图落盘（全新重写，无第三方依赖）。
 * 扩展只回 dataUrl，落盘是 Host 的事：文件名带时间戳，PNG 头解析宽高，
 * 失败也不掩盖（width/height 置 null）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function pngSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(12) === 0x49484452) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch {
    // ignore
  }
  return { width: null, height: null };
}

export function saveScreenshot(dataDir, sessionKey, dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("extension did not return an image dataUrl");
  }
  const base = dataDir && dataDir.length > 0 ? dataDir : join(homedir(), ".dsh", "chrome");
  const safe = String(sessionKey || "session:default").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const dir = join(base, safe);
  mkdirSync(dir, { recursive: true });
  const name = `shot-${Date.now()}.png`;
  const path = join(dir, name);
  const buf = Buffer.from(dataUrl.split(",", 2)[1] || "", "base64");
  writeFileSync(path, buf);
  const { width, height } = pngSize(buf);
  return { path, bytes: buf.length, width, height };
}
