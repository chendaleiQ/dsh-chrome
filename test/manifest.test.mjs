import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("manifest: bundle wiring is consistent", () => {
  assert.equal(pkg.name, "@chendaleiq/dsh-chrome");
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  const patch = readFileSync(join(root, "cordis.patch.yml"), "utf8");
  assert.match(patch, /id: dsh-chrome/);
  assert.match(patch, /name: '@chendaleiq\/dsh-chrome'/);
  assert.ok((pkg.exports["./locale/*.json"]) && pkg.exports["./icon"]);
  for (const f of ["src/index.js", "src/tools.js", "src/auto-bridge.js", "src/bridge-client.js", "src/bridge-server.js", "src/screenshot.js", "extension/manifest.json", "extension/service_worker.js", "extension/popup.html", "extension/popup.js", "cordis.patch.yml", "docs/DETAIL.md", "docs/TESTING.md", "icon.svg", "README.md", "LICENSE", "CHANGELOG.md"]) {
    assert.ok(existsSync(join(root, f)), `missing ${f}`);
  }
  const icon = statSync(join(root, "icon.svg"));
  assert.ok(icon.size <= 256 * 1024, `icon too large: ${icon.size}`);
  const en = JSON.parse(readFileSync(join(root, "locale/en.json"), "utf8"));
  const zh = JSON.parse(readFileSync(join(root, "locale/zh.json"), "utf8"));
  assert.ok(en.meta.title && en.meta.description && en.meta.detail);
  assert.ok(zh.meta.title && zh.meta.description);
  assert.equal(en.meta.detail, "docs/DETAIL.md");
});
