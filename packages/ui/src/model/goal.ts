import type { ThreadFold } from "./fold.js";

/**
 * A meta de uma conversa, o jeito de o Muse seguir perseguindo um objetivo entre mensagens. O Muse informa o bloco
 * de meta ao vivo (`session/goalChanged`: objetivo, status, porcentagem, trabalho atual e seguinte); suas ferramentas
 * de meta devolvem o registro completo, com quando começou, sua contagem de tokens e orçamento. O Helicon soma o que
 * nenhum dos dois diz direto: há quanto tempo executa, e quantas mensagens e tokens seu trabalho levou.
 */

/** O registro completo de meta do Muse, da saída de suas ferramentas de meta. */
export interface GoalRecord {
  goalId: string | null;
  objective: string;
  status: string;
  percentComplete: number;
  currentWork: string | null;
  nextWork: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  lastProgressAt: number | null;
  /** A contagem do próprio Muse, atualizada quando uma ferramenta de meta executa. */
  tokensUsed: number | null;
  tokenBudget: number | null;
}

/** As ferramentas de meta do modelo; cada uma devolve o registro inteiro como `{"goal": {...}}`. */
export const GOAL_TOOLS: ReadonlySet<string> = new Set(["create_goal", "update_goal", "report_progress", "get_goal"]);

export type GoalTone = "active" | "paused" | "done" | "attention" | "ended";

const STATUS: Record<string, { label: string; tone: GoalTone }> = {
  active: { label: "Em andamento", tone: "active" },
  paused: { label: "Pausada", tone: "paused" },
  complete: { label: "Concluída", tone: "done" },
  blocked: { label: "Bloqueada", tone: "attention" },
  budget_limited: { label: "Sem orçamento", tone: "attention" },
  usage_limited: { label: "Limite de uso atingido", tone: "attention" },
  cleared: { label: "Apagada", tone: "ended" },
  cancelled: { label: "Cancelada", tone: "ended" },
  superseded: { label: "Substituída", tone: "ended" },
  abandoned: { label: "Abandonada", tone: "ended" },
};

