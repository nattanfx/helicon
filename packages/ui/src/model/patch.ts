import type { OutputRange } from "../types.js";

export const PATCH_PREVIEW_LIMIT = 8 * 1024 * 1024;

/** `item/readOutput` is byte-ranged; advance by the returned byte count, not string length. */
export async function loadHostPatch(
  readOutput: (sessionId: string, itemId: string, outputRef: string, offset: number) => Promise<OutputRange>,
  sessionId: string,
  itemId: string,
  outputRef: string,
  limitBytes = PATCH_PREVIEW_LIMIT,
): Promise<string> {
  const parts: string[] = [];
  let offset = 0;
  while (offset < limitBytes) {
    const page = await readOutput(sessionId, itemId, outputRef, offset);
    if (page.encoding !== "utf8" || page.offsetBytes !== offset || (page.byteLen <= 0 && !page.eof)) {
      throw new Error("O patch retornado pelo Muse não pôde ser lido como texto completo.");
    }
    offset += page.byteLen;
    if (offset > limitBytes) {
      break;
    }
    parts.push(page.content);
    if (page.eof) {
      return parts.join("");
    }
  }
  throw new Error(`O patch excede o limite de ${Math.round(limitBytes / (1024 * 1024))} MB da visualização.`);
}
