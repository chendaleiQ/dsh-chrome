# Changelog

## Unreleased

- 安装引导：`chrome_onboard` 工具 + 首次加载自动打开文件管理器（`open -R` /
  `explorer /select` / `xdg-open`，`.onboarded` 标记只做一次）。
  Onboarding: `chrome_onboard` tool + auto-reveal on first load.

- 安装流程：一键 `scripts/setup.mjs`（环境检查 + 单测 + 桥状态 + 路径打印），
  `--install-launchd` 开机自启桥；新增 `scripts/bridge.mjs` 独立入口。
  Setup: one-command `scripts/setup.mjs`, `--install-launchd` autostart, new
  `scripts/bridge.mjs` standalone entry.
- 扩展 UI：弹窗改卡片式（状态 + 心跳 + 版本 + 文档入口），全部文案走
  `chrome.i18n`（`_locales/en` + `_locales/zh_CN`）。Popup redesign with full
  chrome.i18n coverage.
- 工具描述中英双语；bundle locale 补齐；README 中英双版。
  Bilingual tool descriptions, bundle locales, README in both languages.

## 0.1.0 — 2026-11-17

- 立项：Host-only bundle 骨架（`src/index.js` 7 个 `chrome_*` 工具 + `src/bridge-client.js` + `src/bridge-server.js`）。
- 自有 MV3 companion（`extension/`）：`GET /next` 长轮询 + `POST /result` 回传，先实现 `tab.version/list/activate`。
- 已验证：`manifest` / `guard`（私有网段硬拒）/ `bridge`（无扩展时超时）/ `e2e`（fake 扩展完整回路）4 项测试全过。
- 修过一个真 bug：`command` 入队对象带 `timer/resolve`，直接序列化会报 circular，`wireCommand` 只发 `id/action/params`。
