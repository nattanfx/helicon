import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HeliconController, type Platform } from "../src/model/controller.js";
import { MAX_FILE_DRAFT_CHARS } from "../src/model/fileDrafts.js";
import type { FileDraft } from "../src/model/store.js";

/**
 * REV5 — a cópia recuperável não pode depender da porta da origem web.
 *
 * O `localStorage` é por origem (esquema, host e porta). Quando a porta anterior está ocupada,
 * o desktop sobe noutra e a origem nova não enxerga a cópia da antiga. Estes casos cobrem a
 * reprodução com armazenamentos isolados e o comportamento esperado com um cofre estável por
 * instalação (no app, `file-drafts.json` via comandos Tauri), sem tocar no arquivo original.
 */

class FakeClient {
  handler: ((event: never) => void) | null = null;
  subscribe(handler: (event: never) => void) {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }
  async writeFile(_cwd: string, path: string, content: string, _baseMtimeMs: number | null) {
    return { path, size: content.length, mtimeMs: 200 };
  }
}

/** Um `localStorage` descartável de uma origem: isolado por construção, como origens de portas distintas. */
function originStorage(initial: unknown = null) {
  let current: unknown = initial;
  return {
    load: () => current,
    save: (drafts: Record<string, FileDraft>) => {
      current = drafts;
    },
    peek: () => current,
  };
}

function testPlatform(drafts: { load: () => unknown; save: (drafts: Record<string, FileDraft>) => void }): Platform {
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
    loadFileDrafts: () => drafts.load(),
    saveFileDrafts: (next) => drafts.save(next),
  };
}

/** Plataforma com cofre estável compartilhado: o que a origem nova lê independe da porta antiga. */
function stablePlatform(
  local: { load: () => unknown; save: (drafts: Record<string, FileDraft>) => void },
  stable: { snapshot: unknown; save: (drafts: Record<string, FileDraft>) => void },
): Platform {
  const base = testPlatform(local);
  return {
    ...base,
    loadFileDrafts: () => stable.snapshot,
    saveFileDrafts: (drafts) => {
      base.saveFileDrafts?.(drafts);
      stable.save(drafts);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
const KEY = "/work/app\nREADME.md";

describe("REV5 — recuperação independente da porta", () => {
  it("reproduz a perda: origem nova não enxerga a cópia guardada pela origem antiga", () => {
    const originA = originStorage({ [KEY]: { content: "# rascunho", baseMtimeMs: 100 } });
    const originB = originStorage();
    const controllerB = new HeliconController(new FakeClient() as never, testPlatform(originB));
    assert.deepEqual(controllerB.store.get().fileDrafts, {}, "a origem nova parte vazia");
    assert.ok(originA.peek() !== null, "a cópia antiga continua guardada, só que inacessível ao fluxo normal");
    controllerB.dispose();
  });

  it("recupera do cofre estável após a troca de porta, inclusive edição vazia", async () => {
    const stable = { snapshot: null as unknown, save: (drafts: Record<string, FileDraft>) => {} };
    stable.save = (drafts) => {
      stable.snapshot = drafts;
    };
    const controllerA = new HeliconController(new FakeClient() as never, stablePlatform(originStorage(), stable));
    const stopA = controllerA.start();
    controllerA.setFileDraft("/work/app", "README.md", "", 100);
    await settle();
    controllerA.dispose();
    stopA();
    assert.equal((stable.snapshot as Record<string, FileDraft>)[KEY]?.content, "", "vazio continua sendo edição válida");

    const controllerB = new HeliconController(
      new FakeClient() as never,
      stablePlatform(originStorage(), stable),
    );
    assert.equal(controllerB.store.get().fileDrafts[KEY]?.content, "", "a mesma instalação recupera na origem nova");
    const stopB = controllerB.start();
    assert.ok(controllerB.store.get().toasts.some((toast) => /não gravadas/.test(toast.title)));
    controllerB.dispose();
    stopB();
  });

  it("não compartilha cópias entre instalações distintas", async () => {
    const stableNormal = { snapshot: null as unknown, save: (drafts: Record<string, FileDraft>) => {} };
    stableNormal.save = (drafts) => {
      stableNormal.snapshot = drafts;
    };
    const stableTest = { snapshot: null as unknown, save: (drafts: Record<string, FileDraft>) => {} };
    stableTest.save = (drafts) => {
      stableTest.snapshot = drafts;
    };
    const normal = new HeliconController(new FakeClient() as never, stablePlatform(originStorage(), stableNormal));
    const stopNormal = normal.start();
    normal.setFileDraft("/work/app", "README.md", "# normal", 100);
    await settle();
    normal.dispose();
    stopNormal();

    const teste = new HeliconController(new FakeClient() as never, stablePlatform(originStorage(), stableTest));
    assert.deepEqual(teste.store.get().fileDrafts, {}, "Teste e normal são cofres separados");
    teste.dispose();
  });

  it("salvar e descartar limpam o cofre; grande demais não entra e avisa", async () => {
    const stable = { snapshot: null as unknown, save: (drafts: Record<string, FileDraft>) => {} };
    stable.save = (drafts) => {
      stable.snapshot = drafts;
    };
    const controller = new HeliconController(new FakeClient() as never, stablePlatform(originStorage(), stable));
    const stop = controller.start();
    controller.setFileDraft("/work/app", "README.md", "# rascunho", 100);
    await settle();
    assert.equal((stable.snapshot as Record<string, FileDraft>)[KEY]?.content, "# rascunho");
    assert.equal(await controller.saveFile("/work/app", "README.md"), 200);
    assert.deepEqual(stable.snapshot, {}, "salvar limpa a cópia");

    controller.setFileDraft("/work/app", "notes.md", "# outra", 50);
    await settle();
    controller.setFileDraft("/work/app", "notes.md", null);
    assert.deepEqual(stable.snapshot, {}, "descartar limpa a cópia");

    controller.setFileDraft("/work/app", "big.md", "x".repeat(MAX_FILE_DRAFT_CHARS + 1), 1);
    await settle();
    assert.equal(
      (stable.snapshot as Record<string, FileDraft>)["/work/app\nbig.md"],
      undefined,
      "acima do limite não entra no cofre",
    );
    assert.ok(controller.store.get().toasts.some((toast) => /não foi guardada/.test(toast.title)));
    controller.dispose();
    stop();
  });
});
