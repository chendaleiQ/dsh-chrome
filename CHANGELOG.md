# Changelog

## 0.1.1 — 2026-11-17

- 新增 `chrome_fill`：CSP 安全的表单填写（静态注入函数，无 eval），discover 先拿选择器。
  New `chrome_fill`: CSP-safe form fill via a static injected function (no eval).
- 新增 `chrome_onboard`：扩展没连上时打开文件管理器定位扩展目录，首次加载自动做一次。
- 扩展 UI 卡片式重做 + 全量 chrome.i18n（en + zh_CN）；工具描述、README/DETAIL/TESTING 中英双语。
- 安装流程：一键 `scripts/setup.mjs`、`--install-launchd` 开机自启、`scripts/bridge.mjs` 独立入口、market 索引（Discover 可搜）。
- 修过两个真 bug：EADDRINUSE 未接住会崩宿主（现降级为 client）；空闲轮询 return 跳过紧循环（现统一收敛）。

## 0.1.0 — 2026-11-17

- 立项：Host-only bundle 骨架（`src/index.js` 7 个 `chrome_*` 工具 + `src/bridge-client.js` + `src/bridge-server.js`）。
- 自有 MV3 companion（`extension/`）：`GET /next` 长轮询 + `POST /result` 回传，先实现 `tab.version/list/activate`。
- 已验证：`manifest` / `guard`（私有网段硬拒）/ `bridge`（无扩展时超时）/ `e2e`（fake 扩展完整回路）4 项测试全过。
- 修过一个真 bug：`command` 入队对象带 `timer/resolve`，直接序列化会报 circular，`wireCommand` 只发 `id/action/params`。
