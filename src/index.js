/**
 * dsh-chrome — Host 侧入口（全新重写）。
 *
 * 工具定义在 src/tools.js（纯模块，可单测），这里只做三件事：
 * 1) 起回环桥（被占则当 client）；2) 用 defineTool 包装后注册；
 * 3) 注入一段极简系统提示。defineTool 来自随 DSH 发货的包，
 * bundle 不声明依赖（见 dsh.bundle.patch 说明）。
 *
 * loader 行 id、package 名、本文件的 `name` 三者必须一致。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { bridgeSend, bridgeStatus, bridgeUrlOf } from "./bridge-client.js";
import { ensureBridge } from "./auto-bridge.js";
import { saveScreenshot } from "./screenshot.js";
import { buildTools } from "./tools.js";

export const name = "@chendaleiq/dsh-chrome";

export const inject = ["tools", "systemPrompt"];

const DEFAULTS = {
  enabled: true,
  bridgeHost: "127.0.0.1",
  bridgePort: 17319,
  approvalPolicy: "read-auto",
  requireApprovalFor: ["chrome_navigate", "chrome_evaluate", "chrome_tab_select", "chrome_tab_new", "chrome_tab_close"],
  blockPrivateIPs: true,
  snapshotMaxChars: 8000,
  evaluateMaxChars: 4000,
  screenshotMaxBytes: 512000,
  autoStartBridge: true,
  dataDir: "",
};

function resolveConfig(raw) {
  const config = { ...DEFAULTS };
  if (raw === null || typeof raw !== "object") return config;
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (Array.isArray(fallback)) {
      if (Array.isArray(value)) config[key] = value;
      continue;
    }
    if (typeof value !== typeof fallback) continue;
    config[key] = value;
  }
  return config;
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const baseUrl = bridgeUrlOf(config);
  const disposers = [];
  const SESSION_KEY = "session:dsh-chrome";

  if (config.autoStartBridge !== false) {
    try {
      const auto = ensureBridge({ bridgeHost: config.bridgeHost, bridgePort: config.bridgePort });
      disposers.push(() => auto.dispose());
    } catch {
      // 起不了就当纯 client，chrome_status 会如实报告
    }
  }

  const send = (action, params = {}, timeoutMs, exec) =>
    bridgeSend(
      baseUrl,
      action,
      { sessionKey: SESSION_KEY, background: true, foreground: false, ...params },
      timeoutMs,
      exec?.signal,
    );

  if (ctx?.systemPrompt?.section) {
    disposers.push(
      ctx.systemPrompt.section({
        name: "tool:chrome",
        text: "Use chrome_snapshot before chrome_screenshot for reading pages. chrome_evaluate is read-only and truncated; navigation and tab changes need approval unless the user already allowed them.",
      }),
    );
  }

  for (const def of buildTools({
    send,
    bridgeStatus: () => bridgeStatus(baseUrl),
    config,
    saveScreenshot,
    sessionKey: SESSION_KEY,
  })) {
    if (!ctx?.tools?.register) throw new Error("dsh-chrome requires ctx.tools.register");
    const dispose = ctx.tools.register(defineTool(def));
    if (typeof dispose === "function") disposers.push(dispose);
  }

  return () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      try {
        dispose();
      } catch {
        // ignore teardown errors
      }
    }
  };
}
