import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileError, readProjectFile } from "../src/files.js";

describe("arquivo inexistente", () => {
  it("marks a missing path with a stable fileNotFound kind, without needing the English phrase", async () => {
    const root = await mkdtemp(join(tmpdir(), "helicon-missing-"));
    try {
      await mkdir(join(root, "docs"));
      await writeFile(join(root, "README.md"), "# hi\n");
      await assert.rejects(
        () => readProjectFile(root, root, "docs/gone.md"),
        (error: unknown) => {
          assert.ok(error instanceof FileError);
          assert.equal(error.status, 404);
          assert.equal(error.kind, "fileNotFound");
          assert.match(error.message, /does not exist/);
          return true;
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
