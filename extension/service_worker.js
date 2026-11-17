/* DSH Chrome Connector — service worker.
 * Polls GET /next (25s long-poll), executes tab/page actions,
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
