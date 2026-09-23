import type { PendingFile } from "../components/composer/attachments.js";

/** Anexos de um rascunho da caixa de mensagem, por chave de conversa; o texto mora em `helicon.draft.*`. */
export const DRAFT_FILES_PREFIX = "helicon.draftFiles.";

/** Teto de base64 por rascunho (cerca de 2,2 MB binários); acima disso o anexo fica só na memória. */
export const MAX_DRAFT_FILES_CHARS = 3_000_000;

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
