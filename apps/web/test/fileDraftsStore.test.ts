import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadDraftFiles, persistDraftFiles, restoreDraftFiles, type Platform } from "@helicon/ui";
import {
  createComposerVault,
  createStableSaver,
  loadComposerDrafts,
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

  it("cota esgotada no local não impede o cofre e tira o espelho velho", async () => {
    tauriWindow();
    const writes: Record<string, unknown>[] = [];
    const base = {
      ...basePlatform(null, { count: 0 }),
      saveFileDrafts: (drafts: Record<string, unknown>) => {
        writes.push(drafts);
        if (Object.keys(drafts).length > 0) {
          throw new Error("QuotaExceededError");
        }
      },
    } as Platform;
    const invoker = fakeInvoker(() => null);
    const original = console.warn;
    console.warn = () => {};
    try {
      const { platform, flushStable } = await prepareStableFileDrafts(base, { invoker });
      assert.doesNotThrow(() => platform.saveFileDrafts?.(DRAFTS), "o cofre guardou: nada de aviso de falha");
      await flushStable();
      const saved = invoker.calls.filter((call) => call.cmd === "helicon_save_file_drafts");
      assert.equal(saved.length, 1);
      assert.deepEqual(JSON.parse(saved[0]?.args?.["content"] as string), DRAFTS);
      assert.deepEqual(writes.at(-1), {}, "o espelho local sai para não voltar uma versão velha");
    } finally {
      console.warn = original;
    }
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

describe("cofre dos anexos de rascunho no desktop", () => {
  const image = {
    id: "f1",
    name: "captura.png",
    mediaType: "image/png",
    kind: "image" as const,
    url: null,
    // Uma imagem de ~954 KB em base64: acima do teto de 1 milhão do localStorage.
    base64: "x".repeat(1_300_000),
    width: 10,
    height: 10,
    size: 954_000,
  };

  it("uma imagem de 1,3 milhão de caracteres sobrevive a fechar e reabrir o app", async () => {
    tauriWindow();
    let disk: string | null = null;
    const invoker = fakeInvoker((cmd, args) => {
      if (cmd === "helicon_save_composer_drafts") {
        disk = args?.["content"] as string;
      }
      return cmd === "helicon_load_composer_drafts" ? disk : null;
    });
    const first = await prepareStableFileDrafts(basePlatform(null, { count: 0 }), { invoker });
    const vault = first.platform.draftFilesVault;
    assert.ok(vault, "o desktop tem cofre de anexos");
    assert.equal(persistDraftFiles(null, vault, "s1", [image]), "stored");
    await first.flushStable();
    assert.ok(disk, "o fechar descarrega a escrita");

    const reopened = await prepareStableFileDrafts(basePlatform(null, { count: 0 }), { invoker });
    const restored = restoreDraftFiles(loadDraftFiles(null, reopened.platform.draftFilesVault, "s1"));
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.base64.length, 1_300_000);
    assert.equal(restored[0]?.name, "captura.png");
  });

  it("junta mudanças seguidas numa escrita com o estado mais novo, e apagar tudo grava vazio", async () => {
    const invoker = fakeInvoker(() => null);
    const vault = createComposerVault({}, invoker);
    vault.set("a", [{ name: "a.txt", mediaType: "text/plain", kind: "file", base64: "QQ==", size: 1 }]);
    vault.set("b", [{ name: "b.txt", mediaType: "text/plain", kind: "file", base64: "Qg==", size: 1 }]);
    await vault.flush();
    const writes = invoker.calls.filter((call) => call.cmd === "helicon_save_composer_drafts");
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(writes[0]?.args?.["content"] as string)), ["a", "b"]);
    vault.set("a", []);
    vault.set("b", []);
    vault.set("nunca-existiu", []);
    await vault.flush();
    const last = invoker.calls.filter((call) => call.cmd === "helicon_save_composer_drafts").at(-1);
    assert.equal(last?.args?.["content"], "{}", "o Rust apaga o arquivo com {}");
  });

  it("lê só anexos bem formados e trata ausência e corrupção como vazio", async () => {
    assert.deepEqual(await loadComposerDrafts(fakeInvoker(() => null)), {});
    assert.deepEqual(await loadComposerDrafts(fakeInvoker(() => "{ quebrado")), {});
    const loaded = await loadComposerDrafts(
      fakeInvoker(() =>
        JSON.stringify({ s1: [{ name: "a.png", mediaType: "image/png", kind: "image", base64: "AAAA", size: 3 }, { bogus: true }], s2: [] }),
      ),
    );
    assert.deepEqual(Object.keys(loaded), ["s1"]);
    assert.equal(loaded["s1"]?.length, 1);
  });

  it("sem conseguir ler o cofre, os anexos ficam no localStorage como antes", async () => {
    tauriWindow();
    const original = console.warn;
    console.warn = () => {};
    try {
      const invoker = fakeInvoker((cmd) => {
        if (cmd === "helicon_load_composer_drafts") {
          throw new Error("comando negado");
        }
        return null;
      });
      const { platform } = await prepareStableFileDrafts(basePlatform(null, { count: 0 }), { invoker });
      assert.equal(platform.draftFilesVault, undefined);
    } finally {
      console.warn = original;
    }
  });

  it("no navegador não há cofre de anexos", async () => {
    plainWindow();
    const { platform } = await prepareStableFileDrafts(basePlatform(null, { count: 0 }), { invoker: fakeInvoker(() => null) });
    assert.equal(platform.draftFilesVault, undefined);
  });
});

