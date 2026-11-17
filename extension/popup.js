/* Popup: show bridge status, nudge the service worker to poll now. */
const BRIDGE = "http://127.0.0.1:17319";

async function refresh() {
  const el = document.getElementById("status");
  let hb = null;
  try {
    ({ swHeartbeat: hb = null } = await chrome.storage.local.get("swHeartbeat"));
  } catch { /* ignore */ }
  const hbLine = hb
    ? `\nSW 心跳: #${hb.polls} ${hb.state} (${Math.round((Date.now() - hb.at) / 1000)}s前, v${hb.version || "?"})`
    : `\nSW 心跳: 无（service worker 还没跑过一次轮询）`;
  try {
    const res = await fetch(`${BRIDGE}/status`, { cache: "no-store" });
    const st = await res.json();
    el.innerHTML = (st.connected
      ? `<span class="ok">● 已连接</span>\nlastSeen: ${new Date(st.lastSeenAt).toLocaleTimeString()}\nclient: ${st.clientName || "(unknown)"}`
      : `<span class="bad">○ 未连接</span>\n桥在线，扩展还没轮询到。点「立即连接」。`) + hbLine;
  } catch (e) {
    el.innerHTML = `<span class="bad">○ 桥没在跑</span>\n${String(e).slice(0, 120)}` + hbLine;
  }
}

document.getElementById("retry").addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "poll-now" });
  } catch {
    // service worker 尚未唤醒：popup 自身触发一次直连探测即可唤醒
  }
  setTimeout(refresh, 1500);
});

refresh();
