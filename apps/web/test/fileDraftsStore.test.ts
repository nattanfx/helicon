import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Platform } from "@helicon/ui";
import {
  createStableSaver,
  loadStableFileDrafts,
  prepareStableFileDrafts,
  type InvokeFn,
} from "../src/fileDraftsStore.js";

/**
 * REV5 — cofre estável de rascunhos fora da origem web (desktop Tauri).
 * O invocador é sempre injetado: nenhum teste encosta no Tauri real nem em dados do usuário.
 */

const KEY = "/work/app\nREADME.md";
const DRAFTS = { [KEY]: { content: "# rascunho", baseMtimeMs: 100 } };

function fakeInvoker(handler: (cmd: string, args?: Record<string, unknown>) => unknown): InvokeFn & { calls: { cmd: string; args?: Record<string, unknown> }[] } {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  const invoker = (async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return handler(cmd, args);
  }) as InvokeFn & { calls: { cmd: string; args?: Record<string, unknown> }[] };
  invoker.calls = calls;
  return invoker;
}

function tauriWindow() {
  (globalThis as Record<string, unknown>)["window"] = { __TAURI_INTERNALS__: {} };
}

function plainWindow() {
  (globalThis as Record<string, unknown>)["window"] = {};
}

function basePlatform(local: unknown, saved: { count: number }): Platform {
  return {
    loadPrefs: () => null,
    savePrefs: () => {},
    readHash: () => "",
    writeHash: () => {},
    onHashChange: () => () => {},
    now: () => Date.now(),
    schedule: (fn: () => void) => setTimeout(fn, 0),
    cancel: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    focused: () => false,
    loadFileDrafts: () => local,
    saveFileDrafts: () => {
      saved.count += 1;
    },
  } as Platform;
}

describe("cofre estável de rascunhos", () => {
  it("lê a cópia estável e trata ausência e texto corrompido como vazio", async () => {
    const stored = JSON.stringify(DRAFTS);
    assert.deepEqual(await loadStableFileDrafts(fakeInvoker(() => stored)), DRAFTS);
    assert.equal(await loadStableFileDrafts(fakeInvoker(() => null)), null);
    assert.equal(await loadStableFileDrafts(fakeInvoker(() => "não é json {")), null);
  });

  it("fora do Tauri devolve a base intacta, sem invocar nada", async () => {
    plainWindow();
    const saved = { count: 0 };
    const base = basePlatform(DRAFTS, saved);
    const invoker = fakeInvoker(() => {
      throw new Error("não deveria invocar fora do desktop");
    });
    const { platform, flushStable } = await prepareStableFileDrafts(base, { invoker });
    assert.equal(platform, base);
    await flushStable();
    assert.equal(invoker.calls.length, 0);
  });

  it("no desktop carrega o cofre e não empurra o local por cima dele", async () => {
    tauriWindow();
    const saved = { count: 0 };
    const invoker = fakeInvoker((cmd) => (cmd === "helicon_load_file_drafts" ? JSON.stringify(DRAFTS) : null));
    const { platform } = await prepareStableFileDrafts(basePlatform({ other: true }, saved), { invoker });
    assert.deepEqual(platform.loadFileDrafts?.(), DRAFTS);
    assert.ok(
      invoker.calls.every((call) => call.cmd !== "helicon_save_file_drafts"),
      "cofre com dados não recebe migração",
    );
  });

  it("migra o local para o cofre vazio uma vez, sem apagar o local", async () => {
    tauriWindow();
    const saved = { count: 0 };
    let stable: string | null = null;
    const invoker = fakeInvoker((cmd, args) => {
      if (cmd === "helicon_save_file_drafts") {
        stable = args?.["content"] as string;
        return null;
      }
      return null;
    });
    const { platform } = await prepareStableFileDrafts(basePlatform(DRAFTS, saved), { invoker });
    assert.deepEqual(platform.loadFileDrafts?.(), DRAFTS);
    assert.deepEqual(JSON.parse(stable ?? ""), DRAFTS);
  });

  it("salva no local e no cofre, omite grande demais e mantém a ordem", async () => {
    tauriWindow();
    const saved = { count: 0 };
    const invoker = fakeInvoker(() => null);
    const { platform, flushStable } = await prepareStableFileDrafts(basePlatform(null, saved), { invoker });
    platform.saveFileDrafts?.(DRAFTS);
    platform.saveFileDrafts?.({ ...DRAFTS, ["/work/app\nbig.md"]: { content: "x".repeat(1_000_001), baseMtimeMs: 1 } });
    await flushStable();
    assert.equal(saved.count, 2, "o local continua sendo escrito de forma síncrona");
    const writes = invoker.calls.filter((call) => call.cmd === "helicon_save_file_drafts");
    assert.equal(writes.length, 2);
    assert.deepEqual(JSON.parse(writes[0]?.args?.["content"] as string), DRAFTS);
    assert.deepEqual(JSON.parse(writes[1]?.args?.["content"] as string), DRAFTS, "grande demais não entra no cofre");
  });

  it("falha do cofre não derruba o app e vai ao console", async () => {
    const errors: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const saver = createStableSaver(fakeInvoker(() => {
        throw new Error("disco cheio");
      }));
      saver.save(DRAFTS);
      await saver.flush();
      assert.ok(errors.length > 0, "falha visível no console");
    } finally {
      console.warn = original;
    }
  });
});
