# 真机验证手册

目标：证明 DSH 的桥能操控你已登录的 Chrome。只读先行，写操作后置。

## 前置

- Chrome 已加载 `projects/dsh-chrome/extension/`（未打包目录），且与仓库同版本
  （改了扩展代码必须在 `chrome://extensions` 点刷新；怀疑版本 stale 就删掉重加）。
- 注意和旧的 **Pi Chrome Connector** 区分，我们这家叫 **DSH Chrome Connector**。

## 1. 起桥

```bash
cd projects/dsh-chrome
node -e "import('./src/bridge-server.js').then(async ({ createBridge }) => { const b = createBridge({ host: '127.0.0.1', port: 17319 }); await b.listen(); console.log('BRIDGE_UP'); setInterval(() => {}, 1000); })"
```

## 2. 看连接

```bash
curl -s http://127.0.0.1:17319/status
```

- `connected:false, lastSeenAt:0` = 扩展一次都没来过 → 点工具栏图标 → 「立即连接」。
- `connected:true` = 通了，继续第 3 步。
  - 注意：`connected` 是 5 分钟心跳窗口，可能是残留假阳性；
    真正的证明是第 3 步 `tab.version` 能回来（`verify.mjs` 就是这么判的，
    只看 `connected` 不算数，要看命令往返）。

## 3. 只读验证（不碰页面）

一键跑（等扩展 120 秒，超时退出码 2）：

```bash
node scripts/verify.mjs
node scripts/verify.mjs --snapshot   # 加抓一次当前页快照
```

手动版：

```bash
# 握手：应返回 { extensionVersion, bridge, userAgent }
curl -s -X POST http://127.0.0.1:17319/command \
  -H 'content-type: application/json' \
  -d '{"action":"tab.version","params":{},"timeoutMs":15000}'

# 列标签页：应返回数组 [{ id, title, url }]
curl -s -X POST http://127.0.0.1:17319/command \
  -H 'content-type: application/json' \
  -d '{"action":"tab.list","params":{},"timeoutMs":15000}'
```

## 4. 写操作（逐个确认后再做）

`page.navigate` / `tab.activate` / `page.evaluate` 走 DSH 审批；
`page.screenshot` 只回 dataUrl，由 Host 落盘。整页截图 0.1.0 不支持。

## 排错

| 现象 | 查哪里 |
|---|---|
| `/status` 永远 `connected:false` | 扩展版本 stale（删掉重加）、点错图标（Pi vs DSH）、SW 被杀（点图标唤醒） |
| `/command` 504 超时 | 扩展在线但动作卡住；看扩展 SW 控制台报错 |
| `tab.list` 空数组 | 无打开标签页，或扩展无 `tabs` 权限（重装） |
