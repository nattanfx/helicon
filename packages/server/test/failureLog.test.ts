import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FailureLog } from "../src/failureLog.js";

const row = (turnId: string) => ({
  kind: "turn-failed" as const,
  sessionId: "s1",
  turnId,
  hostKey: "h",
  errorKind: null,
  message: null,
});

describe("FailureLog.clear", () => {
  it("empties the in-memory ring and keeps recording afterwards", async () => {
    const log = new FailureLog(null);
    log.record(row("t1"));
    log.record(row("t2"));
    assert.equal(log.count, 2);
    await log.clear();
    assert.equal(log.count, 0);
    assert.deepEqual(log.recent(), []);
    log.record(row("t3"));
    assert.equal(log.count, 1);
    assert.equal(log.recent()[0]?.turnId, "t3");
    await log.close();
  });

  it("truncates the file and only later rows land on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helicon-failures-"));
    try {
      const file = join(dir, "failure-log.jsonl");
      const log = new FailureLog(file);
      await log.ready();
      log.record(row("t1"));
      await log.clear();
      log.record(row("t2"));
      await log.close();
      const text = await readFile(file, "utf8");
      assert.equal(
        text.split("\n").filter((line) => line.length > 0).length,
        1,
      );
      assert.match(text, /"turnId":"t2"/);
      assert.equal(log.count, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
