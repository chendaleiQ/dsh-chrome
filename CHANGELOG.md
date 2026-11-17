# Changelog

## 0.1.0 — 2026-11-17

- 立项：Host-only bundle 骨架（`src/index.js` 7 个 `chrome_*` 工具 + `src/bridge-client.js` + `src/bridge-server.js`）。
- 自有 MV3 companion（`extension/`）：`GET /next` 长轮询 + `POST /result` 回传，先实现 `tab.version/list/activate`。
- 行为照着 pi-chrome 写（wire action 名与会话/后台语义对齐），代码全部重写，不复用其源码与扩展。
- 已验证：`manifest` / `guard`（私有网段硬拒）/ `bridge`（无扩展时超时）/ `e2e`（fake 扩展完整回路）4 项测试全过。
- 修过一个真 bug：`command` 入队对象带 `timer/resolve`，直接序列化会报 circular，`wireCommand` 只发 `id/action/params`。
