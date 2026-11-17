# dsh-chrome

DeepSeek Harness 用的本地 Chrome 操控插件：连你已经登录的那个 Chrome，能看标签页、抓快照、导航、截图、执行 JS 取值。

> English version: [README.en.md](README.en.md)

## 一分钟上手

```bash
cd projects/dsh-chrome
node scripts/setup.mjs          # 检查环境 + 单测 + 打印下面两步要填的路径
```

1. **装扩展**：`chrome://extensions` → 打开开发者模式 → 「加载已解压的扩展程序」→ 选择 `projects/dsh-chrome/extension/`。认准 **DSH Chrome Connector**。
   （插件首次加载且从没连上过时，会自动帮你打开文件夹定位到这一步；平时连不上就调 `chrome_onboard` 工具，它会再开一次并给步骤。）
2. **起桥**（二选一）：
   - 省事：`node scripts/setup.mjs --install-launchd` —— 开机自启，常驻后台；
   - 或者什么都不做：DSH 插件加载时会自动把桥拉起来（端口被占就当 client 用）。
3. **装进 DSH**：插件页 → Add plugin → 选择本目录（`projects/dsh-chrome`）。装完新开会话就有 10 个 `chrome_*` 工具。
4. **验证**：`npm run verify`（等扩展上线，tab.version + tab.list 一把过）。

## 布局

```text
projects/dsh-chrome/
  package.json          # @chendaleiq/dsh-chrome，Host-only bundle
  cordis.patch.yml      # id/name/config（bridgePort 默认 17319，只听本机）
  src/index.js          # apply(ctx, config)：defineTool 包装后注册 11 个工具
  src/tools.js          # 工具定义（纯模块，可单测；defineTool 契约见注释）
  src/bridge-client.js  # 最小 wire 协议客户端
  src/bridge-server.js  # 本地桥：/status /command /next（25s 长轮询）/result
  src/screenshot.js     # dataUrl 落盘 + PNG 宽高解析
  src/auto-bridge.js    # 桥自启与端口占用降级
  scripts/setup.mjs     # 一键安装检查（含 --install-launchd 开机自启）
  scripts/bridge.mjs    # 桥独立入口（给 LaunchAgent 用）
  scripts/verify.mjs    # 一键真机验证
  extension/            # 自有 MV3 companion：manifest + service worker + popup
  extension/_locales/   # 扩展界面中英双语（en + zh_CN）
  locale/en.json zh.json
  docs/DETAIL.md docs/TESTING.md
  test/*.test.mjs
```

## 工具（11 个）

| 工具 | 要审批 | 说明 |
|---|---|---|
| `chrome_onboard` | 否 | 扩展没连上时调它：打开文件夹定位扩展目录并返回步骤 |
| `chrome_status` | 否 | 桥连通性；别的工具出错先调它 |
| `chrome_tabs_list` | 否 | 标签页列表（有界） |
| `chrome_snapshot` | 否 | 无障碍快照，阅读优先用它而不是截图 |
| `chrome_screenshot` | 否 | 只回文件 path，不回 base64 |
| `chrome_fill` | 是 | 先 discover 拿选择器，再 fill 填值/点按钮；无 eval，CSP 页面可用 |
| `chrome_tab_select` | 是 | 按 id 激活标签页 |
| `chrome_tab_new` | 是 | 后台开新标签页，记为自有 |
| `chrome_tab_close` | 是 | 按 id 关闭标签页 |
| `chrome_navigate` | 是 | 导航；私有网段/非 http(s) 直接硬拒 |
| `chrome_evaluate` | 是 | 页面内只读取值，超长截断 |

输出全部有界：快照/求值截断，截图只给 path。桥只听 `127.0.0.1`，不对外暴露。

## 安全

- 只读默认放行，写操作走 DSH 审批；`navigate` 对 `localhost`/内网段/非 http(s) 同步硬拒。
- 扩展权限收敛到 `tabs/scripting/storage/alarms`，无 `debugger`（不跟 DevTools 抢）。
- 截图与审计落盘默认 `~/.dsh/chrome/<session>/`。

## 状态

- [x] 本地桥协议 + fake 扩展端到端回路
- [x] 真机验证：tab.version / tab.list（13 标签）/ evaluate / snapshot（27 节点）/ screenshot 落盘
- [x] `install_bundle` 进 desktop profile（`application: applied`，零警告）
- [x] 开源：https://github.com/chendaleiQ/dsh-chrome

## 开源

MIT，见 [LICENSE](LICENSE)。`files` 白名单见 `package.json`。

## 获取渠道 / Distribution

| 渠道 | 状态 | 怎么装 |
|---|---|---|
| npm `@chendaleiq/dsh-chrome` | ✅ 已发布（GitHub Actions 自动发版） | `dsh plugin --profile web add @chendaleiq/dsh-chrome`（把 `web` 换成你的 profile 名；`npm i @chendaleiq/dsh-chrome` 也可） |
| GitHub release（含 tarball） | ✅ 已发布 | `dsh plugin add github:chendaleiQ/dsh-chrome` |
| DSH 发现页索引 | 就绪 | 设置 → 插件 → 发现页，加 `market/index.json` 的 raw URL（见 [market/README.md](market/README.md)） |
| 本地目录 | 一直可用 | 插件页 → Add plugin → 选本目录 |
| 第三方大市场 | 见下 | dsh-plugin.org（加 `dsh-plugin` topic 自动收录） · awesome-dsh-plugin（同 topic 每日抓取） · dsh-plugin-shop（npm 关键词自动收录） |
