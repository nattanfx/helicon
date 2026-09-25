import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS, formatShortcutKeys } from "../src/model/shortcuts.js";

describe("shortcuts", () => {
  it("has unique ids with at least one key", () => {
    assert.ok(SHORTCUTS.length > 0);
    const ids = SHORTCUTS.map((s) => s.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const shortcut of SHORTCUTS) {
      assert.ok(shortcut.label.trim().length > 0, shortcut.id);
      assert.ok(shortcut.keys.length > 0, shortcut.id);
    }
  });

  it("formats combos for each platform", () => {
    assert.equal(formatShortcutKeys(["mod", "K"], false), "Ctrl+K");
    assert.equal(formatShortcutKeys(["mod", "K"], true), "⌘K");
    assert.equal(formatShortcutKeys(["mod", "Shift", "O"], false), "Ctrl+Shift+O");
    assert.equal(formatShortcutKeys(["Alt", "ArrowUp"], false), "Alt+↑");
    assert.equal(formatShortcutKeys(["Enter"], false), "Enter");
    assert.equal(formatShortcutKeys(["Esc"], true), "Esc");
  });
});
