import type { UsageBackfillStatus, UsageRecovery } from "../types.js";
import { plural, usageThreadTitle } from "./format.js";

/** What a row without a reason means: the total the Muse keeps is above the calls recorded. */
const UNSTATED_REASON = "O acumulado informa mais consumo do que as chamadas registradas.";

/**
 * Each reason the server gives, by how it begins: a short name for counts and one plain explanation.
 * Reasons may end with the Muse's own error in parentheses, so they are matched by prefix.
 */
const REASONS: { prefix: string; short: string; explanation: string | null }[] = [
  {
    prefix: "O acumulado disponível e as chamadas registradas divergem",
    short: "com total diferente das chamadas",
    explanation: "O total que o Muse guarda para a conversa não bate com as chamadas lidas. Só a parte que falta aparece abaixo.",
  },
  {
    prefix: "O histórico disponível não informa as chamadas",
    short: "sem as chamadas no histórico",
    explanation: "O Muse não devolveu as chamadas ao modelo destas conversas, nem um total para comparar.",
  },
  {
    prefix: "Não foi possível ler todas as chamadas do histórico",
    short: "com falha ao ler o histórico",
    explanation: "O Muse recusou ou interrompeu a leitura do histórico. Recuperar uso de novo pode resolver; entre parênteses, a resposta do Muse.",
  },
  {
    prefix: "Não foi possível ler o consumo desta conversa",
    short: "com falha ao ler a conversa",
    explanation: "Nem o histórico nem o resumo destas conversas puderam ser lidos.",
  },
  {
    prefix: "Só o consumo acumulado está disponível",
    short: "só com o total",
    explanation: "O Muse guarda só o total, por exemplo depois de compactar o histórico; as chamadas uma a uma não existem mais.",
  },
  { prefix: "Limite de páginas atingido", short: "longas demais", explanation: "Histórico longo demais: a leitura para em 100 páginas." },
  {
    prefix: "A abertura mostrou apenas parte do histórico",
    short: "lidas só em parte ao abrir",
    explanation: "Abrir uma conversa lê só as páginas mais recentes. Recuperar uso lê o histórico inteiro.",
  },
  {
    prefix: "Há chamadas sem identificação confiável",
    short: "com chamadas sem identificação",
    explanation: "Algumas chamadas vieram sem uma identificação estável e ficaram de fora, para não contar a mesma duas vezes.",
  },
  { prefix: "Outro processo do Muse", short: "abertas em outro processo do Muse", explanation: null },
];

function reasonInfo(reason: string): { short: string; explanation: string | null } {
  const known = REASONS.find((entry) => reason.startsWith(entry.prefix));
  return known ?? { short: "por outro motivo", explanation: null };
}

export function backfillDetail(status: UsageBackfillStatus | null): string {
  if (!status) return "Relê o consumo disponível das conversas guardadas, inclusive excluídas e as usadas só no CLI. Não reabre nem altera conversas.";
  if (status.running) return `Lendo ${status.done} de ${plural(status.total, "conversa", "conversas")}… ${plural(status.calls, "chamada nova recuperada", "chamadas novas recuperadas")}.`;
  if (status.error) return `Parou com erro: ${status.error}`;
  const partial = (status.incomplete ?? 0) > 0 || status.failed > 0 || status.enumerationIncomplete;
  const why = Object.entries(status.reasons ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reasonInfo(reason).short}`);
  return `${partial ? "Recuperação parcial" : "Concluído"}: ${plural(status.done, "conversa", "conversas")}, ${plural(status.calls, "chamada nova recuperada", "chamadas novas recuperadas")}${status.incomplete ? `, ${status.incomplete} com leitura incompleta${why.length ? ` (${why.join(", ")})` : ""}` : ""}${status.failed ? `, ${status.failed} com falha de leitura` : ""}${status.skipped ? `, ${plural(status.skipped, "registro sem identificação confiável", "registros sem identificação confiável")}` : ""}.${status.enumerationIncomplete ? " A lista de conversas não pôde ser lida por inteiro." : ""} Veja os dados disponíveis e os limites na página de Uso.`;
}

/** Missing snapshot tokens are disclosed, never converted to priced calls or assigned to a day. */
export function recoveryGap(row: Pick<UsageRecovery, "promptTokens" | "outputTokens" | "recordedPromptTokens" | "recordedOutputTokens">): { promptTokens: number | null; outputTokens: number | null } {
  return {
    promptTokens: row.promptTokens === null ? null : Math.max(0, row.promptTokens - row.recordedPromptTokens),
    outputTokens: row.outputTokens === null ? null : Math.max(0, row.outputTokens - row.recordedOutputTokens),
  };
}

/** The name a conversation is listed by: its title here, or a short id for one this app never opened. */
export function recoveryTitle(row: Pick<UsageRecovery, "sessionId" | "title" | "deleted">): string {
  if (row.deleted) return usageThreadTitle({ title: null, deleted: true });
  if (row.title) return usageThreadTitle({ title: row.title, deleted: false });
  return `Conversa ${row.sessionId.slice(0, 8)}, não aberta no Helicon`;
}

export interface RecoveryEntry {
  sessionId: string;
  title: string;
  /** Tokens the conversation's own total has beyond the recorded calls; null when it has no total. */
  promptTokens: number | null;
  outputTokens: number | null;
}

export interface RecoveryGroup {
  reason: string;
  explanation: string | null;
  /** Every conversation with this reason, listed or not. */
  count: number;
  /** The ones worth listing: a gap to show, or no total to compare with. */
  entries: RecoveryEntry[];
  /** Conversations whose total and recorded calls leave nothing missing: counted, not listed. */
  noDifference: number;
  /** Conversations without a total to compare with. */
  noTotal: number;
  promptTokens: number;
  outputTokens: number;
}

/**
 * The incomplete readings grouped by reason, most frequent first, each conversation named. Entries whose
 * gap is zero add nothing to read and only count. The gap sums stay what they were per row: never priced.
 */
export function groupRecovery(rows: readonly UsageRecovery[]): RecoveryGroup[] {
  const groups = new Map<string, RecoveryGroup>();
  for (const row of rows) {
    const reason = row.reason ?? UNSTATED_REASON;
    const group = groups.get(reason) ?? {
      reason,
      explanation: row.reason === null ? null : reasonInfo(reason).explanation,
      count: 0,
      entries: [],
      noDifference: 0,
      noTotal: 0,
      promptTokens: 0,
      outputTokens: 0,
    };
    group.count += 1;
    const gap = recoveryGap(row);
    if (gap.promptTokens === null || gap.outputTokens === null) {
      group.noTotal += 1;
      group.entries.push({ sessionId: row.sessionId, title: recoveryTitle(row), promptTokens: null, outputTokens: null });
    } else if (gap.promptTokens === 0 && gap.outputTokens === 0) {
      group.noDifference += 1;
    } else {
      group.promptTokens += gap.promptTokens;
      group.outputTokens += gap.outputTokens;
      group.entries.push({ sessionId: row.sessionId, title: recoveryTitle(row), promptTokens: gap.promptTokens, outputTokens: gap.outputTokens });
    }
    groups.set(reason, group);
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => (b.promptTokens ?? -1) + (b.outputTokens ?? 0) - ((a.promptTokens ?? -1) + (a.outputTokens ?? 0)) || a.title.localeCompare(b.title));
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
