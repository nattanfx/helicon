import type { UsageBackfillStatus, UsageReport } from "../types.js";

export function backfillDetail(status: UsageBackfillStatus | null): string {
  if (!status) return "Relê o consumo disponível das conversas guardadas, inclusive excluídas e as usadas só no CLI. Não reabre nem altera conversas.";
  if (status.running) return `Lendo ${status.done} de ${status.total} conversas… ${status.calls} chamadas novas recuperadas.`;
  if (status.error) return `Parou com erro: ${status.error}`;
  const partial = (status.incomplete ?? 0) > 0 || status.failed > 0 || status.enumerationIncomplete;
  return `${partial ? "Recuperação parcial" : "Concluído"}: ${status.done} conversas, ${status.calls} chamadas novas recuperadas${status.incomplete ? `, ${status.incomplete} com leitura incompleta` : ""}${status.failed ? `, ${status.failed} com falha de leitura` : ""}${status.skipped ? `, ${status.skipped} registros sem identificação confiável` : ""}.${status.enumerationIncomplete ? " A lista de conversas não pôde ser lida por inteiro." : ""} Veja os dados disponíveis e os limites na página de Uso.`;
}

/** Missing snapshot tokens are disclosed, never converted to priced calls or assigned to a day. */
export function recoveryGap(row: NonNullable<UsageReport["recovery"]>[number]): { promptTokens: number | null; outputTokens: number | null } {
  return {
    promptTokens: row.promptTokens === null ? null : Math.max(0, row.promptTokens - row.recordedPromptTokens),
    outputTokens: row.outputTokens === null ? null : Math.max(0, row.outputTokens - row.recordedOutputTokens),
  };
}
