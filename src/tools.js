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
 * 把 per-property DSL（{ type, required, description, ... }，与 DSH
 * defineTool 的 ParameterSchemaSpec/ValueSchemaSpec 同形）编译成注册器要的
 * 标准 JSON Schema：required:true 收拢为父级 required 数组，其余原样透传。
 * 只用得到 type/required/description/minimum/maximum/default/const/oneOf/
 * items/properties/additionalProperties —— 够覆盖本包全部 9 个工具。
 */
function compileNode(spec) {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return spec;
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === "required" || k === "properties" || k === "items" || k === "oneOf") continue;
    out[k] = v;
  }
  if (spec.properties && typeof spec.properties === "object") {
    const compiled = compilePropertyMap(spec.properties);
    out.properties = compiled.properties;
    if (compiled.required !== undefined) out.required = compiled.required;
  }
  if (spec.items !== undefined) {
    out.items = Array.isArray(spec.items) ? spec.items.map(compileNode) : compileNode(spec.items);
  }
  if (Array.isArray(spec.oneOf)) out.oneOf = spec.oneOf.map(compileNode);
  return out;
}

function compilePropertyMap(propMap) {
  const properties = {};
  const required = [];
  for (const [k, v] of Object.entries(propMap)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const { required: req, ...rest } = v;
      properties[k] = compileNode(rest);
      if (req === true) required.push(k);
    } else {
      properties[k] = compileNode(v);
    }
  }
  return { properties, ...(required.length > 0 ? { required } : {}) };
}

/** 编译单个工具定义为注册器可直接吃的形态（含参数校验包装）。 */
export function compileToolDefinition(def) {
  const compiledParams = {
    type: "object",
    properties: compilePropertyMap(def.parameters || {}).properties,
    ...(() => {
      const { required } = compilePropertyMap(def.parameters || {});
      return required !== undefined ? { required } : {};
    })(),
  };
  const compiledSchema = compileNode(def.output.schema);
  const checkType = (t, v) => {
    if (t === "string") return typeof v === "string";
    if (t === "boolean") return typeof v === "boolean";
    if (t === "integer") return Number.isInteger(v);
    if (t === "number") return typeof v === "number";
    return true;
  };
  return {
    name: def.name,
    description: def.description,
    parameters: compiledParams,
    output: { schema: compiledSchema, render: def.output.render },
    async execute(args, exec) {
      const a = args === null || typeof args !== "object" ? {} : args;
      const violations = [];
      for (const [k, spec] of Object.entries(def.parameters || {})) {
        const s = spec !== null && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
        if (a[k] === undefined) {
          if (s.required === true) violations.push(`${k}: required`);
        } else if (s.type !== undefined && !checkType(s.type, a[k])) {
          violations.push(`${k}: expected ${s.type}`);
        }
      }
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join("; ")}`);
      return def.execute(a, exec);
    },
  };
}

/**
 * @param deps.send (action, params, timeoutMs, exec) => Promise<result>
 * @param deps.bridgeStatus () => Promise<status>
 * @param deps.config resolved config
 * @param deps.saveScreenshot (dataDir, sessionKey, dataUrl) => { path, bytes, width, height }
 * @param deps.sessionKey stable session key
 * @param deps.doOnboard () => Promise<onboard result>
 * @returns plain tool definitions ({ name, description, parameters, output, execute })
 */
export function buildTools({ send, bridgeStatus, config, saveScreenshot, sessionKey, doOnboard }) {
  return [
    {
      name: "chrome_onboard",
      description: "引导安装 Chrome 扩展：桥不通或扩展没连上时调它，会打开文件管理器定位扩展目录并返回步骤。Guide extension setup: opens the file manager at the extension folder and returns steps.",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            connected: { type: "boolean", required: true },
            bridgeUp: { type: "boolean", required: true },
            extensionDir: { type: "string", required: true },
            opened: { type: "boolean", required: true },
            steps: { type: "array", required: true, items: { type: "string" } },
          },
        },
        render: (_args, value) => textBlock([`connected: ${value.connected}`, `extensionDir: ${value.extensionDir}`, ...value.steps].join("\n")),
      },
      async execute(args, exec) {
        void args;
        void exec;
        return doOnboard();
      },
    },
    {
      name: "chrome_status",
      description: "检查本地 Chrome 桥连接状态；其他 chrome_* 出错时先调它。Check the local Chrome bridge connection; call first when other chrome_* tools fail.",
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
      description: "列出已打开的标签页（有界输出）。List open tabs with bounded output.",
      parameters: {
        limit: { type: "integer", description: "最多返回几个（1-50，默认 20）。Max tabs to return (1-50, default 20)." },
        query: { type: "string", description: "按标题或 URL 子串过滤。Substring filter on title or url." },
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
      description: "按 id 激活一个标签页；不导航、不关闭。Activate one tab by id; no navigation or close.",
      parameters: {
        tabId: { type: "string", required: true, description: "chrome_tabs_list 给出的 id。Tab id from chrome_tabs_list." },
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
      description: "后台开一个新标签页（可选 URL），记为自有标签待清理。Open a new background tab, optionally with a URL; tracked as owned.",
      parameters: {
        url: { type: "string", description: "要打开的 https URL，默认 about:blank。URL to open; defaults to about:blank." },
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
      description: "按 id 关闭一个标签页。Close one tab by id.",
      parameters: {
        tabId: { type: "string", required: true, description: "chrome_tabs_list 给出的 id。Tab id from chrome_tabs_list." },
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
      description: "抓取标签页无障碍快照，返回 [ref=N] 供后续操作；阅读优先用它而不是截图。Capture an accessibility snapshot with [ref=N] handles; prefer this over screenshots for reading.",
      parameters: {
        tabId: { type: "string", description: "默认当前活动标签页。Defaults to the active tab." },
        maxChars: { type: "integer", description: "快照最大字符数（1000-20000）。Max snapshot chars (1000-20000)." },
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
      description: "导航到 https URL；私有地址直接拒绝。Navigate to an https URL; private hosts are rejected.",
      parameters: {
        url: { type: "string", required: true, description: "要打开的 https URL。https URL to open." },
        tabId: { type: "string", description: "默认当前活动标签页。Defaults to the active tab." },
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
      description: "截屏落盘，只返回 path 和尺寸，不回图片字节。Screenshot to a file; returns path and size, not image bytes.",
      parameters: {
        tabId: { type: "string", description: "默认当前活动标签页。Defaults to the active tab." },
        fullPage: { type: "boolean", description: "整页更耗资源；默认只截可视区。Full page costs more; default viewport only." },
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
      description: "在页面里执行只读 JS 表达式，返回截断后的 JSON。Evaluate a read-only JS expression; returns truncated JSON.",
      parameters: {
        expression: { type: "string", required: true, description: "单个 JS 表达式，如 document.title。Single JS expression, e.g. document.title." },
        tabId: { type: "string", description: "默认当前活动标签页。Defaults to the active tab." },
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
