import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  defaultSettingsSection,
  isSettingsSectionId,
  settingsSectionTitle,
} from "../src/model/settingsSections.js";

describe("settings sections", () => {
  it("has unique ids, titles, descriptions and icons", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    assert.deepEqual([...new Set(ids)], ids);
    for (const section of SETTINGS_SECTIONS) {
      assert.ok(section.title.trim().length > 0, section.id);
      assert.ok(section.description.trim().length > 0, section.id);
      assert.ok(section.icon.trim().length > 0, section.id);
    }
    const titles = SETTINGS_SECTIONS.map((s) => s.title);
    assert.deepEqual([...new Set(titles)], titles);
  });

  it("covers every section with a known group", () => {
    for (const section of SETTINGS_SECTIONS) {
      assert.ok(SETTINGS_GROUPS[section.group], section.id);
    }
    const grouped = new Set(SETTINGS_SECTIONS.map((s) => s.group));
    assert.deepEqual([...grouped].sort(), Object.keys(SETTINGS_GROUPS).sort());
  });

  it("opens on Conversas and resolves titles", () => {
    assert.equal(defaultSettingsSection().id, "conversas");
    assert.equal(settingsSectionTitle("sobre"), "Sobre");
    assert.throws(() => settingsSectionTitle("versao"), /Unknown settings section/);
  });

  it("guards section ids", () => {
    assert.equal(isSettingsSectionId("atalhos"), true);
    assert.equal(isSettingsSectionId("seguranca"), true);
    assert.equal(isSettingsSectionId("modo-yolo"), false);
    assert.equal(isSettingsSectionId("ambiente"), false);
    assert.equal(isSettingsSectionId(""), false);
  });
});
