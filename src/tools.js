/**
 * dsh-chrome — 工具定义（纯模块，不依赖任何 DSH 包，可在普通 node 下单测）。
 * Host 入口负责用 defineTool 包装后注册；这里只描述契约与执行逻辑。
 */

export function truncate(text, maxChars) {
  if (typeof text !== "string") return text;
  if (text.length <= maxChars) return { text, truncated: 0 };
  return { text: `${text.slice(0, maxChars)}[truncated ${text.length - maxChars} chars]`, truncated: text.length - maxChars };
}

export function isBlockedUrl(url, blockPrivateIPs) {
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

const str = (v) => (typeof v === "string" ? v : undefined);
const int = (v) => (Number.isSafeInteger(v) ? v : undefined);
const textBlock = (text) => [{ type: "text", text: String(text) }];

/**
 * @param deps.send (action, params, timeoutMs, exec) => Promise<result>
 * @param deps.bridgeStatus () => Promise<status>
 * @param deps.config resolved config
 * @param deps.saveScreenshot (dataDir, sessionKey, dataUrl) => { path, bytes, width, height }
 * @param deps.sessionKey stable session key
 * @returns plain tool definitions ({ name, description, parameters, output, execute })
 */
export function buildTools({ send, bridgeStatus, config, saveScreenshot, sessionKey }) {
  return [
    {
      name: "chrome_status",
      description: "Check local Chrome bridge connection. Returns connected, browser, targets. Call first when other chrome_* tools fail.",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            connected: { type: "boolean", required: true },
            url: { type: "string" },
            mode: { type: "string" },
            lastSeenAt: { type: "integer" },
            clientName: { type: "string" },
            queuedCommands: { type: "integer" },
            pendingCommands: { type: "integer" },
            httpStatus: { type: "integer" },
            error: { type: "string" },
          },
        },
        render: (_args, value) => textBlock(JSON.stringify(value)),
      },
      async execute(args, exec) {
        void args;
        void exec;
        const s = await bridgeStatus();
        return {
          connected: s.connected === true,
          ...(str(s.url) !== undefined ? { url: s.url } : {}),
          ...(str(s.mode) !== undefined ? { mode: s.mode } : {}),
          ...(int(s.lastSeenAt) !== undefined ? { lastSeenAt: s.lastSeenAt } : {}),
          ...(str(s.clientName) !== undefined ? { clientName: s.clientName } : {}),
          ...(int(s.queuedCommands) !== undefined ? { queuedCommands: s.queuedCommands } : {}),
          ...(int(s.pendingCommands) !== undefined ? { pendingCommands: s.pendingCommands } : {}),
          ...(int(s.httpStatus) !== undefined ? { httpStatus: s.httpStatus } : {}),
          ...(str(s.error) !== undefined ? { error: s.error } : {}),
        };
      },
    },
    {
      name: "chrome_tabs_list",
      description: "List open tabs. Returns bounded list with id, title, url.",
      parameters: {
        limit: { type: "integer", description: "Max tabs to return (1-50, default 20)." },
        query: { type: "string", description: "Optional substring filter on title or url." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            total: { type: "integer", required: true },
            tabs: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", required: true },
                  title: { type: "string", required: true },
                  url: { type: "string", required: true },
                },
              },
            },
          },
        },
        render: (_args, value) =>
          textBlock([`tabs: ${value.total}`, ...value.tabs.map((t) => ` - [${t.id}] ${t.title} ${t.url}`)].join("\n")),
      },
      async execute(args, exec) {
        const result = await send("tab.list", {}, 15000, exec);
        const tabs = Array.isArray(result) ? result : Array.isArray(result?.tabs) ? result.tabs : [];
        const q = typeof args.query === "string" && args.query.length > 0 ? args.query.toLowerCase() : null;
        const filtered = q ? tabs.filter((t) => `${t.title || ""} ${t.url || ""}`.toLowerCase().includes(q)) : tabs;
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        return {
          total: filtered.length,
          tabs: filtered.slice(0, limit).map((t) => ({
            id: String(t.id ?? ""),
            title: String(t.title ?? ""),
            url: String(t.url ?? ""),
          })),
        };
      },
    },
    {
      name: "chrome_tab_select",
      description: "Activate one tab by id. Does not navigate or close.",
      parameters: {
        tabId: { type: "string", required: true, description: "Tab id from chrome_tabs_list." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            activeTabId: { type: "string", required: true },
          },
        },
        render: (_args, value) => textBlock(JSON.stringify(value)),
      },
      async execute(args, exec) {
        const r = await send("tab.activate", { tabId: args.tabId }, 15000, exec);
        return { ok: r?.ok !== false, activeTabId: String(r?.activeTabId ?? args.tabId) };
      },
    },
    {
      name: "chrome_tab_new",
      description: "Open a new background tab, optionally with a URL. Tracked as an owned tab for later cleanup.",
      parameters: {
        url: { type: "string", description: "https URL to open. Defaults to about:blank." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", required: true },
            title: { type: "string", required: true },
            url: { type: "string", required: true },
          },
        },
        render: (_args, value) => textBlock(JSON.stringify(value)),
      },
      async execute(args, exec) {
        if (args.url !== undefined) {
          const blocked = isBlockedUrl(args.url, config.blockPrivateIPs);
          if (blocked) throw new Error(`navigation blocked: ${blocked}`);
        }
        const r = await send("tab.new", { url: args.url }, 15000, exec);
        return { id: String(r?.id ?? ""), title: String(r?.title ?? ""), url: String(r?.url ?? args.url ?? "about:blank") };
      },
    },
    {
      name: "chrome_tab_close",
      description: "Close one tab by id.",
      parameters: {
        tabId: { type: "string", required: true, description: "Tab id from chrome_tabs_list." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            closed: { type: "string", required: true },
          },
        },
        render: (_args, value) => textBlock(JSON.stringify(value)),
      },
      async execute(args, exec) {
        await send("tab.close", { tabId: args.tabId }, 15000, exec);
        return { closed: String(args.tabId) };
      },
    },
    {
      name: "chrome_snapshot",
      description: "Capture accessibility snapshot of a tab. Returns refs like [ref=12] for later actions. Prefer this over screenshot for reading.",
      parameters: {
        tabId: { type: "string", description: "Defaults to active tab." },
        maxChars: { type: "integer", description: "Max snapshot chars (1000-20000)." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            snapshot: { type: "string", required: true },
            truncated: { type: "integer", required: true },
          },
        },
        render: (_args, value) => textBlock(value.snapshot),
      },
      async execute(args, exec) {
        const result = await send("page.snapshot", { tabId: args.tabId }, 20000, exec);
        const out = truncate(String(result?.snapshot ?? ""), Number(args.maxChars) || config.snapshotMaxChars);
        return { snapshot: out.text, truncated: out.truncated };
      },
    },
    {
      name: "chrome_navigate",
      description: "Navigate a tab to an https URL. Private hosts are blocked.",
      parameters: {
        url: { type: "string", required: true, description: "https URL to open." },
        tabId: { type: "string", description: "Defaults to active tab." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            url: { type: "string", required: true },
            title: { type: "string", required: true },
          },
        },
        render: (_args, value) => textBlock(JSON.stringify(value)),
      },
      async execute(args, exec) {
        const blocked = isBlockedUrl(args.url, config.blockPrivateIPs);
        if (blocked) throw new Error(`navigation blocked: ${blocked}`);
        const r = await send("page.navigate", { url: args.url, tabId: args.tabId }, 30000, exec);
        return { ok: r?.ok !== false, url: String(r?.url ?? args.url), title: String(r?.title ?? "") };
      },
    },
    {
      name: "chrome_screenshot",
      description: "Screenshot a tab to a file. Returns path and size, not image bytes.",
      parameters: {
        tabId: { type: "string", description: "Defaults to active tab." },
        fullPage: { type: "boolean", description: "Full page costs more; default viewport only." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", required: true },
            bytes: { type: "integer", required: true },
            width: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
            height: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
          },
        },
        render: (_args, value) => textBlock(JSON.stringify(value)),
      },
      async execute(args, exec) {
        if (args.fullPage === true) throw new Error("fullPage is not supported in 0.1.0 (viewport only)");
        const shot = await send("page.screenshot", { tabId: args.tabId }, 30000, exec);
        return saveScreenshot(config.dataDir, sessionKey, shot?.dataUrl);
      },
    },
    {
      name: "chrome_evaluate",
      description: "Run a read-only JavaScript expression in the page and return a truncated JSON result.",
      parameters: {
        expression: { type: "string", required: true, description: "Single JS expression, e.g. document.title." },
        tabId: { type: "string", description: "Defaults to active tab." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            value: { type: "string", required: true },
            truncated: { type: "integer", required: true },
          },
        },
        render: (_args, value) => textBlock(value.value),
      },
      async execute(args, exec) {
        const result = await send(
          "page.evaluate",
          { expression: args.expression, tabId: args.tabId },
          20000,
          exec,
        );
        const text = JSON.stringify(result?.value ?? result);
        const out = truncate(text, config.evaluateMaxChars);
        return { value: out.text, truncated: out.truncated };
      },
    },
  ];
}
