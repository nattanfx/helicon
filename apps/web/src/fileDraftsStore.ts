import { invoke } from "@tauri-apps/api/core";
import {
  parseStoredDraftFiles,
  serializeFileDrafts,
  type DraftFilesVault,
  type FileDraft,
  type Platform,
  type StoredDraftFile,
} from "@helicon/ui";

/**
 * Cópia recuperável de edições fora da origem web da janela (REV5).
 *
 * O `localStorage` é por origem (esquema, host e porta). No desktop, quando a porta anterior está
 * ocupada, o servidor sobe noutra porta e a origem nova não enxerga a cópia guardada pela antiga.
 * Com Tauri presente, a cópia vive também em `file-drafts.json` na pasta de dados da instalação
 * (separada entre normal e Teste pelo identificador), lida antes de montar o app e gravada em fila.
 * No navegador puro, a origem é estável e o `localStorage` continua sendo o cofre.
 */

export const DRAFTS_LOAD_CMD = "helicon_load_file_drafts";
export const DRAFTS_SAVE_CMD = "helicon_save_file_drafts";
/** Anexos não enviados da caixa de mensagem: `composer-drafts.json`, um cofre à parte das edições de arquivo. */
export const COMPOSER_DRAFTS_LOAD_CMD = "helicon_load_composer_drafts";
export const COMPOSER_DRAFTS_SAVE_CMD = "helicon_save_composer_drafts";

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export function isTauriWindow(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Lê o cofre estável; `null` = sem cópia ou ilegível (a interface valida o conteúdo). */
export async function loadStableFileDrafts(invoker: InvokeFn = invoke): Promise<unknown> {
  const raw = await invoker(DRAFTS_LOAD_CMD);
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function hasDrafts(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

export interface StableSaver {
  /** Enfileira a escrita; nunca lança de forma síncrona (falha vai ao console). */
  save(drafts: Record<string, FileDraft>): void;
  /** Escreve agora; falha vira `console.warn`, sem lançar. */
  saveNow(drafts: Record<string, FileDraft>): Promise<void>;
  /** Espera a fila esvaziar; o fechar do desktop usa isto antes de liberar a janela. */
  flush(): Promise<void>;
}

export function createStableSaver(invoker: InvokeFn = invoke): StableSaver {
  let tail: Promise<void> = Promise.resolve();
  const run = (content: string): Promise<void> => {
    const next = tail.then(() => invoker(DRAFTS_SAVE_CMD, { content })).then(
      () => undefined,
      (error) => {
        console.warn("Helicon: não foi possível guardar a cópia estável de edições", error);
      },
    );
    tail = next;
    return next;
  };
  return {
    save(drafts) {
      void run(JSON.stringify(serializeFileDrafts(drafts)));
    },
    saveNow(drafts) {
      return run(JSON.stringify(serializeFileDrafts(drafts)));
    },
    flush() {
      return tail;
    },
  };
}

/** Lê os anexos guardados dos rascunhos da caixa de mensagem; entradas inválidas ficam de fora. */
export async function loadComposerDrafts(invoker: InvokeFn = invoke): Promise<Record<string, StoredDraftFile[]>> {
  const raw = await invoker(COMPOSER_DRAFTS_LOAD_CMD);
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  const out: Record<string, StoredDraftFile[]> = {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return out;
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const files = parseStoredDraftFiles(value);
    if (key && files.length > 0) {
      out[key] = files;
    }
  }
  return out;
}

/**
 * O cofre dos anexos de rascunho: o mapa vive na memória e cada mudança enfileira uma escrita do arquivo inteiro.
 * Mudanças seguidas enquanto uma escrita espera viram uma só, que leva o estado mais novo.
 */
export function createComposerVault(
  initial: Record<string, StoredDraftFile[]>,
  invoker: InvokeFn = invoke,
): DraftFilesVault & { flush(): Promise<void> } {
  let drafts: Record<string, readonly StoredDraftFile[]> = { ...initial };
  let tail: Promise<void> = Promise.resolve();
  let queued = false;
  const write = (): void => {
    if (queued) {
      return;
    }
    queued = true;
    tail = tail
      .then(() => {
        queued = false;
        return invoker(COMPOSER_DRAFTS_SAVE_CMD, { content: JSON.stringify(drafts) });
      })
      .then(
        () => undefined,
        (error) => {
          console.warn("Helicon: não foi possível guardar os anexos do rascunho", error);
        },
      );
  };
  return {
    all: () => drafts,
    set(key, files) {
      if (files.length === 0) {
        if (!(key in drafts)) {
          return;
        }
        const { [key]: _gone, ...rest } = drafts;
        drafts = rest;
      } else {
        drafts = { ...drafts, [key]: [...files] };
      }
      write();
    },
    flush: () => tail,
  };
}

/**
 * Monta a `Platform` com cofre estável no desktop. Fora do Tauri, devolve a base intacta.
 * Migração única: cofre vazio + `localStorage` atual com rascunhos copia para o cofre, sem apagar o local.
 */
export async function prepareStableFileDrafts(
  base: Platform,
  deps: { invoker?: InvokeFn } = {},
): Promise<{ platform: Platform; flushStable: () => Promise<void> }> {
  const noop = { platform: base, flushStable: () => Promise.resolve() };
  if (!isTauriWindow()) {
    return noop;
  }
  const invoker = deps.invoker ?? invoke;
  let stable: unknown = null;
  try {
    stable = await loadStableFileDrafts(invoker);
  } catch {
    stable = null;
  }
  let local: unknown = null;
  try {
    local = base.loadFileDrafts?.() ?? null;
  } catch {
    local = null;
  }
  const saver = createStableSaver(invoker);
  let snapshot: unknown = stable;
  if (!hasDrafts(snapshot) && hasDrafts(local)) {
    snapshot = local;
    await saver.saveNow(local as Record<string, FileDraft>);
  }
  const frozen = snapshot;
  // Sem conseguir ler o cofre dos anexos, gravar nele também falharia: os anexos ficam no `localStorage`, como antes.
  let composer: (DraftFilesVault & { flush(): Promise<void> }) | undefined;
  try {
    composer = createComposerVault(await loadComposerDrafts(invoker), invoker);
  } catch (error) {
    console.warn("Helicon: cofre dos anexos de rascunho indisponível; eles ficam no armazenamento local", error);
    composer = undefined;
  }
  return {
    platform: {
      ...base,
      ...(composer ? { draftFilesVault: composer } : {}),
      loadFileDrafts: () => frozen,
      saveFileDrafts: (drafts) => {
        // O cofre vem primeiro: uma cota esgotada no `localStorage` não pode impedir a cópia durável.
        saver.save(drafts);
        try {
          base.saveFileDrafts?.(drafts);
        } catch (error) {
          // O espelho local é só passagem; sem espaço, sai inteiro para não sobrar uma versão velha.
          console.warn("Helicon: cópia local de edições não coube; o cofre do desktop segue valendo", error);
          try {
            base.saveFileDrafts?.({});
          } catch {
            /* nada a liberar */
          }
        }
      },
    },
    flushStable: () => Promise.all([saver.flush(), composer?.flush()]).then(() => undefined),
  };
}
