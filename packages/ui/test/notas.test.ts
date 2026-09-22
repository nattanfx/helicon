import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { NOTAS } from "../src/model/notas.js";

function repoFile(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "docs", "NOTAS-0.12.5-pt5.md");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("docs/NOTAS-0.12.5-pt5.md not found");
    }
    dir = parent;
  }
}

function normalized(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

describe("notas da edição", () => {
  it("traz as edições da mais nova para a mais antiga, sem repetir nem esvaziar", () => {
    const seen = new Set<string>();
    assert.ok(NOTAS.length > 0, "há ao menos uma edição");
    for (const entry of NOTAS) {
      assert.ok(entry.version.trim().length > 0, "edição sem versão");
      assert.ok(entry.body.trim().length > 0, `${entry.version} sem notas`);
      assert.ok(!seen.has(entry.version), `${entry.version} aparece duas vezes`);
      seen.add(entry.version);
    }
  });

  it("acompanha o arquivo da edição em docs/", () => {
    const docs = normalized(readFileSync(repoFile(), "utf8"));
    const entry = NOTAS.find((e) => e.version === "0.12.5-pt5");
    assert.ok(entry, "há notas para a edição atual");
    assert.equal(normalized(entry.body), docs);
  });
});
