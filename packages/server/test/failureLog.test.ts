import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAILURE_KINDS, FailureLog } from "../src/failureLog.js";

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

describe("FailureLog no disco", () => {
  it("relê do arquivo todos os tipos que sabe gravar", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helicon-failures-"));
    try {
      const file = join(dir, "failure-log.jsonl");
      const first = new FailureLog(file);
      await first.ready();
      for (const kind of FAILURE_KINDS) {
        first.record({ ...row(kind), kind });
      }
      await first.close();
      const second = new FailureLog(file);
      await second.ready();
      assert.deepEqual(second.recent(200).map((entry) => entry.kind), [...FAILURE_KINDS]);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("compacta uma rajada sem duplicar linhas ainda na fila nem deixar arquivo temporário", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helicon-failures-"));
    try {
      const file = join(dir, "failure-log.jsonl");
      const log = new FailureLog(file);
      await log.ready();
      for (let i = 0; i < 700; i += 1) {
        log.record(row(`t${i}`));
      }
      await log.close();
      const ids = (await readFile(file, "utf8")).split("\n").filter((line) => line.length > 0).map((line) => (JSON.parse(line) as { turnId: string }).turnId);
      assert.equal(new Set(ids).size, ids.length, "nenhuma linha repetida");
      assert.equal(ids.at(-1), "t699");
      assert.ok(ids.includes("t500") && ids.includes("t501"));
      assert.deepEqual(await readdir(dir), ["failure-log.jsonl"]);
      const reloaded = new FailureLog(file);
      await reloaded.ready();
      assert.deepEqual(reloaded.recent(200).map((entry) => entry.turnId), Array.from({ length: 200 }, (_, i) => `t${i + 500}`));
      await reloaded.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
