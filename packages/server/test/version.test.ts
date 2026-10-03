import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HELICON_VERSION } from "../src/server.js";

/** The repository root: the first folder up from this file whose package.json declares the workspaces. */
function repoRoot(): string {
  let dir = __dirname;
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && Array.isArray((JSON.parse(readFileSync(manifest, "utf8")) as { workspaces?: unknown }).workspaces)) {
      return dir;
    }
    const parent = dirname(dir);
    assert.notEqual(parent, dir, "repository root not found");
    dir = parent;
  }
}

const ROOT = repoRoot();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MANIFESTS = [
  "package.json",
  "packages/daemon/package.json",
  "packages/server/package.json",
  "packages/ui/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
];

/** `version = "..."` inside Cargo.toml's [package] table, not a dependency's. */
function cargoVersion(text: string): string | undefined {
  const table = text.split(/^\[/m).find((section) => section.startsWith("package]"));
  return table?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

describe("one version everywhere", () => {
  // tauri.conf.json is what the installer and the interface show; every other copy must agree with it.
  const expected = (JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as { version: string }).version;

  it("is a fork edition version", () => {
    assert.match(expected, /^\d+\.\d+\.\d+-pt\d+$/);
  });

  it("matches in Cargo.toml, the server and the in-app notes", () => {
    assert.equal(cargoVersion(read("apps/desktop/src-tauri/Cargo.toml")), expected, "Cargo.toml [package] version");
    assert.equal(HELICON_VERSION, expected, "HELICON_VERSION in packages/server/src/server.ts");
    const notes = read("packages/ui/src/model/notas.ts").match(/version:\s*"([^"]+)"/)?.[1];
    assert.equal(notes, expected, "newest entry in packages/ui/src/model/notas.ts");
  });

  it("matches in every package.json and in package-lock.json", () => {
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
    assert.equal(lock.version, expected, "package-lock.json");
    for (const manifest of MANIFESTS) {
      assert.equal((JSON.parse(read(manifest)) as { version: string }).version, expected, manifest);
      const key = manifest === "package.json" ? "" : dirname(manifest);
      assert.equal(lock.packages[key]?.version, expected, `package-lock.json packages["${key}"]`);
    }
  });
});
