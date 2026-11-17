# Chrome control

Read tabs, snapshot page structure, navigate, screenshot, and evaluate JS in local Chrome.

行为对照 pi-chrome（MIT），代码与扩展全部重写。桥默认 `http://127.0.0.1:17319`，只听本机。

- `chrome_status`：先调它，失败再查桥与扩展版本。
- `chrome_tabs_list` / `chrome_snapshot`：先看列表与快照，截图只是确认。
- `chrome_navigate` / `chrome_tab_select` / `chrome_evaluate`：写操作与最高危取值，走 DSH 审批；私有网段直接硬拒。
- 截图只回文件 path，不把 base64 塞进上下文；快照与求值超长截断。

限制：debugger 同一时间只能一方 attach（DevTools 正在调就互斥）；隐藏标签页的真实输入会被 Chrome 丢弃；整页截图会滚动页面。
