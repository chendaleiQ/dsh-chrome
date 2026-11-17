/**
 * dsh-chrome — DSH 侧本地桥客户端（全新重写）。
 *
 * 对照行为：pi-chrome 的 loopback bridge（研究库 research/pi-chrome-upstream，
 * 不打包不复制）。本文件只实现我们自己的最小 wire 协议：
 *   GET  /status            -> { url, mode, connected, lastSeenAt, clientName }
 *   POST /command { id, action, params } -> { ok, result } 或 { ok:false, error }
 *
 * 不依赖任何第三方包，只用 Node 全局 fetch。
 */

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17319;

export function bridgeUrlOf(config = {}) {
  const host = config.bridgeHost || process.env.DSH_CHROME_BRIDGE_HOST || DEFAULT_HOST;
  const port = Number(config.bridgePort || process.env.DSH_CHROME_BRIDGE_PORT || DEFAULT_PORT);
  return `http://${host}:${port}`;
}

export async function bridgeStatus(baseUrl, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/status`, { signal: ctrl.signal });
    if (!res.ok) return { connected: false, httpStatus: res.status };
    return await res.json();
  } catch (error) {
    return { connected: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

let seq = 0;

export async function bridgeSend(baseUrl, action, params = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `dsh-${Date.now()}-${(seq += 1)}`, action, params }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || `bridge HTTP ${res.status}`);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}
