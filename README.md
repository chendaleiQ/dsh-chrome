# dsh-chrome

DSH 用的本地 Chrome 操控插件：连你已经登录的那个 Chrome，能看标签页、抓快照、导航、截图、执行 JS 取值。

行为对照 pi-chrome（MIT，`research/pi-chrome-upstream` 仅做行为参考，不打包不复制），代码与 companion 扩展全部重写，不依赖已安装的 pi 或 Pi Chrome Connector。

## 状态

- [x] 立项：`package.json` / `cordis.patch.yml` / `src/` / `extension/` / `locale` / `test`
- [ ] 本地桥 + companion 联调（`chrome_status` 先通）
- [ ] 只读链路：`chrome_tabs_list` / `chrome_snapshot` / `chrome_screenshot`
- [ ] 写操作：`chrome_navigate` / `chrome_tab_select` / `chrome_evaluate` + 审批与私有地址硬拒
- [ ] `install_bundle` 装进 DSH 验证
- [ ] 开源到 GitHub

## 布局

```text
projects/dsh-chrome/
  package.json          # @chendaleiq/dsh-chrome，Host-only bundle
  cordis.patch.yml      # id/name/config（bridgePort 默认 17319，与 pi 的 17318 错开）
  src/index.js          # apply(ctx, config)：注册 7 个 chrome_* tools
  src/bridge-client.js  # 自有最小 wire 协议：GET /status，POST /command
  extension/            # 自有 MV3 companion：manifest + service_worker（重写中）
  locale/en.json zh.json
  docs/DETAIL.md
  test/*.test.mjs
```

## 安全

- 只读（status/tabs/snapshot/screenshot）默认放行，写操作（navigate/tab_select/evaluate）走 DSH 审批。
- `navigate` 对私有网段与非 http(s) 直接硬拒。
- 输出全部有界：快照/求值截断，截图只回 path 不回 base64。
- 桥只听 `127.0.0.1`，不对外暴露。

## 开源

MIT，见 [LICENSE](LICENSE)。 shipping 时 `files` 白名单见 `package.json`，`research/pi-chrome-upstream` 不在包里。
