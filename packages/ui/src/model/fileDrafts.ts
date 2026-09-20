import type { FileDraft } from "./store.js";

export const FILE_DRAFTS_KEY = "helicon.fileDrafts.v1";
/** Cópia recuperável por arquivo; acima disso o rascunho fica só na memória. */
export const MAX_FILE_DRAFT_CHARS = 1_000_000;

export const FILE_DRAFTS_LEAVE_MESSAGE =
  "Há edições de arquivo que ainda não foram gravadas no disco. Fechar não as escreve nos arquivos; a cópia recuperável fica neste aparelho se o armazenamento local estiver intacto.";

export const FILE_DRAFTS_LIMIT_MESSAGE =
  "A edição passou do tamanho da cópia local (1.000.000 de caracteres) e não foi guardada. Ela continua nesta sessão; fechar ou reiniciar pode perdê-la.";

export const FILE_DRAFTS_LEAVE_UNSAFE_MESSAGE =
  "Há edições de arquivo que ainda não foram gravadas no disco. Algumas não têm cópia guardada neste aparelho (muito grandes ou armazenamento falhou); fechar pode perdê-las.";

/** Chaves com edição grande demais para a cópia local; a omissão nunca é sucesso. */
export function oversizedFileDraftKeys(drafts: Record<string, FileDraft>): string[] {
  return Object.entries(drafts)
    .filter(([key, draft]) => isFileKey(key) && typeof draft.content === "string" && draft.content.length > MAX_FILE_DRAFT_CHARS)
    .map(([key]) => key);
}

function isFileKey(key: string): boolean {
  const split = key.indexOf("\n");
  return split > 0 && split < key.length - 1;
}

function asDraft(value: unknown): FileDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.content !== "string") {
    return null;
  }
  if (row.content.length > MAX_FILE_DRAFT_CHARS) {
    return null;
  }
  const base = row.baseMtimeMs;
  if (base !== null && (typeof base !== "number" || !Number.isFinite(base))) {
    return null;
  }
  return { content: row.content, baseMtimeMs: base === null ? null : base };
}

/** Aceita só rascunhos bem formados, com chave projeto/caminho. Descarta o resto. */
export function parseFileDrafts(raw: unknown): Record<string, FileDraft> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, FileDraft> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isFileKey(key)) {
      continue;
    }
    const draft = asDraft(value);
    if (draft) {
      out[key] = draft;
    }
  }
  return out;
}

/** Omite edições grandes demais para o armazenamento local. Vazio é edição válida; ausência/null descarta. */
export function serializeFileDrafts(drafts: Record<string, FileDraft>): Record<string, FileDraft> {
  const out: Record<string, FileDraft> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    if (!isFileKey(key) || typeof draft.content !== "string" || draft.content.length > MAX_FILE_DRAFT_CHARS) {
      continue;
    }
    out[key] = { content: draft.content, baseMtimeMs: draft.baseMtimeMs };
  }
  return out;
}

export function fileDraftConflicts(draft: FileDraft, diskMtimeMs: number | null | undefined): boolean {
  return draft.baseMtimeMs !== null && diskMtimeMs != null && draft.baseMtimeMs !== diskMtimeMs;
}

export function splitFileKey(key: string): { cwd: string; path: string } | null {
  const split = key.indexOf("\n");
  if (split <= 0 || split >= key.length - 1) {
    return null;
  }
  return { cwd: key.slice(0, split), path: key.slice(split + 1) };
}
