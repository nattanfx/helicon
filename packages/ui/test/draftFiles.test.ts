import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_FILES_PREFIX,
  DRAFT_TEXT_PREFIX,
  MAX_DRAFT_FILES_CHARS,
  MAX_DRAFT_FILES_TOTAL_CHARS,
  MAX_VAULT_DRAFT_FILES_CHARS,
  MAX_VAULT_DRAFT_FILES_TOTAL_CHARS,
  forgetStoredDraft,
  loadDraftFiles,
  persistDraftFiles,
  unsavedDraftFilesNotice,
  type DraftFilesVault,
  type StoredDraftFile,
  parseDraftFiles,
  storeDraftFiles,
  restoreDraftFiles,
  serializeDraftFiles,
  type DraftStorage,
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

  it("o teto por rascunho cabe folgado na cota de uns 5 milhões do WebView2", () => {
    assert.ok(MAX_DRAFT_FILES_CHARS <= 1_000_000);
    assert.ok(MAX_DRAFT_FILES_TOTAL_CHARS <= 2_000_000);
  });
});

function memoryStorage(quota = Infinity): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      let used = value.length;
      for (const [k, v] of map) {
        if (k !== key) {
          used += v.length;
        }
      }
      if (used > quota) {
        throw new Error("QuotaExceededError");
      }
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("gravação dos anexos do rascunho", () => {
  it("grava, e apaga quando a bandeja esvazia", () => {
    const storage = memoryStorage();
    assert.equal(storeDraftFiles(storage, "s1", [pending()]), "stored");
    assert.ok(storage.map.has(DRAFT_FILES_PREFIX + "s1"));
    assert.equal(storeDraftFiles(storage, "s1", []), "removed");
    assert.equal(storage.map.size, 0);
  });

  it("acima do teto somado com outros rascunhos, tira a cópia e não grava", () => {
    const storage = memoryStorage();
    const half = Math.floor(MAX_DRAFT_FILES_TOTAL_CHARS / 2);
    assert.equal(storeDraftFiles(storage, "a", [pending({ base64: "x".repeat(Math.min(half, MAX_DRAFT_FILES_CHARS)) })]), "stored");
    assert.equal(storeDraftFiles(storage, "b", [pending({ base64: "y".repeat(Math.min(half, MAX_DRAFT_FILES_CHARS) - 1000) })]), "stored");
    storage.map.set(DRAFT_FILES_PREFIX + "c", "velho");
    assert.equal(storeDraftFiles(storage, "c", [pending({ base64: "z".repeat(5000) })]), "skipped");
    assert.equal(storage.map.has(DRAFT_FILES_PREFIX + "c"), false, "uma cópia velha não volta no lugar da atual");
    assert.ok(storage.map.has(DRAFT_FILES_PREFIX + "a"), "os outros rascunhos ficam");
  });

  it("cota esgotada não lança e tira a cópia velha", () => {
    const storage = memoryStorage(100);
    storage.map.set(DRAFT_FILES_PREFIX + "s1", "[]");
    assert.equal(storeDraftFiles(storage, "s1", [pending({ base64: "x".repeat(500) })]), "skipped");
    assert.equal(storage.map.has(DRAFT_FILES_PREFIX + "s1"), false);
  });

  it("esquece texto e anexos de uma conversa excluída, sem tocar nas outras", () => {
    const storage = memoryStorage();
    storage.map.set(DRAFT_TEXT_PREFIX + "s1", "olá");
    storage.map.set(DRAFT_FILES_PREFIX + "s1", "[]");
    storage.map.set(DRAFT_TEXT_PREFIX + "s2", "outra");
    forgetStoredDraft(storage, "s1");
    assert.deepEqual([...storage.map.keys()], [DRAFT_TEXT_PREFIX + "s2"]);
    assert.doesNotThrow(() =>
      forgetStoredDraft(
        {
          removeItem: () => {
            throw new Error("indisponível");
          },
        },
        "s1",
      ),
    );
  });
});

/** O cofre do desktop na memória, como o app o monta depois de ler `composer-drafts.json`. */
function memoryVault(initial: Record<string, StoredDraftFile[]> = {}): DraftFilesVault & { writes: number } {
  let drafts: Record<string, readonly StoredDraftFile[]> = { ...initial };
  const vault = {
    writes: 0,
    all: () => drafts,
    set(key: string, files: readonly StoredDraftFile[]) {
      vault.writes += 1;
      if (files.length === 0) {
        const { [key]: _gone, ...rest } = drafts;
        drafts = rest;
      } else {
        drafts = { ...drafts, [key]: [...files] };
      }
    },
  };
  return vault;
}

