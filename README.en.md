# dsh-chrome

A local Chrome control plugin for DeepSeek Harness: drive the Chrome profile you are
already signed into — list tabs, snapshot pages, navigate, screenshot, and
evaluate JS.

> 中文版：[README.md](README.md)

## Quick start

```bash
cd projects/dsh-chrome
node scripts/setup.mjs          # env checks + tests + prints the paths below
```

1. **Install the extension**: `chrome://extensions` → enable Developer mode →
   “Load unpacked” → pick `projects/dsh-chrome/extension/`. Look for
   **DSH Chrome Connector**.
   (On first load with no connection yet, the plugin opens the folder for you;
   later, call the `chrome_onboard` tool whenever setup help is needed.)
2. **Run the bridge** (either):
   - Hands-free: `node scripts/setup.mjs --install-launchd` — starts on login;
   - Or do nothing: the DSH plugin starts the bridge on load (falls back to
     client mode if the port is taken).
3. **Install into DSH**: Plugins → Add plugin → pick this directory
   (`projects/dsh-chrome`). New sessions get 10 `chrome_*` tools.
4. **Verify**: `npm run verify` (waits for the extension, then tab.version +
   tab.list in one go).

## Layout

```text
projects/dsh-chrome/
  package.json          # @chendaleiq/dsh-chrome, Host-only bundle
  cordis.patch.yml      # id/name/config (bridgePort defaults to 17319, loopback only)
  src/index.js          # apply(ctx, config): wrap with defineTool, register 11 tools
  src/tools.js          # tool definitions (pure module, unit-testable)
  src/bridge-client.js  # minimal wire-protocol client
  src/bridge-server.js  # local bridge: /status /command /next (25s long-poll) /result
  src/screenshot.js     # dataUrl → file + PNG dimension parsing
  src/auto-bridge.js    # bridge autostart with port-taken fallback
  scripts/setup.mjs     # one-command setup check (incl. --install-launchd)
  scripts/bridge.mjs    # standalone bridge entry (used by LaunchAgent)
  scripts/verify.mjs    # one-command real-Chrome verification
  extension/            # MV3 companion: manifest + service worker + popup
  extension/_locales/   # extension UI in English + 简体中文 (en + zh_CN)
  locale/en.json zh.json
  docs/DETAIL.md docs/TESTING.md
  test/*.test.mjs
```

## Tools (11)

| Tool | Approval | Notes |
|---|---|---|
| `chrome_onboard` | no | Setup guide: opens the folder at the extension and returns steps |
| `chrome_status` | no | Bridge health; call first when others fail |
| `chrome_tabs_list` | no | Bounded tab list |
| `chrome_snapshot` | no | Accessibility snapshot; prefer over screenshots for reading |
| `chrome_screenshot` | no | Returns file path only, never base64 |
| `chrome_fill` | yes | Discover selectors first, then fill/click; no eval, CSP-safe |
| `chrome_tab_select` | yes | Activate one tab by id |
| `chrome_tab_new` | yes | Background tab, tracked as owned |
| `chrome_tab_close` | yes | Close one tab by id |
| `chrome_navigate` | yes | Navigate; private hosts hard-rejected |
| `chrome_evaluate` | yes | Read-only page eval, truncated output |

All outputs are bounded: snapshots/evals truncate, screenshots return paths only.
The bridge listens on `127.0.0.1` only.

## Security

- Reads are auto-approved; writes go through DSH approval. `navigate` hard-rejects
  `localhost`/private ranges/non-http(s).
- Extension permissions kept minimal: `tabs/scripting/storage/alarms`, no
  `debugger` (never fights DevTools).
- Screenshots/audit land in `~/.dsh/chrome/<session>/` by default.

## Status

- [x] Bridge protocol + end-to-end loop with a fake extension
- [x] Real-Chrome verification: tab.version / tab.list (13 tabs) / evaluate /
      snapshot (27 nodes) / screenshot saved to disk
- [x] `install_bundle` into the desktop profile (`application: applied`, no warnings)
- [x] Open source: https://github.com/chendaleiQ/dsh-chrome

## License

MIT, see [LICENSE](LICENSE). Shipped files are whitelisted in `package.json`.

## Distribution

| Channel | Status | How |
|---|---|---|
| npm `@chendaleiq/dsh-chrome` | ✅ Published (auto-released by GitHub Actions) | `npm i @chendaleiq/dsh-chrome` |
| GitHub release (with tarball) | ✅ Published | `dsh plugin add github:chendaleiQ/dsh-chrome` |
| DSH Discover index | Ready | Settings → Plugins → Discover, add the raw URL of `market/index.json` (see [market/README.md](market/README.md)) |
| Local directory | Always works | Plugins → Add plugin → pick this directory |
