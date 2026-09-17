import { FileText, Paperclip, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AttachmentView, OutgoingAttachment } from "../../types.js";
import type { EchoAttachment } from "../../model/fold.js";
import { cn } from "../ui/primitives.js";

/** Um arquivo que o usuário anexou mas ainda não enviou: bytes prontos para transmissão, mais uma prévia local. */
export interface PendingFile {
  id: string;
  name: string;
  mediaType: string;
  kind: "image" | "file";
  /** Uma URL de objeto para a prévia de imagem; nulo para o resto. */
  url: string | null;
  base64: string;
  width?: number;
  height?: number;
  size: number;
}

/** Imagens são a única parte que o Muse recebe direto; o resto vai junto como arquivo na pasta do projeto. */
export function kindOf(mediaType: string): "image" | "file" {
  return mediaType.startsWith("image/") ? "image" : "file";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function measure(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  } catch {
    return null;
  }
}

let fileSeq = 0;

/** Lê arquivos arrastados, colados ou escolhidos para o que o composer guarda até a mensagem ser enviada. */
export async function readFiles(files: Iterable<File>): Promise<PendingFile[]> {
  const out: PendingFile[] = [];
  for (const file of files) {
    const mediaType = file.type || "application/octet-stream";
    const kind = kindOf(mediaType);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = kind === "image" ? URL.createObjectURL(file) : null;
    const size = url ? await measure(url) : null;
    fileSeq += 1;
    out.push({
      id: `file-${Date.now().toString(36)}-${fileSeq}`,
      name: file.name || (kind === "image" ? "imagem-colada.png" : "arquivo"),
      mediaType,
      kind,
      url,
      base64: toBase64(bytes),
      ...(size ?? {}),
      size: bytes.length,
    });
  }
  return out;
}

/**
 * Relê do servidor os arquivos de uma mensagem enviada, para uma repetição levar os mesmos bytes em vez de
 * silenciosamente fazer outra pergunta ao modelo. Lança erro quando um arquivo não pode ser lido.
 */
