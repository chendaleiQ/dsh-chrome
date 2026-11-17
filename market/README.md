# 发布频道 / Market index

`index.json` 是 DSH 插件市场格式 1 的索引文档（见 DSH 自带的
`@deepseek-ai/dsh-plugin-market-index` 校验器），用户把它加进
DSH「设置 → 插件 → 发现页」的索引 URL，就能在 Discover 里搜到并一键安装。

索引地址（加到 DSH 里）/ Add this URL in DSH Settings → Plugins → Discover：

```text
https://raw.githubusercontent.com/chendaleiQ/dsh-chrome/main/market/index.json
```

## 发新版时 / Releasing a new version

1. 改 `package.json` 的 `version`，更新 `CHANGELOG.md`，提交并推送。
2. 打 tag 并推 tag：`git tag vX.Y.Z && git push origin main --tags`。
3. GitHub release（会顺手产出 tarball）：`gh release create vX.Y.Z --notes "..."`。
4. 在 `market/index.json` 的 `versions` 数组**最前面**加一条：
   `version` = 新版本号，`publishTimestamp` = `date +%s`，
   `source.commit` = tag 对应的 40 位 commit（`git rev-parse vX.Y.Z`）；
   npm 包发了之后再给同一版本加一条 `"type": "npm"` 的 source。
5. 用 DSH 自带校验器验一遍（把下面命令里的路径换成你本机 DSH 的）：
   `parseMarketIndex` 通过 + `marketInstallTarget` 给出 git spec 才算完。
6. 提交推送 `market/index.json`。
