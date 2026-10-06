import type { UsageBackfillStatus, UsageRecovery } from "../types.js";
import { plural, usageThreadTitle } from "./format.js";

/** What a row without a reason means: the total the Muse keeps is above the calls recorded. */
const UNSTATED_REASON = "O acumulado informa mais consumo do que as chamadas registradas.";

/**
 * Each reason the server gives, by how it begins: a short name for counts and one plain explanation.
 * Reasons may end with the Muse's own error in parentheses, so they are matched by prefix.
 */
const REASONS: { prefix: string; short: string; explanation: string | null; failure?: string }[] = [
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
    explanation: "O Muse recusou ou interrompeu a leitura do histórico. Recuperar uso de novo pode resolver.",
    failure: "ao ler o histórico",
  },
  {
    prefix: "Não foi possível ler o consumo desta conversa",
    short: "com falha ao ler a conversa",
    explanation: "Nem o histórico nem o resumo destas conversas puderam ser lidos.",
    failure: "ao ler a conversa",
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

/**
 * An internal error from the Muse is not a busy host: the server already retried it, and it keeps coming back for
 * the same conversations (mostly deleted or very old ones), so suggesting another recovery would only mislead.
 */
const INTERNAL_EXPLANATION =
  "O Muse respondeu com um erro interno ao ler estas conversas, o que costuma acontecer com conversas excluídas ou muito antigas. Recuperar uso de novo em geral não resolve. O restante do uso não é afetado.";

/** The Muse's own error kind, which the server appends as "(o Muse respondeu kind)". */
function museKind(reason: string): string | null {
  return /\(o Muse respondeu ([^)]+)\)/.exec(reason)?.[1]?.trim() ?? null;
}

function reasonInfo(reason: string): { short: string; explanation: string | null; failure: string | null } {
  const known = REASONS.find((entry) => reason.startsWith(entry.prefix));
  if (!known) return { short: "por outro motivo", explanation: null, failure: null };
  const kind = museKind(reason);
  if (known.failure && kind === "internal") return { short: known.short, explanation: INTERNAL_EXPLANATION, failure: known.failure };
  const explanation = known.failure && kind ? `${known.explanation} Entre parênteses, a resposta do Muse.` : known.explanation;
  return { short: known.short, explanation, failure: known.failure ?? null };
}

/** "a", "a e b", "a, b e c". */
function joinList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/**
 * Why the incomplete readings stayed so, each conversation counted once. The server counts a conversation as
 * `failed` only when it also counts it as incomplete with a read-failure reason, so the failures are told as part of
 * the incomplete ones, never added again beside them.
 */
function incompleteBreakdown(reasons: Record<string, number>): string[] {
  const failures = new Map<string, number>();
  const others = new Map<string, number>();
  for (const [reason, count] of Object.entries(reasons)) {
    const info = reasonInfo(reason);
    const into = info.failure ? failures : others;
    const key = info.failure ?? info.short;
    into.set(key, (into.get(key) ?? 0) + count);
  }
  const parts: { count: number; text: string }[] = [...others].map(([short, count]) => ({ count, text: `${count} ${short}` }));
  const failed = [...failures.values()].reduce((sum, count) => sum + count, 0);
  if (failed > 0) {
    const where = [...failures].sort((a, b) => b[1] - a[1]);
    const text = where.length === 1
      ? `${failed} com falha ${where[0]![0]}`
      : `${failed} com falha de leitura (${joinList(where.map(([place, count]) => `${count} ${place}`))})`;
    parts.push({ count: failed, text });
  }
  return parts.sort((a, b) => b.count - a.count).map((part) => part.text);
}

export function backfillDetail(status: UsageBackfillStatus | null): string {
  if (!status) return "Relê o consumo disponível das conversas guardadas, inclusive excluídas e as usadas só no CLI. Não reabre nem altera conversas.";
  if (status.running) return `Lendo ${status.done} de ${plural(status.total, "conversa", "conversas")}… ${plural(status.calls, "chamada nova recuperada", "chamadas novas recuperadas")}.`;
  if (status.error) return `Parou com erro: ${status.error}`;
  const incomplete = status.incomplete ?? 0;
  const partial = incomplete > 0 || status.failed > 0 || status.enumerationIncomplete;
  const sentences = [
    `${partial ? "Recuperação parcial" : "Concluído"}: ${plural(status.done, "conversa lida", "conversas lidas")}, ${plural(status.calls, "chamada nova recuperada", "chamadas novas recuperadas")}.`,
  ];
  if (incomplete > 0) {
    const why = incompleteBreakdown(status.reasons ?? {});
    sentences.push(`${incomplete} com leitura incompleta${why.length ? `: ${joinList(why)}` : ""}.`);
  } else if (status.failed > 0) {
    // Not expected (a failed reading is always incomplete), but never hidden if it happens.
    sentences.push(`${status.failed} com falha de leitura.`);
  }
  if (status.skipped) sentences.push(`${plural(status.skipped, "registro sem identificação confiável", "registros sem identificação confiável")}.`);
  if (status.enumerationIncomplete) sentences.push("A lista de conversas não pôde ser lida por inteiro.");
  sentences.push("Veja os dados disponíveis e os limites na página de Uso.");
  return sentences.join(" ");
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
