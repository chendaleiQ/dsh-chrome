/* Popup: bridge status + service-worker heartbeat + reconnect.
 * All user-visible strings go through chrome.i18n (see _locales/).
 */
const BRIDGE = "http://127.0.0.1:17319";
const DOCS_URL = "https://github.com/chendaleiQ/dsh-chrome#readme";
const t = (key, ...args) => chrome.i18n.getMessage(key, args) || key;

async function refresh() {
  document.title = t("statusTitle");
  document.getElementById("title").textContent = t("statusTitle");
  try {
    document.getElementById("ver").textContent = `v${chrome.runtime.getManifest().version}`;
  } catch { /* ignore */ }
  const retry = document.getElementById("retry");
  retry.textContent = t("connectNow");
  retry.disabled = false;
  document.getElementById("bridge").textContent = `${t("bridgeLabel")}: ${BRIDGE.replace(/^http:\/\//, "")}`;
  const docs = document.getElementById("docs");
  docs.textContent = t("openDocs");
  docs.href = DOCS_URL;

  let hb = null;
  try {
    ({ swHeartbeat: hb = null } = await chrome.storage.local.get("swHeartbeat"));
  } catch { /* ignore */ }
  const hbText = hb
    ? t("statusHeartbeat", String(hb.polls), String(hb.state), String(Math.round((Date.now() - hb.at) / 1000)), String(hb.version || "?"))
    : t("statusHeartbeatNone");

  const statusEl = document.getElementById("status");
  const detailEl = document.getElementById("detail");
  try {
    const res = await fetch(`${BRIDGE}/status`, { cache: "no-store" });
    const st = await res.json();
    if (st.connected) {
      statusEl.innerHTML = `<span class="ok">${escapeHtml(t("statusConnected"))}</span>`;
      detailEl.textContent = `${t("lastSeen", new Date(st.lastSeenAt).toLocaleTimeString())} · ${t("clientLabel", st.clientName || "")}`;
      retry.disabled = true;
    } else {
      statusEl.innerHTML = `<span class="bad">${escapeHtml(t("statusNotConnected"))}</span>`;
      detailEl.textContent = t("statusBodyOnline");
    }
  } catch (e) {
    statusEl.innerHTML = `<span class="bad">${escapeHtml(t("statusBridgeDown"))}</span>`;
    detailEl.textContent = String(e).slice(0, 120);
  }
  document.getElementById("hb").textContent = hbText;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.getElementById("retry").addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "poll-now" });
  } catch {
    // service worker 尚未唤醒：本次点击本身就是一次唤醒尝试
  }
  setTimeout(refresh, 1500);
});

refresh();
