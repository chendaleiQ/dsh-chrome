import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveScreenshot } from "../src/screenshot.js";

// 1x1 transparent PNG
const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("screenshot: dataUrl lands on disk with size", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-chrome-shot-"));
  try {
    const out = saveScreenshot(dir, "session:test", TINY);
    assert.match(out.path, /\.png$/);
    assert.ok(out.bytes > 0);
    assert.equal(out.width, 1);
    assert.equal(out.height, 1);
    assert.ok(readFileSync(out.path).length === out.bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("screenshot: non-image dataUrl is rejected", () => {
  assert.throws(() => saveScreenshot("/tmp", "s", "not-a-data-url"), /dataUrl/);
});
