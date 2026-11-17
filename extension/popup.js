/* Popup: show bridge status, nudge the service worker to poll now. */
const BRIDGE = "http://127.0.0.1:17319";

async function refresh() {
  const el = document.getElementById("status");
  try {
    const res = await fetch(`${BRIDGE}/status`, { cache: "no-store" });
    const st = await res.json();
    el.innerHTML = st.connected
      ? `<span class="ok">● 已连接</span>\nlastSeen: ${new Date(st.lastSeenAt).toLocaleTimeString()}\nclient: ${st.clientName || "(unknown)"}`
      : `<span class="bad">○ 未连接</span>\n桥在线，扩展还没轮询到。点「立即连接」。`;
  } catch (e) {
    el.innerHTML = `<span class="bad">○ 桥没在跑</span>\n${String(e).slice(0, 120)}`;
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