export interface GoalView {
  objective: string;
  status: string;
  label: string;
  tone: GoalTone;
  /** Limitada de 0 a 100; o Muse deixa passar valores maiores. */
  percent: number;
  currentWork: string | null;
  nextWork: string | null;
  startedAt: number | null;
  /** Quando o relógio parou, para uma meta que não está mais em andamento. */
  endedAt: number | null;
  /** Tempo que passou pausada ou bloqueada antes de retomar pela última vez, que não é tempo executando. */
  pausedMs: number;
  lastProgressAt: number | null;
  /** Mensagens que trabalharam pela meta. */
  turns: number;
  /** Essas mesmas mensagens por id, para a meta ser precificada exatamente sobre o trabalho que sua contagem de tokens cobre. */
  turnIds: string[];
  /** Tokens de entrada mais saída das chamadas ao modelo dessas mensagens. */
  tokens: number;
  tokenBudget: number | null;
  /** A contagem de tokens do próprio Muse para a meta, na sua última chamada de ferramenta de meta. */
  tokensUsed: number | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Interpreta a saída de uma ferramenta de meta. Nulo quando não é um registro de meta, como numa chamada falha ou cortada. */
export function parseGoalRecord(output: string | undefined): GoalRecord | null {
  if (!output) {
    return null;
  }
  let root: unknown;
  try {
    root = JSON.parse(output);
  } catch {
    return null;
  }
  const goal = root && typeof root === "object" ? (root as Record<string, unknown>)["goal"] : null;
  if (!goal || typeof goal !== "object") {
    return null;
  }
  const g = goal as Record<string, unknown>;
  const objective = text(g["objective"]);
  if (!objective) {
    return null;
  }
  return {
    goalId: text(g["goal_id"]),
    objective,
    status: text(g["status"]) ?? "active",
    percentComplete: num(g["percent_complete"]) ?? 0,
    currentWork: text(g["current_work"]),
    nextWork: text(g["next_work"]),
    createdAt: num(g["created_at_ms"]),
    updatedAt: num(g["updated_at_ms"]),
    lastProgressAt: num(g["last_progress_at_ms"]),
    tokensUsed: num(g["tokens_used"]),
    tokenBudget: num(g["token_budget"]),
  };
}

/** O registro de meta mais novo na conversa, com a mensagem cuja chamada de ferramenta o devolveu. */
export function latestGoalRecord(fold: ThreadFold): { record: GoalRecord; turnId: string | null } | null {
  for (let index = fold.order.length - 1; index >= 0; index -= 1) {
    const item = fold.items[fold.order[index] as string];
    if (item?.kind === "toolCall" && item.tool && GOAL_TOOLS.has(item.tool) && item.status === "completed") {
      const record = parseGoalRecord(item.visibleOutput);
      if (record) {
        return { record, turnId: item.turnId ?? null };
      }
    }
  }
  return null;
}

export function statusLabel(status: string): { label: string; tone: GoalTone } {
  const known = STATUS[status];
  if (known) {
    return known;
  }
  const words = status.replace(/[_-]+/g, " ").trim();
  return { label: words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Desconhecida", tone: "paused" };
}

/** Mensagens com trabalho registrado enquanto a meta executou: de `start` a `end`, fora de suas pausas, mais a mensagem que a definiu. */
function goalTurns(fold: ThreadFold, start: number, end: number | null, setIn: string | null): Set<string> {
  const turns = new Set<string>();
  if (setIn) {
    turns.add(setIn);
  }
  const pauses = fold.meta.goalPauses;
  const paused = (at: number) => pauses.some((p) => at > p.from && at < (p.to ?? Number.POSITIVE_INFINITY));
  const inside = (at: number) => at >= start && (end === null || at <= end) && !paused(at);
  for (const id of fold.order) {
    const item = fold.items[id];
    const at = item?.recordedAt ? Date.parse(item.recordedAt) : Number.NaN;
    if (item?.turnId && !Number.isNaN(at) && inside(at)) {
      turns.add(item.turnId);
    }
  }
  // Uma mensagem ao vivo pode ainda não ter um item registrado.
  for (const info of Object.values(fold.turns)) {
    if (info.startedAt !== undefined && inside(info.startedAt)) {
      turns.add(info.turnId);
    }
  }
  return turns;
}

/**
 * Tudo que o painel de meta mostra, ou nulo quando a conversa não tem meta. O bloco ao vivo vence para status
 * e progresso; o registro, quando descreve o mesmo objetivo, fornece tempos, orçamento e a contagem do Muse.
 */
export function goalView(fold: ThreadFold): GoalView | null {
  const block = fold.meta.goal;
  const latest = latestGoalRecord(fold);
  // Uma meta que o Muse apagou fica apagada, mesmo que um registro de ferramenta mais antigo ainda a descreva.
  if (!block && (fold.meta.goalSeen || !latest)) {
    return null;
  }
  const objective = block?.objective ?? latest?.record.objective ?? "";
  const record = latest && latest.record.objective === objective ? latest.record : null;
  const status = block?.status ?? record?.status ?? "active";
  const { label, tone } = statusLabel(status);
  const startedAt = record?.createdAt ?? fold.meta.goalSince;
  // O relógio para quando o status mudou pela última vez: visto ao vivo, ou a atualização do próprio registro quando descreve este status.
  const endedAt = tone === "active" ? null : (fold.meta.goalStatusAt ?? (record && record.status === status ? record.updatedAt : null));
  const turns = startedAt === null ? new Set<string>() : goalTurns(fold, startedAt, endedAt, record ? latest?.turnId ?? null : null);
  let tokens = 0;
  for (const call of Object.values(fold.meta.calls)) {
    if (call.turnId && turns.has(call.turnId)) {
      tokens += call.promptTokens + call.outputTokens;
    }
  }
  const percent = block?.percentComplete ?? record?.percentComplete ?? 0;
  return {
    objective,
    status,
    label,
    tone,
    percent: Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)),
    currentWork: block?.currentWork ?? record?.currentWork ?? null,
    nextWork: block?.nextWork ?? record?.nextWork ?? null,
    startedAt,
    endedAt,
    pausedMs: fold.meta.goalPauses.reduce((total, p) => total + (p.to === null ? 0 : Math.max(0, p.to - p.from)), 0),
    lastProgressAt: record?.lastProgressAt ?? null,
    turns: turns.size,
    turnIds: [...turns],
    tokens,
    tokenBudget: record?.tokenBudget ?? null,
    tokensUsed: record?.tokensUsed ?? null,
  };
}

/** O que `/goal <objetivo>` envia: a UI de terminal do Muse define metas sozinha, uma sessão servida pede ao modelo. */
export function goalPrompt(objective: string): string {
  return `Create a goal with your create_goal tool. Objective: ${objective.trim()}\nThen work toward it until it is complete.`;
}
