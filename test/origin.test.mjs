import test from "node:test";
import assert from "node:assert/strict";
import { isExtensionRequest } from "../src/bridge-server.js";

const req = (headers) => ({ headers });

test("origin matrix: extension fetch passes, pages and navigations fail", () => {
  // 本机工具（curl/Node）：无头直接过
  assert.equal(isExtensionRequest(req({})), true);
  // MV3 service worker 的实际请求头（线上抓到的）：无 Origin + sfs none + cors
  assert.equal(isExtensionRequest(req({ origin: undefined, "sec-fetch-site": "none", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })), true);
  // 兼容：chrome-extension Origin 显式放行
  assert.equal(isExtensionRequest(req({ origin: "chrome-extension://abcdef" })), true);
  // 网页来源一律拒绝
  assert.equal(isExtensionRequest(req({ origin: "https://evil.example/" })), false);
  assert.equal(isExtensionRequest(req({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" })), false);
  // 地址栏导航拒绝（mode 不是 fetch）
  assert.equal(isExtensionRequest(req({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })), false);
});
