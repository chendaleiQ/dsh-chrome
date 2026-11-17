import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (locale) => JSON.parse(readFileSync(join(root, "extension", "_locales", locale, "messages.json"), "utf8"));

test("i18n: en and zh_CN expose the same message keys", () => {
  const en = load("en");
  const zh = load("zh_CN");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const [k, v] of Object.entries(en)) {
    assert.equal(typeof v.message, "string", `${k} needs a message`);
    assert.ok(v.message.length > 0, `${k} is empty`);
  }
});

test("i18n: manifest uses __MSG__ references and declares a default locale", () => {
  const manifest = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8"));
  assert.equal(manifest.default_locale, "en");
  assert.match(manifest.name, /^__MSG_/);
  assert.match(manifest.description, /^__MSG_/);
});
