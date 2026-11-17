# Chrome 操控 · Chrome control

读取标签页、抓取页面快照、导航、截图、在本地 Chrome 里执行 JS 取值。
Read tabs, snapshot pages, navigate, screenshot, and evaluate JS in local Chrome.

桥默认 `http://127.0.0.1:17319`，只听本机。Bridge listens on loopback only.

- `chrome_status`：先调它，失败再查桥与扩展版本。Check connection first.
- `chrome_tabs_list` / `chrome_snapshot`：先看列表与快照，截图只是确认。
  List tabs and snapshot first; screenshot only to confirm.
- `chrome_navigate` / `chrome_tab_select` / `chrome_tab_new` / `chrome_tab_close` /
  `chrome_fill` / `chrome_evaluate`：写操作与最高危取值，走 DSH 审批；私有网段直接硬拒。
  Writes and eval go through DSH approval; private hosts are hard-rejected.
  `chrome_fill` 无 eval，CSP 页面（npmjs.com 这类）也能填表点按钮。
  `chrome_fill` uses no eval, so it works even under strict page CSP.
- 截图只回文件 path，不把 base64 塞进上下文；快照与求值超长截断。
  Screenshots return file paths (no base64); snapshots/evals truncate.

限制 / Limits：读（快照/求值）与填表不走 debugger，没有横条；
截图用 debugger 直抓合成图，后台标签也能截，但抓的那一下有调试横条，且与
DevTools 互斥（同一标签页不能同时开着 DevTools）。Reads and fills are
debugger-free; screenshots attach the debugger (background tabs OK) with a
banner shown during capture, mutually exclusive with DevTools.
隐藏标签页的真实输入会被 Chrome 丢弃；整页截图会滚动页面（0.1.0 只做可视区）。
Hidden-tab trusted input is dropped by Chrome; full-page capture scrolls the
page (viewport only in 0.1.0).
