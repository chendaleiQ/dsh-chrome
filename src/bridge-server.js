/**
 * dsh-chrome — 本地桥服务端。
 *
 *   GET  /status  -> { url, mode, connected, lastSeenAt, clientName, queuedCommands, pendingCommands }
 *   POST /command -> 入队，等待扩展经 GET /next 取走、POST /result 回传后返回
 *   GET  /next    -> 扩展长轮询（最长 25s），有命令返回 { type:"command", command }，无命令返回 { type:"none" }
 *   POST /result  -> 扩展回传 { id, ok, result/error }
 *
 * 安全边界：只听 127.0.0.1；/command 仅接受无 Origin 的本机进程请求；
 * /next、/result 仅接受 chrome-extension:// origin 或无 sec-fetch-site 的请求。
 * 无第三方依赖。
 */

import { createServer } from "node:http";

const VERSION = "0.1.0";

function isLocalProcess(req) {
  return !req.headers.origin && !req.headers["sec-fetch-site"];
}

// 扩展请求判定（关键词：允许无 Origin + 简单 fetch，不允许导航/页面）：
// - MV3 service worker 的 fetch 不带 Origin，带 sec-fetch-site: none + mode: cors；
// - 带 chrome-extension:// Origin 的直接放行；
// - 带其它 Origin（如网页）一律拒绝；
// - 导航模式（地址栏输入）拒绝，只接受 fetch（cors/no-cors）。
// 注意 /command 仍只认本机进程（isLocalProcess），不受此影响。
export function isExtensionRequest(req) {
  const origin = req.headers.origin || "";
  if (origin.startsWith("chrome-extension://")) return true;
  if (origin !== "") return false;
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "none") return false;
  const mode = req.headers["sec-fetch-mode"];
  if (mode !== undefined && mode !== "cors" && mode !== "no-cors") return false;
  return true;
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-dsh-chrome-version": VERSION,
    ...extraHeaders,
  });
  res.end(text);
}

export function createBridge({ host = "127.0.0.1", port = 17319 } = {}) {
  const queue = [];
  const pending = new Map();
  const waiters = new Set();
  let lastSeenAt = 0;
  let clientName = "";
  let seq = 0;

  function status() {
    return {
      url: `http://${host}:${port}`,
      mode: "server",
      connected: Date.now() - lastSeenAt < 5 * 60 * 1000,
      lastSeenAt,
      clientName,
      queuedCommands: queue.length,
      pendingCommands: pending.size,
    };
  }

  function takeNext() {
    const cmd = queue.shift();
    if (!cmd) return null;
    cmd.deliveredAt = Date.now();
    pending.set(cmd.id, cmd);
    return cmd;
  }

  // 发往扩展的线包：只带 id/action/params，内部的 timer/resolve 绝不序列化。
  function wireCommand(cmd) {
    return { id: cmd.id, action: cmd.action, params: cmd.params };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`);
      if (req.method === "GET" && url.pathname === "/status") {
        json(res, 200, status());
        return;
      }
      if (req.method === "POST" && url.pathname === "/command") {
        if (!isLocalProcess(req)) {
          json(res, 403, { ok: false, error: "local process only" });
          return;
        }
        const body = await readJson(req).catch(() => null);
        if (!body || typeof body.action !== "string") {
          json(res, 400, { ok: false, error: "missing action" });
          return;
        }
        const id = `dsh-${Date.now().toString(36)}-${(seq += 1)}`;
        const timeoutMs = Math.max(1000, Math.min(120000, Number(body.timeoutMs) || 30000));
        const cmd = { id, action: body.action, params: body.params || {} };
        const done = new Promise((resolve, reject) => {
          cmd.resolve = resolve;
          cmd.reject = reject;
          cmd.timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for Chrome extension`));
          }, timeoutMs);
        });
        queue.push(cmd);
        for (const w of [...waiters]) {
          waiters.delete(w);
          w(takeNext());
        }
        try {
          const result = await done;
          json(res, 200, { ok: true, result });
        } catch (e) {
          json(res, 504, { ok: false, error: e.message });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/next") {
        if (!isExtensionRequest(req)) {
          const observed = {
            origin: req.headers.origin,
            secFetchSite: req.headers["sec-fetch-site"],
            secFetchMode: req.headers["sec-fetch-mode"],
            secFetchDest: req.headers["sec-fetch-dest"],
          };
          console.error(`[dsh-chrome] /next rejected: ${JSON.stringify(observed)}`);
          json(res, 403, { ok: false, error: "extension only", observed });
          return;
        }
        lastSeenAt = Date.now();
        clientName = String(url.searchParams.get("name") || clientName || "");
        const cmd = takeNext();
        if (cmd) {
          json(res, 200, { type: "command", command: wireCommand(cmd), expectedExtensionVersion: VERSION });
          return;
        }
        const waiter = await new Promise((resolve) => {
          const wrapped = (c) => {
            clearTimeout(t);
            waiters.delete(wrapped);
            resolve(c);
          };
          const t = setTimeout(() => {
            waiters.delete(wrapped);
            resolve(null);
          }, 25000);
          waiters.add(wrapped);
        });
        if (waiter) json(res, 200, { type: "command", command: wireCommand(waiter), expectedExtensionVersion: VERSION });
        else json(res, 200, { type: "none", expectedExtensionVersion: VERSION });
        return;
      }
      if (req.method === "POST" && url.pathname === "/result") {
        if (!isExtensionRequest(req)) {
          const observed = {
            origin: req.headers.origin,
            secFetchSite: req.headers["sec-fetch-site"],
            secFetchMode: req.headers["sec-fetch-mode"],
            secFetchDest: req.headers["sec-fetch-dest"],
          };
          console.error(`[dsh-chrome] /result rejected: ${JSON.stringify(observed)}`);
          json(res, 403, { ok: false, error: "extension only", observed });
          return;
        }
        lastSeenAt = Date.now();
        const body = await readJson(req).catch(() => null);
        const cmd = body && pending.get(body.id);
        if (!cmd) {
          json(res, 404, { ok: false, error: "unknown command id" });
          return;
        }
        pending.delete(body.id);
        clearTimeout(cmd.timer);
        if (body.ok === false) cmd.reject(new Error(String(body.error || "extension error")));
        else cmd.resolve(body.result);
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      try {
        json(res, 500, { ok: false, error: e.message });
      } catch {
        // ignore
      }
    }
  });

  return {
    server,
    status,
    listen: () =>
      new Promise((resolve, reject) => {
        // EADDRINUSE 是异步 'error' 事件：没人听就变未捕获异常。
        // 必须接住，调用方（apply 的 client 降级）才有机会活。
        const onError = (err) => {
          server.off("listening", onListen);
          reject(err);
        };
        const onListen = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListen);
        server.listen(port, host);
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
