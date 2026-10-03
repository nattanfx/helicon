import type { PendingFile } from "../components/composer/attachments.js";

/** Texto do rascunho da caixa de mensagem, por chave de conversa (`sessionId` ou `new:<cwd>`). */
export const DRAFT_TEXT_PREFIX = "helicon.draft.";

/** Anexos de um rascunho da caixa de mensagem, por chave de conversa; o texto mora em `helicon.draft.*`. */
export const DRAFT_FILES_PREFIX = "helicon.draftFiles.";

/**
 * Teto de base64 por rascunho (cerca de 730 KB binários); acima disso o anexo fica só na memória.
 * A cota do WebView2 é de uns 5 milhões de caracteres por origem, dividida com prefs e edições de arquivo.
 */
export const MAX_DRAFT_FILES_CHARS = 1_000_000;

/** Teto somado de todos os anexos de rascunho guardados, para sobrar cota às prefs e às edições de arquivo. */
export const MAX_DRAFT_FILES_TOTAL_CHARS = 2_000_000;

/** O pedaço do `localStorage` que a gravação dos anexos usa; injetável nos testes. */
export interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Um anexo guardado no armazenamento local: bytes e metadados, sem id efêmero nem URL de objeto. */
export interface StoredDraftFile {
  name: string;
  mediaType: string;
  kind: "image" | "file";
  base64: string;
  width?: number;
  height?: number;
  size: number;
}

function asStored(value: unknown): StoredDraftFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row["name"] !== "string" || !row["name"]) {
    return null;
  }
  if (typeof row["mediaType"] !== "string" || !row["mediaType"]) {
    return null;
  }
  if (row["kind"] !== "image" && row["kind"] !== "file") {
    return null;
  }
  if (typeof row["base64"] !== "string" || !row["base64"]) {
    return null;
  }
  if (typeof row["size"] !== "number" || !Number.isFinite(row["size"]) || row["size"] < 0) {
    return null;
  }
  const width = row["width"];
  const height = row["height"];
  if (width !== undefined && (typeof width !== "number" || !Number.isFinite(width))) {
    return null;
  }
  if (height !== undefined && (typeof height !== "number" || !Number.isFinite(height))) {
    return null;
  }
  return {
    name: row["name"],
    mediaType: row["mediaType"],
    kind: row["kind"],
    base64: row["base64"],
    ...(width !== undefined && height !== undefined ? { width, height } : {}),
    size: row["size"],
  };
}

/** Aceita só anexos bem formados; descarta o resto sem lançar. */
export function parseDraftFiles(raw: unknown): StoredDraftFile[] {
  if (typeof raw !== "string") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const out: StoredDraftFile[] = [];
  for (const entry of parsed) {
    const file = asStored(entry);
    if (file) {
      out.push(file);
    }
  }
  return out;
}

/** Serializa para o armazenamento local; null quando passa do teto (tudo-ou-nada, sem meio rascunho). */
export function serializeDraftFiles(files: readonly PendingFile[]): string | null {
  let chars = 0;
  const stored: StoredDraftFile[] = files.map((file) => {
    chars += file.base64.length;
    return {
      name: file.name,
      mediaType: file.mediaType,
      kind: file.kind,
      base64: file.base64,
      ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
      size: file.size,
    };
  });
  if (chars > MAX_DRAFT_FILES_CHARS) {
    return null;
  }
  return JSON.stringify(stored);
}

let draftFileSeq = 0;

/** Reconstrói a bandeja a partir do armazenamento; prévias viram data: URLs (blob: não sobrevive a recarregar). */
export function restoreDraftFiles(stored: readonly StoredDraftFile[]): PendingFile[] {
  return stored.map((file) => {
    draftFileSeq += 1;
    return {
      id: `draft-${Date.now().toString(36)}-${draftFileSeq}`,
      name: file.name,
      mediaType: file.mediaType,
      kind: file.kind,
      url: file.kind === "image" ? `data:${file.mediaType};base64,${file.base64}` : null,
      base64: file.base64,
      ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
      size: file.size,
    };
  });
}

/**
 * Grava (ou apaga) os anexos do rascunho `key`. Acima do teto do rascunho, acima do teto somado com os
 * outros rascunhos, ou com a cota esgotada, a cópia guardada sai e o anexo fica só na memória: uma cópia
 * velha não volta no lugar da atual, e a cota sobra para prefs e edições de arquivo. Nunca lança.
 */
export function storeDraftFiles(storage: DraftStorage, key: string, files: readonly PendingFile[]): "stored" | "removed" | "skipped" {
  const storageKey = DRAFT_FILES_PREFIX + key;
  const drop = (): void => {
    try {
      storage.removeItem(storageKey);
    } catch {
      /* armazenamento indisponível: nada a liberar */
    }
  };
  if (files.length === 0) {
    drop();
    return "removed";
  }
  const raw = serializeDraftFiles(files);
  if (raw === null) {
    drop();
    return "skipped";
  }
  try {
    let others = 0;
    for (let i = 0; i < storage.length; i++) {
      const other = storage.key(i);
      if (other && other !== storageKey && other.startsWith(DRAFT_FILES_PREFIX)) {
        others += storage.getItem(other)?.length ?? 0;
      }
    }
    if (others + raw.length > MAX_DRAFT_FILES_TOTAL_CHARS) {
      drop();
      return "skipped";
    }
    storage.setItem(storageKey, raw);
    return "stored";
  } catch {
    drop();
    return "skipped";
  }
}

/** Apaga texto e anexos guardados do rascunho de uma conversa excluída. Nunca lança. */
export function forgetStoredDraft(storage: Pick<DraftStorage, "removeItem">, key: string): void {
  for (const storageKey of [DRAFT_TEXT_PREFIX + key, DRAFT_FILES_PREFIX + key]) {
    try {
      storage.removeItem(storageKey);
    } catch {
      /* armazenamento indisponível: nada a apagar */
    }
  }
}
