import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DRAFT_FILES_CHARS,
  parseDraftFiles,
  restoreDraftFiles,
  serializeDraftFiles,
} from "../src/model/draftFiles.js";
import type { PendingFile } from "../src/components/composer/attachments.js";

function pending(patch: Partial<PendingFile> = {}): PendingFile {
  return {
    id: "file-abc-1",
    name: "print.png",
    mediaType: "image/png",
    kind: "image",
    url: "blob:http://localhost/1",
    base64: "aGVsbG8=",
    width: 8,
    height: 6,
    size: 5,
    ...patch,
  };
}

describe("anexos do rascunho", () => {
  it("faz a volta completa: serializa, interpreta e reconstrói a bandeja", () => {
    const files = [
      pending(),
      pending({ id: "file-abc-2", name: "notas.txt", mediaType: "text/plain", kind: "file", url: null, width: undefined, height: undefined }),
    ];
    const raw = serializeDraftFiles(files);
    assert.ok(typeof raw === "string");
    assert.ok(!raw.includes("blob:"), "URL de objeto não é persistida");
    assert.ok(!raw.includes("file-abc-1"), "id efêmero não é persistido");

    const stored = parseDraftFiles(raw);
    assert.equal(stored.length, 2);
    assert.deepEqual(stored[0], {
      name: "print.png",
      mediaType: "image/png",
      kind: "image",
      base64: "aGVsbG8=",
      width: 8,
      height: 6,
      size: 5,
    });
    assert.deepEqual(stored[1]?.width, undefined);

    const restored = restoreDraftFiles(stored);
    assert.equal(restored.length, 2);
    assert.equal(restored[0]?.url, "data:image/png;base64,aGVsbG8=");
    assert.equal(restored[1]?.url, null);
    assert.equal(restored[0]?.size, 5);
    assert.ok((restored[0]?.id ?? "").startsWith("draft-"), "id novo a cada restauração");
    assert.notEqual(restored[0]?.id, restored[1]?.id);
  });

  it("recusa o rascunho inteiro quando passa do teto", () => {
    const big = pending({ base64: "x".repeat(MAX_DRAFT_FILES_CHARS + 1) });
    assert.equal(serializeDraftFiles([big]), null);
    const edge = pending({ base64: "x".repeat(MAX_DRAFT_FILES_CHARS) });
    assert.ok(typeof serializeDraftFiles([edge]) === "string", "exatamente no teto passa");
    const pair = [pending({ base64: "x".repeat(MAX_DRAFT_FILES_CHARS - 1) }), pending({ id: "f2", base64: "xx" })];
    assert.equal(serializeDraftFiles(pair), null, "a soma é que conta");
  });

  it("descarta entradas inválidas sem lançar", () => {
    assert.deepEqual(parseDraftFiles(null), []);
    assert.deepEqual(parseDraftFiles("não é json{"), []);
    assert.deepEqual(parseDraftFiles("{}"), []);
    const mixed = parseDraftFiles(
      JSON.stringify([
        { name: "ok.png", mediaType: "image/png", kind: "image", base64: "aGVsbG8=", size: 5 },
        null,
        "texto",
        { name: "", mediaType: "image/png", kind: "image", base64: "aGVsbG8=", size: 5 },
        { name: "x", mediaType: "image/png", kind: "video", base64: "aGVsbG8=", size: 5 },
        { name: "x", mediaType: "image/png", kind: "image", base64: "", size: 5 },
        { name: "x", mediaType: "image/png", kind: "image", base64: "aGVsbG8=", size: -1 },
        { name: "x", mediaType: "image/png", kind: "image", base64: "aGVsbG8=", size: 5, width: "8" },
      ]),
    );
    assert.deepEqual(mixed, [{ name: "ok.png", mediaType: "image/png", kind: "image", base64: "aGVsbG8=", size: 5 }]);
  });

  it("serializa lista vazia como JSON vazio", () => {
    assert.equal(serializeDraftFiles([]), "[]");
  });
});
