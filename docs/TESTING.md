# 真机验证手册 · Real-device verification

目标：证明 DSH 的桥能操控你已登录的 Chrome。只读先行，写操作后置。
Goal: prove the DSH bridge drives your signed-in Chrome. Reads first, writes later.

## 0. 一键安装检查 / Setup check

```bash
node scripts/setup.mjs                 # 环境 + 单测 + 桥状态 + 打印下面要填的路径
node scripts/setup.mjs --install-launchd   # 开机自启桥 / autostart bridge on login
```

## 1. 起桥 / Start the bridge

```bash
node scripts/bridge.mjs                # 常驻前台 / foreground
# DSH 插件加载时也会自动起桥（端口被占就当 client 用）
# The DSH plugin also starts the bridge on load (client fallback if taken).
```

## 2. 看连接 / Check connection

```bash
curl -s http://127.0.0.1:17319/status
```

- `connected:false, lastSeenAt:0` = 扩展一次都没来过 → 点工具栏图标 → 「立即连接」。
  No poll ever → click the toolbar icon → Connect now.
- `connected:true` = 通了，继续第 3 步。Connected → go to step 3.

扩展装不上时看弹窗里的 `SW 心跳` 行：无心跳 = SW 没跑起来，去
`chrome://extensions` 点 Service worker 看红字。
If the popup shows no SW heartbeat, open the extension's Service worker console
and copy the red text.

## 3. 只读验证（不碰页面）/ Read-only verification

一键跑（等扩展 120 秒，超时退出码 2）/ One command (waits 120s, exit 2 on timeout)：

```bash
npm run verify
npm run verify -- --snapshot   # 加抓一次当前页快照 / plus one page snapshot
```

手动版 / Manual：

```bash
# 握手：应返回 { extensionVersion, bridge, userAgent }
# Handshake, expect { extensionVersion, bridge, userAgent }
curl -s -X POST http://127.0.0.1:17319/command \
  -H 'content-type: application/json' \
  -d '{"action":"tab.version","params":{},"timeoutMs":15000}'

# 列标签页：应返回数组 [{ id, title, url }]
# List tabs, expect an array of { id, title, url }
curl -s -X POST http://127.0.0.1:17319/command \
  -H 'content-type: application/json' \
  -d '{"action":"tab.list","params":{},"timeoutMs":15000}'
```

## 4. 写操作（逐个确认后再做）/ Writes (confirm each first)

`page.navigate` / `tab.activate` / `page.evaluate` 走 DSH 审批；
`page.screenshot` 只回 dataUrl，由 Host 落盘。整页截图 0.1.0 不支持。
navigate/activate/evaluate need approval; screenshots return dataUrl for the
Host to save; full-page capture is not supported in 0.1.0.

## 排错 / Troubleshooting

| 现象 / Symptom | 查哪里 / Check |
|---|---|
| `/status` 永远 `connected:false` | 扩展版本 stale（删掉重加）、点错图标、SW 被杀（点图标唤醒）/ stale install (re-add), wrong icon, SW suspended (click icon) |
| `/command` 504 超时 / timeout | 扩展在线但动作卡住，看扩展 SW 控制台报错 / extension stuck; read its SW console |
| `tab.list` 空数组 / empty | 无打开标签页，或扩展无 `tabs` 权限（重装）/ no tabs, or missing permission |
| `http-403` 刷屏 / log spam | 桥版本旧（`--install-launchd` 装的桥和代码不是同一版），重跑 setup / bridge older than extension; re-run setup |
