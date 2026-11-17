import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { alreadyOnboarded, onboard } from "../src/onboard.js";

test("onboard: opens the file manager at the extension dir and leaves a marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-chrome-onboard-"));
  try {
    const opened = [];
    const out = await onboard({
      bridgeStatus: async () => ({ connected: false }),
      dataDir: dir,
      extensionDir: "/Applications/x/extension",
      openDir: async (d) => { opened.push(d); return true; },
    });
    assert.equal(out.connected, false);
    assert.equal(out.opened, true);
    assert.deepEqual(opened, ["/Applications/x/extension"]);
    assert.equal(out.steps.length, 6);
    assert.equal(alreadyOnboarded(dir), true);
    assert.match(readFileSync(join(dir, ".onboarded"), "utf8"), /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onboard: already-connected sessions do not pop the file manager", async () => {
  let called = 0;
  const out = await onboard({
    bridgeStatus: async () => ({ connected: true }),
    dataDir: "",
    extensionDir: "/x",
    openDir: async () => { called += 1; return true; },
  });
  assert.equal(out.connected, true);
  assert.equal(called, 0);
  assert.equal(out.opened, false);
});
