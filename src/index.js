/**
 * dsh-chrome — Host 侧入口（全新重写）。
 *
 * 行为对照 pi-chrome 的 chrome_* 工具面（见 research/pi-chrome-upstream，不复制代码）：
 * MVP 先给 7 个：chrome_status / chrome_tabs_list / chrome_tab_select /
 * chrome_snapshot / chrome_navigate / chrome_screenshot / chrome_evaluate。
 * 全部走自有 bridge-client.js 连自有 companion 扩展。
 *
 * loader 行 id、package 名、本文件的 `name` 三者必须一致。
 */

import { bridgeSend, bridgeStatus, bridgeUrlOf } from "./bridge-client.js";
import { createBridge } from "./bridge-server.js";
import { saveScreenshot } from "./screenshot.js";

export const name = "@chendaleiq/dsh-chrome";

export const inject = ["tools"];

const DEFAULTS = {
  enabled: true,
  bridgeHost: "127.0.0.1",
  bridgePort: 17319,
  approvalPolicy: "read-auto",
  requireApprovalFor: ["chrome_navigate", "chrome_evaluate", "chrome_tab_select", "chrome_tab_new", "chrome_tab_close"],
  blockPrivateIPs: true,
  snapshotMaxChars: 8000,
  evaluateMaxChars: 4000,
  screenshotMaxBytes: 512000,
  autoStartBridge: true,
  dataDir: "",
};

function resolveConfig(raw) {
  const config = { ...DEFAULTS };
  if (raw === null || typeof raw !== "object") return config;
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (Array.isArray(fallback)) {
      if (Array.isArray(value)) config[key] = value;
      continue;
    }
    if (typeof value !== typeof fallback) continue;
    config[key] = value;
  }
  return config;
}

function truncate(text, maxChars) {
  if (typeof text !== "string") return text;
  if (text.length <= maxChars) return { text, truncated: 0 };
  return { text: `${text.slice(0, maxChars)}[truncated ${text.length - maxChars} chars]`, truncated: text.length - maxChars };
}

