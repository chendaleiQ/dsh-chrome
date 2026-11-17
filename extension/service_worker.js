/* DSH Chrome Connector — service worker (fresh implementation, no pi-chrome code).
 * Polls GET /next (25s long-poll), executes tab/debugger actions,
 * POSTs back to /result. Matches projects/dsh-chrome/src/bridge-server.js.
 *
 * Wire actions implemented:
 *   tab.version / tab.list / tab.activate
 *   page.navigate / page.snapshot / page.screenshot / page.evaluate
 * Everything else returns an explicit "unsupported in 0.1.0" error (fail-closed).
 */
const BRIDGE = "http://127.0.0.1:17319";
const EXT_VERSION = "0.1.0";
let polling = false;
let uidSeq = 0;

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const res = await fetch(`${BRIDGE}/next?name=${encodeURIComponent("DSH Chrome Connector")}`, { cache: "no-store" });
    if (!res.ok) return;
    const msg = await res.json().catch(() => null);
    if (!msg || msg.type !== "command" || !msg.command) return;
    const { id, action, params } = msg.command;
    try {
      const result = await handleAction(action, params || {});
      await postResult({ id, ok: true, result });
    } catch (e) {
      await postResult({ id, ok: false, error: String((e && e.message) || e) });
    } finally {
      // 紧循环：有命令立刻下一次 /next
      polling = false;
      pollOnce();
    }
  } catch {
    // bridge down — 2s 后由闹钟/interval 重试
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    polling = false;
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
      const id = await resolveTabId(params);
      const windowId = (await chrome.tabs.get(id)).windowId;
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      return { dataUrl, fullPage: false, tabId: String(id) };
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("dsh-bridge-keepalive", { periodInMinutes: 0.5 });
  pollOnce();
});
chrome.runtime.onStartup.addListener(() => pollOnce());
chrome.alarms.onAlarm.addListener(() => pollOnce());
setInterval(pollOnce, 1000);
pollOnce();
