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

test("i18n: every $placeholder$ used in a message is declared", () => {
  // Chrome 强校验：message 里引用了没声明的变量，扩展直接装不上
  // （"Variable $1$ used but not defined. 无法加载清单。"）
  for (const locale of ["en", "zh_CN"]) {
    const msgs = load(locale);
    for (const [k, v] of Object.entries(msgs)) {
      const refs = new Set([...v.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase()));
      const declared = new Set(Object.keys(v.placeholders || {}).map((x) => x.toLowerCase()));
      for (const r of refs) assert.ok(declared.has(r), `${locale}.${k}: $${r}$ not declared`);
    }
  }
});
test("i18n: manifest uses __MSG__ references and declares a default locale", () => {
  const manifest = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8"));
  assert.equal(manifest.default_locale, "en");
  assert.match(manifest.name, /^__MSG_/);
  assert.match(manifest.description, /^__MSG_/);
});