describe("anexos do rascunho no cofre do desktop", () => {
  it("guarda uma imagem de ~954 KB (1,3 milhão de caracteres) que o localStorage recusaria, e ela volta ao reabrir", () => {
    const storage = memoryStorage();
    const vault = memoryVault();
    const image = pending({ base64: "x".repeat(1_300_000), size: 954_000 });
    assert.equal(persistDraftFiles(storage, undefined, "s1", [image]), "skipped", "no navegador o teto do localStorage vale");
    assert.equal(persistDraftFiles(storage, vault, "s1", [image]), "stored");
    assert.equal(storage.map.has(DRAFT_FILES_PREFIX + "s1"), false, "o espelho no localStorage não guarda anexos");
    // Reabrir: um cofre novo com o que foi gravado, e um localStorage vazio.
    const reopened = memoryVault(structuredClone(vault.all()) as Record<string, StoredDraftFile[]>);
    const restored = restoreDraftFiles(loadDraftFiles(memoryStorage(), reopened, "s1"));
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.base64.length, 1_300_000);
    assert.equal(restored[0]?.name, "print.png");
  });

  it("tira a cópia do localStorage de antes do cofre ao gravar no cofre, e a lê enquanto o cofre não tem nada", () => {
    const storage = memoryStorage();
    storage.map.set(DRAFT_FILES_PREFIX + "s1", JSON.stringify([{ name: "a.png", mediaType: "image/png", kind: "image", base64: "AAAA", size: 3 }]));
    const vault = memoryVault();
    assert.equal(loadDraftFiles(storage, vault, "s1").length, 1, "cópia antiga ainda volta");
    persistDraftFiles(storage, vault, "s1", restoreDraftFiles(loadDraftFiles(storage, vault, "s1")));
    assert.equal(storage.map.has(DRAFT_FILES_PREFIX + "s1"), false);
    assert.equal(vault.all()["s1"]?.length, 1);
  });

  it("acima do teto do cofre, tira a cópia e avisa que o anexo fica só na memória", () => {
    const vault = memoryVault({ s1: [{ name: "velho.png", mediaType: "image/png", kind: "image", base64: "AAAA", size: 3 }] });
    const huge = pending({ base64: "x".repeat(MAX_VAULT_DRAFT_FILES_CHARS + 1) });
    assert.equal(persistDraftFiles(null, vault, "s1", [huge]), "skipped");
    assert.equal(vault.all()["s1"], undefined, "uma cópia velha não volta no lugar da atual");
    assert.equal(persistDraftFiles(null, vault, "s1", [pending({ base64: "x".repeat(MAX_VAULT_DRAFT_FILES_CHARS) })]), "stored");
  });

  it("respeita o teto somado do cofre e esvazia ao tirar todos os anexos", () => {
    const vault = memoryVault();
    const chunk = MAX_VAULT_DRAFT_FILES_CHARS;
    let key = 0;
    while ((key + 1) * chunk <= MAX_VAULT_DRAFT_FILES_TOTAL_CHARS) {
      assert.equal(persistDraftFiles(null, vault, `k${key}`, [pending({ base64: "x".repeat(chunk) })]), "stored");
      key += 1;
    }
    assert.equal(persistDraftFiles(null, vault, "extra", [pending({ base64: "x".repeat(chunk) })]), "skipped");
    assert.equal(persistDraftFiles(null, vault, "k0", []), "removed");
    assert.equal(vault.all()["k0"], undefined);
    assert.equal(persistDraftFiles(null, vault, "extra", [pending({ base64: "x".repeat(chunk) })]), "stored");
  });

  it("os tetos do cofre ficam acima dos do localStorage", () => {
    assert.equal(MAX_VAULT_DRAFT_FILES_CHARS, 3_000_000);
    assert.equal(MAX_VAULT_DRAFT_FILES_TOTAL_CHARS, 20_000_000);
    assert.ok(MAX_VAULT_DRAFT_FILES_CHARS > MAX_DRAFT_FILES_CHARS);
  });

  it("explica em português o anexo que não ficou guardado", () => {
    assert.equal(
      unsavedDraftFilesNotice(1, true),
      "Este anexo é grande demais para ficar guardado no rascunho; ele some se você fechar o app.",
    );
    assert.match(unsavedDraftFilesNotice(2, false), /^Estes anexos são grandes demais.*fechar ou recarregar a página\.$/);
  });
});

