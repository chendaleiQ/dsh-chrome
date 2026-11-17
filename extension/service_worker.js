/* DSH Chrome Connector — service worker (fresh implementation, no pi-chrome code).
 * Polls GET /next (25s long-poll), executes tab/debugger actions,
 * POSTs back to /result. Matches projects/dsh-chrome/src/bridge-server.js.
 */
const BRIDGE = "http://127.0.0.1:17319";
const EXT_VERSION = "0.1.0";
let polling = false;

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

async function handleAction(action, params) {
  switch (action) {
    case "tab.version":
      return { extensionVersion: EXT_VERSION, bridge: BRIDGE, userAgent: navigator.userAgent };
    case "tab.list": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({ id: String(t.id), title: t.title || "", url: t.url || "" }));
    }
    case "tab.activate": {
      if (!params.tabId) throw new Error("missing tabId");
      await chrome.tabs.update(Number(params.tabId), { active: true });
      return { ok: true, activeTabId: String(params.tabId) };
    }
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("dsh-bridge-keepalive", { periodInMinutes: 0.5 });
  pollOnce();
});
chrome.runtime.onStartup.addListener(() => pollOnce());
chrome.alarms.onAlarm.addListener(() => pollOnce());
setInterval(pollOnce, 1000);
pollOnce();
