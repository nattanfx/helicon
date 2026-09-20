import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FILE_DRAFT_CHARS,
  fileDraftConflicts,
  oversizedFileDraftKeys,
  parseFileDrafts,
  serializeFileDrafts,
  splitFileKey,
} from "../src/model/fileDrafts.js";

describe("cópias recuperáveis de arquivo", () => {
  it("keeps only well-formed project/path drafts and drops junk", () => {
    assert.deepEqual(parseFileDrafts(null), {});
    assert.deepEqual(parseFileDrafts([]), {});
    assert.deepEqual(
      parseFileDrafts({
        "/work/app\nREADME.md": { content: "# mine", baseMtimeMs: 10 },
        "nopath": { content: "x", baseMtimeMs: null },
        "/work/app\nbad.md": { content: "x", baseMtimeMs: "nope" },
        "/work/app\nok.md": { content: "ok", baseMtimeMs: null },
      }),
      {
        "/work/app\nREADME.md": { content: "# mine", baseMtimeMs: 10 },
        "/work/app\nok.md": { content: "ok", baseMtimeMs: null },
      },
    );
    assert.deepEqual(splitFileKey("/work/app\nREADME.md"), { cwd: "/work/app", path: "README.md" });
  });

  it("recupera edição que deixa o arquivo vazio; só ausência/null descarta", () => {
    const key = "/work/app\nnotes.md";
    assert.deepEqual(parseFileDrafts({ [key]: { content: "", baseMtimeMs: 1 } }), {
      [key]: { content: "", baseMtimeMs: 1 },
    });
    const stored = serializeFileDrafts({ [key]: { content: "", baseMtimeMs: 1 } });
    assert.deepEqual(stored, { [key]: { content: "", baseMtimeMs: 1 } });
    assert.deepEqual(parseFileDrafts(stored), { [key]: { content: "", baseMtimeMs: 1 } });
  });

  it("omits oversized drafts from storage and never treats them as a disk conflict without a base", () => {
    const huge = "a".repeat(MAX_FILE_DRAFT_CHARS + 1);
    assert.deepEqual(serializeFileDrafts({ "/work/app\nbig.md": { content: huge, baseMtimeMs: 1 } }), {});
    assert.deepEqual(oversizedFileDraftKeys({ "/work/app\nbig.md": { content: huge, baseMtimeMs: 1 } }), ["/work/app\nbig.md"]);
    assert.deepEqual(oversizedFileDraftKeys({ "/work/app\nsmall.md": { content: "# a", baseMtimeMs: 1 } }), []);
    assert.equal(fileDraftConflicts({ content: "# a", baseMtimeMs: 100 }, 200), true);
    assert.equal(fileDraftConflicts({ content: "# a", baseMtimeMs: 100 }, 100), false);
    assert.equal(fileDraftConflicts({ content: "# a", baseMtimeMs: null }, 200), false);
  });
});
