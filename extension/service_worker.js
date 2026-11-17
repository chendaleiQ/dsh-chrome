/* DSH Chrome Connector — service worker.
 * Polls GET /next (25s long-poll), executes tab/page actions,
 * POSTs back to /result. Matches projects/dsh-chrome/src/bridge-server.js.
 *
 * Wire actions implemented:
 *   tab.version / tab.list / tab.activate / tab.new / tab.close
 *   page.navigate / page.snapshot / page.screenshot / page.evaluate / page.fill
 * Everything else returns an explicit "unsupported in 0.1.0" error (fail-closed).
 */
const BRIDGE = "http://127.0.0.1:17319";
const EXT_VERSION = "0.1.0";
let polling = false;
let uidSeq = 0;

async function pollOnce() {
  if (polling) return;
  polling = true;
  await heartbeat("attempt", false);
  try {
    const res = await fetch(`${BRIDGE}/next?name=${encodeURIComponent("DSH Chrome Connector")}`, { cache: "no-store" });
    if (res.ok) {
      const msg = await res.json().catch(() => null);
      if (msg && msg.type === "command" && msg.command) {
        const { id, action, params } = msg.command;
        try {
          const result = await handleAction(action, params || {});
          await postResult({ id, ok: true, result });
          await heartbeat("command");
        } catch (e) {
          await postResult({ id, ok: false, error: String((e && e.message) || e) });
          await heartbeat("command-error");
        }
      } else {
        await heartbeat("idle");
      }
    } else {
      await heartbeat(`http-${res.status}`);
    }
  } catch {
    await heartbeat("fetch-failed");
    // bridge down — 歇 2 秒再试，避免空转打满循环
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    polling = false;
  }
  // 紧循环：有无命令都立刻下一次 /next（服务端 hold 25s，空闲开销可忽略）。
  // 靠这个保证命令下发延迟在秒级，而不是等 30-60s 的闹钟。
  pollOnce();
}

// 每次轮询都写 storage：popup 直接读，不靠 SW 存活。用户报问题时看这三行就够。
async function heartbeat(state, bump = true) {
  try {
    const { swHeartbeat = {} } = await chrome.storage.local.get("swHeartbeat");
    const polls = (swHeartbeat.polls || 0) + (bump ? 1 : 0);
    await chrome.storage.local.set({
      swHeartbeat: { polls, state, at: Date.now(), version: EXT_VERSION },
    });
    console.log(`[dsh-chrome] poll #${polls}: ${state}`);
  } catch {
    // storage 不可用也不影响轮询本身
  }
}

