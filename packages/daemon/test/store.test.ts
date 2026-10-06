import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { HeliconStore, USAGE_DIVERGENCE_REASON } from "../src/store.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("HeliconStore", () => {
  it("preserves legacy spending and registration dates without claiming they are completion dates", () => {
    const folder = mkdtempSync(join(tmpdir(), "helicon-usage-migration-"));
    const path = join(folder, "synthetic.db");
    after(() => rmSync(folder, { recursive: true, force: true }));
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE usage (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT, model_id TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, at TEXT NOT NULL);
      INSERT INTO usage (key, session_id, prompt_tokens, output_tokens, at) VALUES ('old-cursor', 's1', 10, 5, '2020-01-01T00:00:00.000Z');`);
    db.close();
    const store = new HeliconStore(path);
    const row = store.listUsage("2026-01-01T00:00:00.000Z")[0]!;
    assert.equal(row.at, null);
    assert.equal(row.promptTokens, 10);
    // New provenance attaches through an old cursor; it cannot delete equal-valued calls.
    assert.equal(store.recordUsage({ ...row, key: "source-new", sourceKey: "raw1", legacyKey: "old-cursor" }), false);
    assert.equal(store.recordUsage({ ...row, key: "source-replayed", sourceKey: "raw1", legacyKey: "cursor-after-compaction" }), false);
    assert.equal(store.recordUsage({ ...row, key: "source-distinct", sourceKey: "raw2", legacyKey: "old-cursor" }), true);
    assert.equal(store.listUsage().length, 2);
    store.close();
    const check = new DatabaseSync(path);
    assert.deepEqual(check.prepare("SELECT prompt_tokens, output_tokens, at FROM usage WHERE key = 'old-cursor'").get(),
      Object.assign(Object.create(null), { prompt_tokens: 10, output_tokens: 5, at: "2020-01-01T00:00:00.000Z" }));
    check.close();
    const reopened = new HeliconStore(path);
    assert.equal(reopened.listUsage().length, 2);
    reopened.close();
  });

  it("keeps accumulated readings separate from calls and never moves token evidence backwards", () => {
    const store = new HeliconStore();
    after(() => store.close());
    store.recordUsageRecovery("s1", false, "snapshot only", 100, 50);
    store.recordUsageRecovery("s1", false, "unavailable", null, null);
    store.recordUsageRecovery("s1", true, null, 10, 5);
    assert.deepEqual(store.listUsageRecovery()[0], { sessionId: "s1", complete: true, reason: null, promptTokens: 100, outputTokens: 50, recordedPromptTokens: 0, recordedOutputTokens: 0, title: null, cwd: null, deleted: false });
    assert.equal(store.listUsage().length, 0);
  });

  it("keeps a complete recovery when a partial read finds less, while a full read can still downgrade it", () => {
    const store = new HeliconStore();
    after(() => store.close());
    store.recordUsageRecovery("s1", false, "partial opening", null, null, { partial: true });
    assert.equal(store.listUsageRecovery()[0]?.complete, false, "a partial read still reports a gap nobody closed");
    store.recordUsageRecovery("s1", true, null);
    store.recordUsageRecovery("s1", false, "partial opening", null, null, { partial: true });
    assert.deepEqual(store.listUsageRecovery()[0], { sessionId: "s1", complete: true, reason: null, promptTokens: null, outputTokens: null, recordedPromptTokens: 0, recordedOutputTokens: 0, title: null, cwd: null, deleted: false });
    store.recordUsageRecovery("s1", false, "full read found a gap");
    assert.equal(store.listUsageRecovery()[0]?.complete, false);
    assert.equal(store.listUsageRecovery()[0]?.reason, "full read found a gap");
  });

  it("does not discard a different raw completion whose regenerated cursor collides with a legacy row", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const call = { key: "legacy", sessionId: "s1", turnId: null, modelId: null, promptTokens: 10, outputTokens: 5, inputTokens: 10, cachedTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: null, at: null };
    store.recordUsage(call);
    assert.equal(store.recordUsage({ ...call, key: "source", sourceKey: "different-raw-call", legacyKey: "legacy", promptTokens: 20 }), true);
    assert.equal(store.listUsage().length, 2);
    assert.equal(store.usageTokens("s1").promptTokens, 30);
  });
  it("folds the same call recorded under two cursors and a source range into one, and settles the divergence it caused", () => {
    const folder = mkdtempSync(join(tmpdir(), "helicon-usage-dedupe-"));
    const path = join(folder, "dupes.db");
    after(() => rmSync(folder, { recursive: true, force: true }));
    const seed = new HeliconStore(path);
    const call = { sessionId: "s1", turnId: "t1", modelId: "m", outputTokens: 5, inputTokens: 100, cachedTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: null, at: null };
    // Two legacy cursor rows for one call (a host restart renumbered the cursor), plus a different later call.
    seed.recordUsage({ ...call, key: "v:s1:14", promptTokens: 100 });
    seed.recordUsage({ ...call, key: "v:s1:15", promptTokens: 100 });
    seed.recordUsage({ ...call, key: "v:s1:20", promptTokens: 130 });
    seed.recordUsageRecovery("s1", false, USAGE_DIVERGENCE_REASON, 230, 10);
    seed.close();
    // A recovery from an older build met the first call under a cursor it no longer matched and added a third copy.
    const raw = new DatabaseSync(path);
    raw.exec(`INSERT INTO usage (key, session_id, turn_id, model_id, prompt_tokens, output_tokens, input_tokens, at, source_key)
      VALUES ('src-a', 's1', 't1', 'm', 100, 5, 100, '2026-10-04T11:30:00.000Z', 'range-a')`);
    raw.close();

    const store = new HeliconStore(path);
    assert.deepEqual(store.usageTokens("s1"), { promptTokens: 230, outputTokens: 10 }, "each call counted once");
    const kept = store.listUsage().find((row) => row.promptTokens === 100);
    assert.equal(kept?.key, "src-a", "the copy that carries the source range survives");
    const recovery = store.listUsageRecovery()[0];
    assert.equal(recovery?.complete, true, "the totals agree with the session's own reading now");
    assert.equal(recovery?.reason, null);
    store.close();
  });

  it("gives a legacy row the source range of the same call instead of inserting a second copy", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const call = { sessionId: "s1", turnId: "t1", modelId: "m", promptTokens: 100, outputTokens: 5, inputTokens: 100, cachedTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: null, at: null };
    store.recordUsage({ ...call, key: "v:s1:14" });
    // The host renumbered its cursors: the recovery sees the same call at :15, with a source range.
    assert.equal(store.recordUsage({ ...call, key: "src", sourceKey: "range-a", legacyKey: "v:s1:15" }), false);
    assert.equal(store.listUsage().length, 1);
    // Replaying it again is still the same call; a different call of the same turn is new.
    assert.equal(store.recordUsage({ ...call, key: "src", sourceKey: "range-a", legacyKey: "v:s1:16" }), false);
    assert.equal(store.recordUsage({ ...call, key: "src-b", sourceKey: "range-b", legacyKey: "v:s1:30", promptTokens: 140 }), true);
    assert.equal(store.usageTokens("s1").promptTokens, 240);
  });

  it("names the conversation of each usage reading", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("D:\work\helicon");
    store.recordSession({ id: "s1", projectId: project.id });
    store.updateSession("s1", { title: "Corrigir o login", titleSource: "user" });
    store.recordUsageRecovery("s1", false, "x", 10, 1);
    store.recordUsageRecovery("cli-only", false, "y", null, null);
    const rows = store.listUsageRecovery();
    assert.equal(rows.find((row) => row.sessionId === "s1")?.title, "Corrigir o login");
    assert.equal(rows.find((row) => row.sessionId === "s1")?.cwd, "D:\work\helicon");
    assert.equal(rows.find((row) => row.sessionId === "cli-only")?.title, null);
  });

  it("groups sessions under projects by directory", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("D:\\work\\helicon");
    assert.equal(project.displayName, "helicon");
    assert.equal(project.pinned, false);
    const same = store.upsertProject("D:\\work\\helicon");
    assert.equal(same.id, project.id);
    const session = store.recordSession({ id: "s1", projectId: project.id });
    assert.equal(session.turnCount, 0);
    assert.equal(session.origin, "helicon");
    store.recordTurn("t1", "s1");
    store.updateTurnStatus("t1", "completed");
    const sessions = store.listSessionsByProject(project.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.turnCount, 1);
    assert.equal(sessions[0]?.id, "s1");
  });

  it("keeps the commands Helicon ran for a thread", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.addShellRun({
      id: "r1",
      sessionId: "s1",
      command: "ls -la",
      exitCode: 0,
      output: "total 0",
      truncated: false,
      durationMs: 12,
      at: "2026-09-11T22:00:00.000Z",
    });
    store.addShellRun({
      id: "r2",
      sessionId: "s1",
      command: "false",
      exitCode: 1,
      output: "",
      truncated: true,
      durationMs: null,
      at: "2026-09-11T22:00:01.000Z",
    });
    const runs = store.listShellRuns("s1");
    assert.deepEqual(runs.map((r) => r.id), ["r1", "r2"]);
    assert.equal(runs[0]?.output, "total 0");
    assert.equal(runs[1]?.exitCode, 1);
    assert.equal(runs[1]?.truncated, true);
    assert.equal(runs[1]?.durationMs, null);
    assert.deepEqual(store.listShellRuns("other"), []);
  });

  it("keeps the bytes of files sent with a prompt", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const saved = store.addAttachment({
      id: "a1",
      sessionId: "s1",
      turnId: "t1",
      ord: 0,
      name: "shot.png",
      mediaType: "image/png",
      kind: "image",
      width: 10,
      height: 20,
      bytes,
    });
    assert.equal(saved.name, "shot.png");
    assert.equal(saved.kind, "image");
    assert.equal(saved.turnId, "t1");
    assert.deepEqual(store.listAttachments("s1").map((a) => a.id), ["a1"]);
    assert.deepEqual(store.readAttachment("a1")?.bytes, bytes);
    assert.equal(store.readAttachment("missing"), null);
  });

  it("never lets a weaker title source overwrite a stronger one", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    const created = store.recordSession({ id: "s1", projectId: project.id });
    assert.equal(created.titleSource, "placeholder");
    store.recordSession({ id: "s1", projectId: project.id, title: "Fix the build", titleSource: "auto" });
    assert.equal(store.getSession("s1")?.title, "Fix the build");
    store.updateSession("s1", { title: "Renamed", titleSource: "user" });
    store.recordSession({ id: "s1", projectId: project.id, title: "Auto again", titleSource: "auto" });
    assert.equal(store.getSession("s1")?.title, "Renamed");
    assert.equal(store.findSession("s1")?.cwd, "/work/p");
  });

  it("deletes a session with its rows except usage, and tombstones the id", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.recordTurn("t1", "s1");
    store.updateTurnStatus("t1", "completed");
    store.addShellRun({
      id: "r1",
      sessionId: "s1",
      command: "ls",
      exitCode: 0,
      output: "",
      truncated: false,
      durationMs: null,
      at: "2026-09-11T22:00:00.000Z",
    });
    store.addAttachment({
      id: "a1",
      sessionId: "s1",
      turnId: null,
      ord: 0,
      name: "f.txt",
      mediaType: "text/plain",
      kind: "file",
      width: null,
      height: null,
      bytes: new Uint8Array([1]),
    });
    store.recordUsage({
      key: "k1",
      sessionId: "s1",
      turnId: "t1",
      modelId: null,
      promptTokens: 1,
      outputTokens: 2,
      inputTokens: 3,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      durationMs: null,
      at: "2026-09-11T22:00:00.000Z",
    });
    store.allowTitleAttempt("s1");
    assert.equal(store.deleteSession("missing"), false);
    assert.equal(store.deleteSession("s1"), true);
    assert.equal(store.getSession("s1"), null);
    assert.equal(store.isDeleted("s1"), true);
    assert.equal(store.isDeleted("s2"), false);
    assert.deepEqual(store.listShellRuns("s1"), []);
    assert.deepEqual(store.listAttachments("s1"), []);
    // Usage stays: deleting a thread must not rewrite its spending history.
    const remaining = store.listUsage();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.deleted, true);
    assert.equal(store.titleAttemptState("s1"), null);
    // The turn rows go too: re-recording the id starts from zero, not from the old turn.
    store.recordSession({ id: "s1", projectId: project.id });
    assert.equal(store.listSessionsByProject(project.id)[0]?.turnCount, 0);
  });

  it("deletes a session all-or-nothing: a failed tombstone keeps every row", () => {
    const folder = mkdtempSync(join(tmpdir(), "helicon-delete-atomic-"));
    const path = join(folder, "synthetic.db");
    after(() => rmSync(folder, { recursive: true, force: true }));
    const store = new HeliconStore(path);
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.recordTurn("t1", "s1");
    // Simula a queda entre os DELETEs e a lápide: a lápide falha depois que as linhas já saíram.
    const side = new DatabaseSync(path);
    side.exec(`CREATE TRIGGER fail_tombstone BEFORE INSERT ON deleted_sessions BEGIN SELECT RAISE(ABORT, 'queda'); END;`);
    assert.throws(() => store.deleteSession("s1"), /queda/);
    assert.notEqual(store.getSession("s1"), null, "a sessão volta inteira com o rollback");
    assert.equal(store.isDeleted("s1"), false);
    side.exec(`DROP TRIGGER fail_tombstone`);
    side.close();
    assert.equal(store.deleteSession("s1"), true);
    assert.equal(store.isDeleted("s1"), true);
    // Depois de um rollback o armazenamento segue aceitando transações.
    store.transaction(() => store.transaction(() => store.tombstone("other")));
    assert.equal(store.isDeleted("other"), true);
    store.close();
  });

  it("archives sessions and hides projects without deleting them", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.recordSession({ id: "s2", projectId: project.id });
    store.updateSession("s1", { archived: true });
    assert.deepEqual(
      store.listSessionsByProject(project.id).map((s) => s.id),
      ["s2"],
    );
    assert.equal(store.listSessionsByProject(project.id, { includeArchived: true }).length, 2);
    assert.deepEqual(
      store.listSessionsByProject(project.id, { onlyArchived: true }).map((s) => s.id),
      ["s1"],
    );
    store.setHidden("/work/p", true);
    assert.equal(store.listProjects().length, 0);
    assert.equal(store.listProjects({ includeHidden: true }).length, 1);
    store.upsertProject("/work/p");
    assert.equal(store.listProjects().length, 0, "discovery alone must not unhide a project");
  });

  it("orders projects by their latest session activity", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const a = store.upsertProject("/work/a");
    const b = store.upsertProject("/work/b");
    store.recordSession({ id: "a1", projectId: a.id, activityAt: "2026-01-01T00:00:00.000Z" });
    store.recordSession({ id: "b1", projectId: b.id, activityAt: "2026-02-01T00:00:00.000Z" });
    assert.deepEqual(
      store.listProjects().map((p) => p.cwd),
      ["/work/b", "/work/a"],
    );
    store.recordSession({ id: "a1", projectId: a.id, activityAt: "2026-03-01T00:00:00.000Z" });
    assert.equal(store.listProjects()[0]?.cwd, "/work/a");
  });

  it("keeps the order the user dragged projects into", () => {
    const store = new HeliconStore();
    after(() => store.close());
    store.upsertProject("/work/a");
    store.upsertProject("/work/b");
    store.upsertProject("/work/c");
    store.setProjectOrder(["/work/c", "/work/a", "/work/b"]);
    assert.deepEqual(
      store.listProjects().map((p) => p.cwd),
      ["/work/c", "/work/a", "/work/b"],
    );
    store.setPinned("/work/b", true);
    assert.equal(store.listProjects()[0]?.cwd, "/work/b", "a pinned project still comes first");
  });

  it("pins projects to the top of the sidebar order", () => {
    const store = new HeliconStore();
    after(() => store.close());
    store.upsertProject("D:\\work\\b");
    store.upsertProject("D:\\work\\a");
    store.setPinned("D:\\work\\a", true);
    const projects = store.listProjects();
    assert.equal(projects[0]?.cwd, "D:\\work\\a");
    assert.equal(projects[0]?.pinned, true);
  });

  it("keeps thread-title settings, defaulting on and merging patches", () => {
    const store = new HeliconStore();
    after(() => store.close());
    assert.deepEqual(store.getTitleSettings(), { enabled: true, modelId: null });
    assert.deepEqual(store.setTitleSettings({ modelId: "m1" }), { enabled: true, modelId: "m1" });
    assert.deepEqual(store.setTitleSettings({ enabled: false }), { enabled: false, modelId: "m1" });
    assert.deepEqual(store.getTitleSettings(), { enabled: false, modelId: "m1" });
    assert.deepEqual(store.setTitleSettings({ enabled: true, modelId: null }), { enabled: true, modelId: null });
  });

  it("keeps sandbox settings per project, defaulting to sandbox-on", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const a = store.upsertProject("/work/a");
    const b = store.upsertProject("/work/b");
    assert.deepEqual(store.getSandboxSettings(a.id), { disabled: false });
    assert.deepEqual(store.setSandboxSettings(a.id, { disabled: true }), { disabled: true });
    assert.deepEqual(store.getSandboxSettings(a.id), { disabled: true });
    assert.deepEqual(store.getSandboxSettings(b.id), { disabled: false }, "another project keeps its protection");
    assert.deepEqual(store.setSandboxSettings(a.id, {}), { disabled: true }, "an empty patch changes nothing");
    assert.deepEqual(store.setSandboxSettings(a.id, { disabled: false }), { disabled: false });
    assert.equal(store.setSandboxSettings(9999, { disabled: true }), null, "an unknown project gets nothing");
    assert.deepEqual(store.getSandboxSettings(9999), { disabled: false });
  });

  it("keeps YOLO settings per project, defaulting to off, and new projects start protected", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const a = store.upsertProject("/work/a");
    assert.deepEqual(store.getYoloSettings(a.id), { enabled: false });
    assert.deepEqual(store.setYoloSettings(a.id, { enabled: true }), { enabled: true });
    assert.deepEqual(store.getYoloSettings(a.id), { enabled: true });
    assert.deepEqual(store.setYoloSettings(a.id, {}), { enabled: true }, "an empty patch changes nothing");
    assert.equal(store.getProject("/work/a")?.yoloEnabled, true);
    const later = store.upsertProject("/work/later");
    assert.deepEqual(store.getYoloSettings(later.id), { enabled: false });
    assert.equal(later.sandboxDisabled, false);
    assert.equal(store.setYoloSettings(9999, { enabled: true }), null);
  });

  it("drops a project's posture when it is removed, so adding it back starts protected", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const a = store.upsertProject("/work/a");
    store.setYoloSettings(a.id, { enabled: true });
    store.setSandboxSettings(a.id, { disabled: true });
    store.setHidden("/work/a", true);
    store.upsertProject("/work/a");
    store.setHidden("/work/a", false);
    assert.deepEqual(store.getYoloSettings(a.id), { enabled: false });
    assert.deepEqual(store.getSandboxSettings(a.id), { disabled: false });
  });

  it("migrates the old global YOLO and sandbox switch without spreading it to any project", () => {
    const folder = mkdtempSync(join(tmpdir(), "helicon-posture-migration-"));
    const path = join(folder, "synthetic.db");
    after(() => rmSync(folder, { recursive: true, force: true }));
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, cwd TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO projects (cwd, display_name, created_at, updated_at) VALUES ('/work/old', 'old', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO settings (key, value) VALUES ('yolo', '{"enabled":true}'), ('sandbox', '{"disabled":true}'), ('title', '{"enabled":false,"modelId":null}');`);
    db.close();
    for (let open = 0; open < 2; open += 1) {
      const store = new HeliconStore(path);
      const old = store.getProject("/work/old")!;
      assert.deepEqual(store.getYoloSettings(old.id), { enabled: false }, "the old switch never reaches a project");
      assert.deepEqual(store.getSandboxSettings(old.id), { disabled: false });
      assert.equal(store.getTitleSettings().enabled, false, "other settings survive");
      if (open === 0) {
        store.setYoloSettings(old.id, { enabled: true });
      }
      store.close();
      if (open === 0) {
        const check = new DatabaseSync(path);
        assert.equal(check.prepare("SELECT COUNT(*) AS n FROM settings WHERE key IN ('yolo', 'sandbox')").get()?.["n"], 0);
        check.close();
        // A project chosen after the upgrade keeps its choice across a reopen; the migration runs again harmlessly.
        const again = new HeliconStore(path);
        assert.deepEqual(again.getYoloSettings(old.id), { enabled: true });
        again.setYoloSettings(old.id, { enabled: false });
        again.close();
      }
    }
  });

  it("keeps usage rows when a session is deleted, flagged as deleted", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id });
    store.recordSession({ id: "s2", projectId: project.id });
    const call = (key: string, sessionId: string) => ({
      key,
      sessionId,
      turnId: "t1",
      modelId: "m",
      promptTokens: 10,
      outputTokens: 5,
      inputTokens: 10,
      cachedTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      durationMs: null,
      at: "2026-09-25T00:00:00.000Z",
    });
    store.recordUsage(call("k1", "s1"));
    store.recordUsage(call("k2", "s2"));
    store.deleteSession("s1");
    const rows = store.listUsage();
    assert.equal(rows.length, 2);
    const gone = rows.find((r) => r.sessionId === "s1");
    assert.equal(gone?.deleted, true);
    assert.equal(gone?.sessionTitle, null);
    assert.equal(rows.find((r) => r.sessionId === "s2")?.deleted, false);
  });

  it("records each session's sandbox posture at creation, never on touch", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    const created = store.recordSession({ id: "s1", projectId: project.id, sandboxDisabled: true });
    assert.equal(created.sandboxDisabled, true);
    const touched = store.recordSession({ id: "s1", projectId: project.id, turnCount: 2 });
    assert.equal(touched.sandboxDisabled, true, "a later touch keeps the creation posture");
    const unknown = store.recordSession({ id: "s2", projectId: project.id });
    assert.equal(unknown.sandboxDisabled, null, "sessions recorded before tracking stay unknown");
  });

  it("lets the creating call set origin and posture on a row a notification adopted first", () => {
    const store = new HeliconStore();
    after(() => store.close());
    const project = store.upsertProject("/work/p");
    store.recordSession({ id: "s1", projectId: project.id, origin: "tui", title: "muse-name", titleSource: "auto" });
    const touched = store.recordSession({ id: "s1", projectId: project.id, origin: "helicon", sandboxDisabled: true });
    assert.equal(touched.origin, "tui", "an ordinary touch never rewrites creation facts");
    assert.equal(touched.sandboxDisabled, null);
    const created = store.recordSession({ id: "s1", projectId: project.id, origin: "helicon", sandboxDisabled: true, creation: true });
    assert.equal(created.origin, "helicon");
    assert.equal(created.sandboxDisabled, true);
    assert.equal(created.title, "muse-name");
  });
});
