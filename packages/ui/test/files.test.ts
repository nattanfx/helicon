import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirnameOf, fileKey, fileOpenProblem, fileTarget, formatFileSize, isMarkdownPath, looksLikeFilePath, relativeToProject } from "../src/model/files.js";

describe("links de arquivo", () => {
  it("resolve caminhos relativos, absolutos e com sufixo de linha contra o projeto", () => {
    assert.deepEqual(fileTarget("registries.md", "/work/app"), { path: "registries.md", line: null });
    assert.deepEqual(fileTarget("src/app.js:4-5", "/work/app"), { path: "src/app.js", line: { start: 4, end: 5 } });
    assert.deepEqual(fileTarget("/work/app/src/app.js:12", "/work/app"), { path: "src/app.js", line: { start: 12, end: 12 } });
    assert.deepEqual(fileTarget("file:///work/app/docs/My%20Guide.md#L3-L9", "/work/app"), { path: "docs/My Guide.md", line: { start: 3, end: 9 } });
    // Um link dentro de um arquivo resolve a partir da pasta do arquivo, como uma prévia de markdown o lê.
    assert.deepEqual(fileTarget("../api/README.md", "/work/app", "docs/guides"), { path: "docs/api/README.md", line: null });
    assert.deepEqual(fileTarget("./notes.md", "/work/app", "docs"), { path: "docs/notes.md", line: null });
  });

  it("combina caminhos Windows de projeto em qualquer estilo de barra, ignorando maiúsculas do drive", () => {
    assert.deepEqual(fileTarget("C:\\Users\\me\\app\\README.md", "c:\\Users\\me\\app"), { path: "README.md", line: null });
    assert.equal(relativeToProject("C:\\work\\app", "C:/work/app/src/x.ts"), "src/x.ts");
    assert.equal(relativeToProject("/work/app", "/work/application/x.ts"), null, "uma pasta irmã com prefixo compartilhado está fora");
    assert.deepEqual(fileTarget("/etc/hosts", "/work/app"), { path: "/etc/hosts", line: null }, "caminhos de fora vão ao servidor como escritos");
  });

  it("deixa links web, âncoras e e-mail em paz", () => {
    for (const href of ["https://helicon.sh", "mailto:a@b.c", "#section", "", "javascript:alert(1)"]) {
      assert.equal(fileTarget(href, "/work/app"), null, href);
    }
  });

  it("trata só código inline em forma de caminho como arquivo", () => {
    for (const code of [".env", ".gitignore", "registries.md", "src/app.ts", "app.js:4-5", "check.test.js:8", "packages/ui/src/model/plan.ts", "Dockerfile.dev/x.yml"]) {
      assert.equal(looksLikeFilePath(code), true, code);
    }
    for (const code of ["npm test", "process.env", "this.state", "withTip / people", "a.b()", "https://x.dev/a.md", "60 / 3 = 20", "v0.11.1", "x", "obj.prop"]) {
      assert.equal(looksLikeFilePath(code), false, code);
    }
  });

  it("tem os pequenos ajudantes de que o visualizador precisa", () => {
    assert.equal(isMarkdownPath("docs/README.MD"), true);
    assert.equal(isMarkdownPath("notes.txt"), false);
    assert.equal(dirnameOf("a/b/c.md"), "a/b");
    assert.equal(dirnameOf("c.md"), "");
    assert.equal(fileKey("/w", "a.md"), "/w\na.md");
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(2048), "2.0 KB");
    assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
  });

  it("explains a missing file from a stable kind, not from guessing the English sentence", () => {
    const known = fileOpenProblem("fileNotFound", "That file does not exist.");
    assert.equal(known.title, "Este arquivo não foi encontrado");
    assert.equal(known.detail, "Esse caminho não existe neste projeto.");
    assert.doesNotMatch(known.detail, /password|token|secret/i);

    const legacy = fileOpenProblem(null, "That file does not exist.");
    assert.equal(legacy.title, known.title);

    const other = fileOpenProblem("fileChanged", "That file does not exist.");
    assert.equal(other.title, "Não foi possível abrir este arquivo");
    assert.equal(other.detail, "That file does not exist.");

    const unknown = fileOpenProblem(null, "Permission denied.");
    assert.equal(unknown.title, "Não foi possível abrir este arquivo");
    assert.equal(unknown.detail, "Permission denied.");
  });
});