async function postResult(body) {
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch(`${BRIDGE}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
}

async function rememberOwnedTab(id) {
  const { ownedTabs = [] } = await chrome.storage.local.get("ownedTabs");
  const key = String(id);
  if (!ownedTabs.includes(key)) {
    ownedTabs.push(key);
    await chrome.storage.local.set({ ownedTabs });
  }
}

async function forgetOwnedTab(id) {
  const { ownedTabs = [] } = await chrome.storage.local.get("ownedTabs");
  await chrome.storage.local.set({ ownedTabs: ownedTabs.filter((t) => t !== String(id)) });
}

function dbgTarget(id) {
  return { tabId: id };
}

async function attachDebugger(id) {
  try {
    await chrome.debugger.attach(dbgTarget(id), "1.3");
  } catch (e) {
    throw new Error("debugger attach failed (DevTools may be open on this tab): " + ((e && e.message) || e));
  }
}

function sendDebugger(id, method, params) {
  return chrome.debugger.sendCommand(dbgTarget(id), method, params);
}

async function detachDebugger(id) {
  try {
    await chrome.debugger.detach(dbgTarget(id));
  } catch {
    // 已经掉了就不用管
  }
}

async function resolveTabId(params) {
  if (params.tabId !== undefined && params.tabId !== null && params.tabId !== "") {
    const id = Number(params.tabId);
    if (!Number.isFinite(id)) throw new Error(`invalid tabId: ${params.tabId}`);
    return id;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active || active.id === undefined) throw new Error("no active tab");
  return active.id;
}

async function handleAction(action, params) {
  switch (action) {
    case "tab.version":
      return { extensionVersion: EXT_VERSION, bridge: BRIDGE, userAgent: navigator.userAgent };
    case "tab.list": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({ id: String(t.id), title: t.title || "", url: t.url || "" }));
    }
    case "tab.activate": {
      if (params.tabId === undefined) throw new Error("missing tabId");
      const id = await resolveTabId(params);
      const tab = await chrome.tabs.update(id, { active: true });
      return { ok: true, activeTabId: String(tab.id) };
    };
    case "tab.close": {
      if (params.tabId === undefined) throw new Error("missing tabId");
      const id = await resolveTabId(params);
      await chrome.tabs.remove(id);
      await forgetOwnedTab(id);
      return { closed: String(params.tabId) };
    }
    case "tab.new": {
      const tab = await chrome.tabs.create({
        url: typeof params.url === "string" && params.url !== "" ? params.url : "about:blank",
        active: false,
      });
      await rememberOwnedTab(tab.id);
      return { id: String(tab.id), title: tab.title || "", url: tab.pendingUrl || tab.url || "" };
    }
    case "page.navigate": {
      if (typeof params.url !== "string" || params.url === "") throw new Error("missing url");
      const id = await resolveTabId(params);
      const tab = await chrome.tabs.update(id, { url: params.url });
      return { ok: true, url: tab.pendingUrl || tab.url || params.url, title: tab.title || "" };
    }
    case "page.snapshot": {
      const id = await resolveTabId(params);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: snapshotPage,
      });
      const maxNodes = Math.max(10, Math.min(500, Number(params.maxNodes) || 120));
      const nodes = Array.isArray(result) ? result.slice(0, maxNodes) : [];
      const lines = nodes.map((n) => `[ref=${n.uid}] ${n.role} ${JSON.stringify(n.name || "").slice(0, 80)}`.trim());
      const refId = `snap-${Date.now().toString(36)}-${(uidSeq += 1)}`;
      return { snapshot: lines.join("\n"), refId, truncated: Array.isArray(result) ? result.length - nodes.length : 0 };
    }
    case "page.screenshot": {
      // 后台可截：debugger 挂到指定 tab 上直接抓 compositor 合成图，
      // 不需要把 tab 切到前台。代价：抓的那一下有调试横条，且与 DevTools 互斥。
      const id = await resolveTabId(params);
      await attachDebugger(id);
      try {
        const { data } = await sendDebugger(id, "Page.captureScreenshot", { format: "png", fromSurface: true });
        return { dataUrl: "data:image/png;base64," + data, fullPage: false, tabId: String(id) };
      } finally {
        await detachDebugger(id);
      }
    }
    case "page.fill": {
      const id = await resolveTabId(params);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: fillPage,
        args: [params.mode === "discover" ? "discover" : "fill", Array.isArray(params.fields) ? params.fields : []],
      });
      return result;
    }
    case "page.evaluate": {
      if (typeof params.expression !== "string" || params.expression === "") throw new Error("missing expression");
      const id = await resolveTabId(params);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: "MAIN",
        func: (expr) => {
          try {
            // eslint-disable-next-line no-eval
            const value = eval(expr);
            return { ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
          } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
          }
        },
        args: [params.expression],
      });
      if (!result || result.ok !== true) throw new Error((result && result.error) || "evaluate failed");
      return { value: result.value };
    }
    default:
      throw new Error(`unsupported in 0.1.0: ${action}`);
  }
}

/** Runs in the page (isolated world): flat accessible-ish element list. */
function snapshotPage() {
  const out = [];
  let n = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode() && out.length < 500) {
    const el = walker.currentNode;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (["script", "style", "noscript", "svg", "path"].includes(tag)) continue;
    const role = el.getAttribute("role") || tag;
    const name = (el.getAttribute("aria-label") || el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name && !["a", "button", "input", "select", "textarea"].includes(tag)) continue;
    n += 1;
    out.push({ uid: `el-${n}`, role, name });
  }
  return out;
}

/**
 * Runs in the page (isolated world). Fully static — no eval, so page CSP
 * (and the extension's own CSP) cannot block it.
 * mode "discover": list visible form controls with generated selectors.
 * mode "fill": [{ selector, value?, click? }] — set values with native
 * setters + input/change events (React-friendly), or click.
 */
function fillPage(mode, fields) {
  const cssPath = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children, (c) => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += ":nth-of-type(" + (sibs.indexOf(cur) + 1) + ")";
      }
      parts.unshift(seg);
      cur = parent;
    }
    return parts.join(" > ");
  };
  const labelOf = (el) => {
    if (el.id) {
      const lab = document.querySelector('label[for="' + el.id + '"]');
      if (lab && lab.innerText) return lab.innerText.trim().replace(/\s+/g, " ").slice(0, 80);
    }
    return ((el.getAttribute("aria-label") || el.placeholder || el.name || "").trim().replace(/\s+/g, " ").slice(0, 80));
  };
  if (mode === "discover") {
    const els = Array.prototype.filter.call(
      document.querySelectorAll("input, select, textarea, button"),
      (e) => e.offsetParent !== null,
    );
    return {
      fields: els.slice(0, 50).map((el) => ({
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        label: labelOf(el),
      })),
    };
  }
  const out = [];
  for (const f of fields) {
    const el = document.querySelector(f.selector);
    if (!el) {
      out.push({ selector: f.selector, ok: false, error: "not found" });
      continue;
    }
    if (f.click) {
      el.click();
      out.push({ selector: f.selector, ok: true, clicked: true });
      continue;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const want = String(f.value === undefined ? "" : f.value).trim();
      const opts = Array.prototype.slice.call(el.options);
      const idx = opts.findIndex((o) => o.value === f.value || o.text.trim() === want);
      if (idx < 0) {
        out.push({ selector: f.selector, ok: false, error: "option not found" });
        continue;
      }
      el.selectedIndex = idx;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      out.push({ selector: f.selector, ok: true });
      continue;
    }
    if (el.type === "checkbox") {
      el.checked = !!f.value && f.value !== "false" && f.value !== "0";
      el.dispatchEvent(new Event("change", { bubbles: true }));
      out.push({ selector: f.selector, ok: true });
      continue;
    }
    const proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, String(f.value === undefined ? "" : f.value));
    else el.value = f.value === undefined ? "" : f.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    out.push({ selector: f.selector, ok: true });
  }
  return { fields: out };
}

chrome.runtime.onInstalled.addListener(() => {
  // 0.5 分钟是期望值：Chrome 会按自身下限钳制，失败也不影响轮询（setInterval + poll-now 兜底）。
  try {
    chrome.alarms.create("dsh-bridge-keepalive", { periodInMinutes: 0.5 });
  } catch {
    // 无闹钟也能跑：前台 pollOnce + 弹窗手动唤醒
  }
  pollOnce();
});
chrome.runtime.onStartup.addListener(() => pollOnce());
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "poll-now") pollOnce();
});
chrome.alarms.onAlarm.addListener(() => pollOnce());
setInterval(pollOnce, 1000);
pollOnce();