function isBlockedUrl(url, blockPrivateIPs) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return `scheme ${u.protocol} not allowed`;
    if (!blockPrivateIPs) return null;
    const host = u.hostname;
    if (host === "localhost" || host.endsWith(".localhost")) return "private host blocked";
    if (/^127\./.test(host) || host === "::1" || host === "[::1]") return "loopback blocked";
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return "private IP blocked";
    return null;
  } catch {
    return "invalid URL";
  }
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const baseUrl = bridgeUrlOf(config);
  const disposers = [];
  // 会话隔离键：照着 pi 的 sessionKey 思路重写，DSH 侧固定一个稳定 key，
  // 退出时调 automation.cleanup 带同 key，避免留孤儿 tab。
  const SESSION_KEY = "session:dsh-chrome";
  // 桥是谁起的：Host 插件自己起（127.0.0.1 回环），退出时关掉。
  // 端口被占（另一个 DSH 会话已起）就当 client 用，不报错。
  let ownedBridge = null;
  if (config.autoStartBridge !== false) {
    try {
      const bridge = createBridge({ host: config.bridgeHost, port: config.bridgePort });
      const started = bridge
        .listen()
        .then(() => {
          ownedBridge = bridge;
        })
        .catch(() => {
          ownedBridge = null;
        });
      disposers.push(() => {
        // listen 可能还没 resolve：排队到它之后再关，保证不留悬空端口。
        started.then(() => bridge.close().catch(() => {})).catch(() => {});
      });
    } catch {
      // 起不了就当纯 client，chrome_status 会如实报告
    }
  }
  const send = (action, params = {}, timeoutMs) =>
    bridgeSend(baseUrl, action, { sessionKey: SESSION_KEY, background: true, foreground: false, ...params }, timeoutMs);

  const register = (definition, run) => {
    if (!ctx?.tools?.register) throw new Error("dsh-chrome requires ctx.tools.register");
    const dispose = ctx.tools.register({ ...definition, run });
    if (typeof dispose === "function") disposers.push(dispose);
  };

  // ---- 只读：连接健康 ----
  register(
    {
      name: "chrome_status",
      description: "Check local Chrome bridge connection. Returns connected, browser, targets. Call first when other chrome_* tools fail.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    async () => bridgeStatus(baseUrl),
  );

  // ---- 只读：标签页列表 ----
  register(
    {
      name: "chrome_tabs_list",
      description: "List open tabs. Returns bounded list with id, title, url.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Max tabs to return." },
          query: { type: "string", description: "Optional substring filter on title or url." },
        },
        additionalProperties: false,
      },
    },
    async (args = {}) => {
      const result = await send("tab.list", {});
      const tabs = Array.isArray(result) ? result : Array.isArray(result?.tabs) ? result.tabs : [];
      const q = typeof args.query === "string" && args.query.length > 0 ? args.query.toLowerCase() : null;
      const filtered = q ? tabs.filter((t) => `${t.title || ""} ${t.url || ""}`.toLowerCase().includes(q)) : tabs;
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
      return { tabs: filtered.slice(0, limit), total: filtered.length };
    },
  );

  // ---- 写：按 id 选中标签页（默认走审批，由宿主 pre-execute/approval 决定） ----
  register(
    {
      name: "chrome_tab_select",
      description: "Activate one tab by id. Does not navigate or close.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "string", description: "Tab id from chrome_tabs_list." } },
        required: ["tabId"],
        additionalProperties: false,
      },
    },
    async (args) => send("tab.activate", { tabId: args.tabId }),
  );

  // ---- 写：开新标签页（后台开，不抢焦点；记为自有 tab） ----
  register(
    {
      name: "chrome_tab_new",
      description: "Open a new background tab, optionally with a URL. Tracked as an owned tab for later cleanup.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "https URL to open. Defaults to about:blank." },
        },
        additionalProperties: false,
      },
    },
    async (args = {}) => {
      if (args.url !== undefined) {
        const blocked = isBlockedUrl(args.url, config.blockPrivateIPs);
        if (blocked) throw new Error(`navigation blocked: ${blocked}`);
      }
      return send("tab.new", { url: args.url });
    },
  );

  // ---- 写：关标签页 ----
  register(
    {
      name: "chrome_tab_close",
      description: "Close one tab by id.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "string", description: "Tab id from chrome_tabs_list." } },
        required: ["tabId"],
        additionalProperties: false,
      },
    },
    async (args) => send("tab.close", { tabId: args.tabId }),
  );

  // ---- 只读：无障碍快照（省 token 优先于截图） ----
  register(
    {
      name: "chrome_snapshot",
      description: "Capture accessibility snapshot of a tab. Returns refs like [ref=12] for later actions. Prefer this over screenshot for reading.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string", description: "Defaults to active tab." },
          maxChars: { type: "integer", minimum: 1000, maximum: 20000, default: config.snapshotMaxChars },
        },
        additionalProperties: false,
      },
    },
    async (args = {}) => {
      const result = await send("page.snapshot", { tabId: args.tabId });
      const out = truncate(String(result?.snapshot ?? ""), Number(args.maxChars) || config.snapshotMaxChars);
      return { snapshot: out.text, truncated: out.truncated, refId: result?.refId };
    },
  );

  // ---- 写：导航（私有地址同步硬拒，其余走审批） ----
  register(
    {
      name: "chrome_navigate",
      description: "Navigate a tab to an https URL. Private hosts are blocked.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "https URL to open." },
          tabId: { type: "string", description: "Defaults to active tab." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 60000, default: 15000 },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const blocked = isBlockedUrl(args.url, config.blockPrivateIPs);
      if (blocked) throw new Error(`navigation blocked: ${blocked}`);
      return send("page.navigate", { url: args.url, tabId: args.tabId }, Number(args.timeoutMs) || 15000);
    },
  );

  // ---- 只读：截图落盘（不回 base64，只回 path） ----
  register(
    {
      name: "chrome_screenshot",
      description: "Screenshot a tab to a file. Returns path and size, not image bytes.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string", description: "Defaults to active tab." },
          fullPage: { type: "boolean", default: false, description: "Full page costs more; default viewport only." },
        },
        additionalProperties: false,
      },
    },
    async (args = {}) => {
      if (args.fullPage === true) throw new Error("fullPage is not supported in 0.1.0 (viewport only)");
      const shot = await send("page.screenshot", { tabId: args.tabId });
      return saveScreenshot(config.dataDir, SESSION_KEY, shot?.dataUrl);
    },
  );

  // ---- 最高危：页面内取值（默认禁出网，超长截断） ----
  register(
    {
      name: "chrome_evaluate",
      description: "Run a read-only JavaScript expression in the page and return a truncated JSON result.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Single JS expression, e.g. document.title." },
          tabId: { type: "string", description: "Defaults to active tab." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 15000, default: 5000 },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const result = await send(
        "page.evaluate",
        { expression: args.expression, tabId: args.tabId },
        Number(args.timeoutMs) || 5000,
      );
      const text = JSON.stringify(result?.value ?? result);
      const out = truncate(text, config.evaluateMaxChars);
      return { value: out.text, truncated: out.truncated };
    },
  );

  return () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      try {
        dispose();
      } catch {
        // ignore teardown errors
      }
    }
  };
}
