import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HeliconStore } from "../src/store.js";

it("migrates old databases without enrolling history or changing titles and preferences", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "helicon-title-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "test.db");
  const old = new HeliconStore(path);
  const project = old.upsertProject("/test");
  old.recordSession({ id: "manual", projectId: project.id, title: "Meu nome", titleSource: "user" });
  old.recordSession({ id: "echo", projectId: project.id, title: "Meu pedido", titleSource: "auto" });
  old.setTitleSettings({ enabled: false, modelId: "chosen-model" });
  old.close();
  // Recreate the pre-change schema on this disposable database only.
  const legacy = new DatabaseSync(path);
  legacy.exec("DROP TABLE title_attempts");
  legacy.close();
  const migrated = new HeliconStore(path);
  try {
    assert.deepEqual(migrated.getTitleSettings(), { enabled: false, modelId: "chosen-model" });
    assert.equal(migrated.getSession("manual")?.title, "Meu nome");
    assert.equal(migrated.getSession("manual")?.titleSource, "user");
    assert.equal(migrated.getSession("echo")?.title, "Meu pedido");
    assert.equal(migrated.claimTitleAttempt("echo"), false);
    assert.equal(migrated.titleAttemptState("manual"), null);
  } finally { migrated.close(); }
});

it("persists claims across connections and restarts, including interrupted attempts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "helicon-title-claim-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "test.db");
  const first = new HeliconStore(path);
  const project = first.upsertProject("/test");
  first.recordSession({ id: "new", projectId: project.id });
  first.allowTitleAttempt("new");
  const second = new HeliconStore(path);
  try {
    assert.equal(first.claimTitleAttempt("new"), true);
    assert.equal(second.claimTitleAttempt("new"), false);
  } finally { first.close(); second.close(); }
  const restarted = new HeliconStore(path);
  try {
    restarted.allowTitleAttempt("new");
    assert.equal(restarted.titleAttemptState("new"), "attempted");
    assert.equal(restarted.claimTitleAttempt("new"), false);
    restarted.finishTitleAttempt("new", "failed");
    assert.equal(restarted.claimTitleAttempt("new"), false);
    assert.equal(restarted.titleAttemptState("new"), "failed");
  } finally { restarted.close(); }
});

it("cancels pending and running attempts permanently when disabled", () => {
  const store = new HeliconStore();
  try {
    const project = store.upsertProject("/test");
    for (const id of ["pending", "running"]) {
      store.recordSession({ id, projectId: project.id });
      store.allowTitleAttempt(id);
    }
    assert.equal(store.claimTitleAttempt("running"), true);
    store.cancelPendingTitles();
    store.finishTitleAttempt("running", "succeeded");
    assert.equal(store.titleAttemptState("running"), "cancelled");
    assert.equal(store.claimTitleAttempt("pending"), false);
  } finally { store.close(); }
});