export async function refetchAttachments(files: readonly AttachmentView[]): Promise<PendingFile[]> {
  const out: PendingFile[] = [];
  for (const file of files) {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`${file.name} não pôde ser relido (${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    fileSeq += 1;
    out.push({
      id: `file-${Date.now().toString(36)}-${fileSeq}`,
      name: file.name,
      mediaType: file.mediaType,
      kind: file.kind,
      // O servidor continua servindo estes, então a prévia não precisa de URL de objeto própria.
      url: file.kind === "image" ? file.url : null,
      base64: toBase64(bytes),
      ...(file.width !== null && file.height !== null ? { width: file.width, height: file.height } : {}),
      size: bytes.length,
    });
  }
  return out;
}

export function toOutgoing(file: PendingFile): OutgoingAttachment {
  return {
    name: file.name,
    mediaType: file.mediaType,
    base64: file.base64,
    ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
  };
}

/**
 * Reconstrói a bandeja a partir de um prompt devolvido após um envio falho. Os bytes já estão em mãos, então
 * nada é lido uma segunda vez, e as prévias com que a mensagem saiu continuam válidas.
 */
export function restoreFiles(attachments: readonly OutgoingAttachment[], previews: readonly EchoAttachment[]): PendingFile[] {
  return attachments.map((file, index) => {
    const preview = previews[index];
    const padding = file.base64.endsWith("==") ? 2 : file.base64.endsWith("=") ? 1 : 0;
    fileSeq += 1;
    return {
      id: `file-${Date.now().toString(36)}-${fileSeq}`,
      name: file.name,
      mediaType: file.mediaType,
      kind: preview?.kind ?? kindOf(file.mediaType),
      url: preview?.url ?? null,
      base64: file.base64,
      ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
      // Quatro caracteres base64 carregam três bytes, menos o que o preenchimento substitui.
      size: Math.max(0, Math.floor((file.base64.length * 3) / 4) - padding),
    };
  });
}

export function toPreview(file: PendingFile): EchoAttachment {
  return { name: file.name, mediaType: file.mediaType, kind: file.kind, url: file.url };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** O que o composer mostra para os arquivos esperando para ir com a próxima mensagem. */
export function AttachmentTray(props: { files: PendingFile[]; onRemove: (id: string) => void }) {
  const [zoom, setZoom] = useState<PendingFile | null>(null);
  if (props.files.length === 0) {
    return null;
  }
  return (
    <>
      <ul className="flex flex-wrap gap-2 px-3 pt-3">
        {props.files.map((file) => (
          <li key={file.id} className="group/att relative">
            {file.kind === "image" && file.url ? (
              <button
                type="button"
                onClick={() => setZoom(file)}
                aria-label={`Abrir ${file.name}`}
                className="block size-16 overflow-hidden rounded-xl bg-sunken shadow-[0_0_0_1px_var(--border)] transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                <img src={file.url} alt={file.name} className="size-full object-cover" />
              </button>
            ) : (
              <div className="flex h-16 max-w-[220px] items-center gap-2 rounded-xl bg-sunken px-3 shadow-[0_0_0_1px_var(--border)]">
                <FileText size={15} className="shrink-0 text-subtle" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-fg">{file.name}</p>
                  <p className="text-2xs text-subtle">{formatSize(file.size)}</p>
                </div>
              </div>
            )}
            <button
              type="button"
              aria-label={`Remover ${file.name}`}
              onClick={() => props.onRemove(file.id)}
              className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-inverse text-inverse-fg opacity-0 shadow-pop transition-opacity duration-100 group-hover/att:opacity-100 focus-visible:opacity-100"
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </li>
        ))}
      </ul>
      {zoom?.url ? <Lightbox name={zoom.name} url={zoom.url} onClose={() => setZoom(null)} /> : null}
    </>
  );
}

/** A cópia dos anexos na mensagem enviada, servida de volta pelo servidor. */
export function SentAttachments(props: { files: (AttachmentView | EchoAttachment)[]; className?: string }) {
  const [zoom, setZoom] = useState<{ name: string; url: string } | null>(null);
  if (props.files.length === 0) {
    return null;
  }
  return (
    <>
      <ul className={cn("flex flex-wrap justify-end gap-2", props.className)}>
        {props.files.map((file, index) => (
          <li key={"id" in file ? file.id : `${file.name}-${index}`}>
            {file.kind === "image" && file.url ? (
              <button
                type="button"
                onClick={() => setZoom({ name: file.name, url: file.url as string })}
                aria-label={`Abrir ${file.name}`}
                className="block max-h-44 overflow-hidden rounded-xl bg-sunken shadow-[0_0_0_1px_var(--border)] transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                <img src={file.url} alt={file.name} className="max-h-44 w-auto object-contain" />
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-sunken px-2.5 py-1.5 text-xs text-muted shadow-[0_0_0_1px_var(--border)]">
                <FileText size={13} className="shrink-0 text-subtle" />
                {file.name}
              </span>
            )}
          </li>
        ))}
      </ul>
      {zoom ? <Lightbox name={zoom.name} url={zoom.url} onClose={() => setZoom(null)} /> : null}
    </>
  );
}

/** Uma imagem em tamanho real sobre a conversa; Escape ou um clique em qualquer lugar a fecha. */
function Lightbox(props: { name: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.name}
      onClick={props.onClose}
      className="overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-[oklch(0_0_0/0.62)] p-8"
    >
      <img src={props.url} alt={props.name} className="modal-pop max-h-full max-w-full rounded-xl object-contain shadow-pop" />
    </div>
  );
}

/** O botão que abre o seletor de arquivos. */
export function AttachButton(props: { onFiles: (files: FileList) => void; disabled?: boolean }) {
  return (
    <label
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-100 hover:bg-hover hover:text-fg",
        props.disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="sr-only">Anexar arquivos</span>
      <Paperclip size={14} />
      <input
        type="file"
        multiple
        className="hidden"
        disabled={props.disabled}
        onChange={(event) => {
          if (event.currentTarget.files?.length) {
            props.onFiles(event.currentTarget.files);
          }
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
