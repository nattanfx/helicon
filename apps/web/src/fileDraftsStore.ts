import { invoke } from "@tauri-apps/api/core";
import { serializeFileDrafts, type FileDraft, type Platform } from "@helicon/ui";

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
  return {
    platform: {
      ...base,
      loadFileDrafts: () => frozen,
      saveFileDrafts: (drafts) => {
        base.saveFileDrafts?.(drafts);
        saver.save(drafts);
      },
    },
    flushStable: () => saver.flush(),
  };
}
