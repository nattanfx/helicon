import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** O vite.config.ts do app web, achado subindo a partir do teste compilado. */
function viteConfig(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "vite.config.ts");
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("apps/web/vite.config.ts not found");
    }
    dir = parent;
  }
}

describe("variáveis de build no pacote público", () => {
  it("só expõe o prefixo VITE_ e injeta apenas o SHA do build", () => {
    const config = viteConfig();
    const prefix = /envPrefix:\s*(\[[^\]]*\]|"[^"]*")/.exec(config)?.[1] ?? "";
    assert.ok(prefix, "o prefixo é declarado de forma explícita");
    assert.doesNotMatch(prefix, /HELICON/, "nenhuma variável HELICON_* da máquina de build vai inteira para o bundle");
    assert.match(config, /__HELICON_BUILD__:\s*JSON\.stringify\(process\.env\["HELICON_BUILD"\]/);
  });
});
