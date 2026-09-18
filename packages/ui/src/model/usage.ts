import type { ContextUsage, ModelOption, MspItem } from "../types.js";
import { HIDDEN_KINDS, type CallUsage, type ThreadFold, type TurnInfo } from "./fold.js";
import { diffStats, extractDiff } from "./format.js";

/**
 * Uso de contexto e de sessão para o painel de contexto do composer. O Muse informa o total de contexto,
 * as contagens de tokens de cada chamada ao modelo e os preços do catálogo; como o contexto se divide entre
 * prompts, respostas e saída de ferramentas é estimado aqui a partir do texto da própria conversa.
 */

/** Cerca de quatro caracteres por token para inglês e código. Só alimenta a divisão estimada. */
const CHARS_PER_TOKEN = 4;

export type SliceKey = "prompts" | "replies" | "tools" | "subagents" | "summary" | "system";

export interface ContextSlice {
  key: SliceKey;
  label: string;
  tokens: number;
}

export interface ContextBreakdown {
  /** A contagem própria do Muse dos tokens no contexto. */
  used: number;
  window: number | null;
  pressure: string;
  /** Como `used` se divide, numa ordem fixa para a barra manter suas cores conforme cresce. */
  slices: ContextSlice[];
  free: number | null;
}

const SLICE_LABELS: Record<SliceKey, string> = {
  prompts: "Suas mensagens",
  replies: "Respostas do Muse",
  tools: "Chamadas e resultados de ferramentas",
  subagents: "Resultados de subagentes",
  summary: "Resumo compactado",
  system: "Prompt de sistema e ferramentas",
};

function estimate(text: string | null | undefined): number {
  return text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;
}

/** Os itens ainda no contexto do modelo: tudo depois da última compactação instalada. */
function inContext(fold: ThreadFold): { items: MspItem[]; summary: MspItem | null } {
  let start = 0;
  let summary: MspItem | null = null;
  fold.order.forEach((id, index) => {
    const item = fold.items[id];
    if (item?.kind === "compaction" && item.outcome === "compacted") {
      start = index + 1;
      summary = item;
    }
  });
  const items: MspItem[] = [];
  for (const id of fold.order.slice(start)) {
    const item = fold.items[id];
    if (item && !HIDDEN_KINDS.has(item.kind) && !item.retracted) {
      items.push(item);
    }
  }
  return { items, summary };
}

/**
 * A leitura de contexto a mostrar. Streams ao vivo a informam direto; uma conversa aberta do histórico
 * só tem suas chamadas ao modelo, então a ocupação da última chamada a substitui, dimensionada pelo limite do modelo.
 */
export function contextUsageOf(fold: ThreadFold, models: readonly ModelOption[]): ContextUsage | null {
  if (fold.meta.contextUsage) {
    return fold.meta.contextUsage;
  }
  const calls = Object.values(fold.meta.calls);
  const last = calls[calls.length - 1];
  if (!last) {
    return null;
  }
  const modelId = last.modelId ?? fold.meta.modelId;
  const window = models.find((m) => m.modelId === modelId)?.contextLimit ?? undefined;
  return { usedTokens: last.promptTokens + last.outputTokens, windowTokens: window, pressure: "normal" };
}

export function contextBreakdown(fold: ThreadFold, models: readonly ModelOption[]): ContextBreakdown | null {
  const usage = contextUsageOf(fold, models);
  if (!usage) {
    return null;
  }
  const { items, summary } = inContext(fold);
  const raw: Record<Exclude<SliceKey, "system">, number> = {
    prompts: 0,
    replies: 0,
    tools: 0,
    subagents: 0,
    summary: summary?.tokensAfter ?? 0,
  };
  for (const item of items) {
    if (item.kind === "userMessage") {
      raw.prompts += estimate(item.displayText ?? item.text);
    } else if (item.kind === "agentMessage") {
      raw.replies += estimate(item.text);
    } else if (item.kind === "toolCall") {
      raw.tools += estimate(item.args) + estimate(item.visibleOutput);
    } else if (item.kind === "userShell") {
      raw.tools += estimate(item.commandText) + estimate(item.visibleOutput);
    } else if (item.kind === "subagent") {
      raw.subagents += estimate(item.result?.summary ?? item.result?.text ?? item.objective);
    }
  }
  const used = usage.usedTokens;
  const counted = Object.values(raw).reduce((total, value) => total + value, 0);
  // A estimativa pode passar do que o Muse contou (texto que o modelo nunca viu por inteiro); encolha para caber.
  const scale = counted > used && counted > 0 ? used / counted : 1;
  const slices: ContextSlice[] = [];
  let explained = 0;
  for (const key of ["prompts", "replies", "tools", "subagents", "summary"] as const) {
    const tokens = Math.round(raw[key] * scale);
    if (tokens > 0) {
      slices.push({ key, label: SLICE_LABELS[key], tokens });
      explained += tokens;
    }
  }
  // O que o texto da conversa não explica é o prompt de sistema, definições de ferramentas e memória.
  const system = Math.max(0, used - explained);
  if (system > 0) {
    slices.push({ key: "system", label: SLICE_LABELS.system, tokens: system });
  }
  const window = usage.windowTokens ?? null;
  return { used, window, pressure: usage.pressure, slices, free: window === null ? null : Math.max(0, window - used) };
}

/** Chamadas com tão poucos tokens de saída não dizem nada sobre velocidade, como no gateway do opencode. */
const MIN_SPEED_TOKENS = 10;
/** Janelas de geração mais curtas são barulhentas demais para informar. */
const MIN_SPEED_MS = 100;

export interface TurnSpeed {
  tokensPerSecond: number;
  outputTokens: number;
  generationMs: number;
}

/**
 * A velocidade de saída de uma mensagem terminada, medida como o gateway do opencode mede cada chamada ao modelo:
 * tokens de saída (raciocínio incluído, como o Muse conta) sobre o tempo que o modelo gastou produzindo-
 * os, ignorando chamadas de dez tokens ou menos. O tempo é o tempo de relógio de cada chamada contada, então
 * execuções de ferramentas entre chamadas nunca contam. O tempo do Muse até o primeiro token não pode ser descontado: ele vai
 * do início da mensagem até seu primeiro texto visível, através de chamadas e execuções de ferramentas, não por chamada.
 */
export function turnSpeed(fold: ThreadFold, turnId: string): TurnSpeed | null {
  let tokens = 0;
  let generation = 0;
  for (const call of Object.values(fold.meta.calls)) {
    if (call.turnId === turnId && call.outputTokens > MIN_SPEED_TOKENS && (call.durationMs ?? 0) > 0) {
      tokens += call.outputTokens;
      generation += call.durationMs ?? 0;
    }
  }
  if (tokens === 0 || generation < MIN_SPEED_MS) {
    return null;
  }
  return { tokensPerSecond: (tokens / generation) * 1000, outputTokens: tokens, generationMs: generation };
}

/** A velocidade de cada mensagem terminada, por id da mensagem. */
export function turnSpeeds(fold: ThreadFold): Record<string, TurnSpeed> {
  const speeds: Record<string, TurnSpeed> = {};
  for (const turnId of new Set(Object.values(fold.meta.calls).map((call) => call.turnId))) {
    if (turnId && turnId !== fold.activeTurnId) {
      const speed = turnSpeed(fold, turnId);
      if (speed) {
        speeds[turnId] = speed;
      }
    }
  }
  return speeds;
}

/** A mensagem terminada mais recente que tem uma velocidade. */
export function lastTurnSpeed(fold: ThreadFold): TurnSpeed | null {
  const calls = Object.values(fold.meta.calls);
  const seen = new Set<string>();
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const turnId = calls[index]?.turnId;
    if (!turnId || seen.has(turnId) || turnId === fold.activeTurnId) {
      continue;
    }
    seen.add(turnId);
    const speed = turnSpeed(fold, turnId);
    if (speed) {
      return speed;
    }
  }
  return null;
}

export interface TurnCost {
  cost: number;
  currency: string | null;
  /** Falso quando uma chamada rodou num modelo sem preço listado, então o total subconta. */
  complete: boolean;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** Quanto uma mensagem teria custado nas tarifas de API, a partir das chamadas que fez. */
export function turnCost(fold: ThreadFold, turnId: string, models: readonly ModelOption[]): TurnCost | null {
  let cost = 0;
  let priced = 0;
  let calls = 0;
  let promptTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let currency: string | null = null;
  for (const call of Object.values(fold.meta.calls)) {
    if (call.turnId !== turnId) {
      continue;
    }
    calls += 1;
    const cached = cacheReads(call);
    promptTokens += call.promptTokens;
    cachedTokens += cached;
    outputTokens += call.outputTokens;
    reasoningTokens += call.reasoningTokens;
    const price = models.find((m) => m.modelId === call.modelId)?.cost ?? null;
    if (price) {
      cost += ((call.promptTokens - cached) * price.input + cached * price.cached + call.outputTokens * price.output) / 1_000_000;
      priced += 1;
      currency = currency ?? price.currency;
    }
  }
  if (calls === 0) {
    return null;
  }
  return { cost, currency, complete: priced === calls, promptTokens, cachedTokens, outputTokens, reasoningTokens };
}

/** O custo de cada mensagem, por id da mensagem. */
export function turnCosts(fold: ThreadFold, models: readonly ModelOption[]): Record<string, TurnCost> {
  const costs: Record<string, TurnCost> = {};
  for (const turnId of new Set(Object.values(fold.meta.calls).map((call) => call.turnId))) {
    if (!turnId) {
      continue;
    }
    const cost = turnCost(fold, turnId, models);
    if (cost) {
      costs[turnId] = cost;
    }
  }
  return costs;
}

/** Uma velocidade ao vivo aproximada para o texto chegando agora: caracteres sobre quatro, por segundo da rajada. */
export function streamingSpeed(info: TurnInfo | null | undefined): number | null {
  const stream = info?.stream;
  if (!stream) {
    return null;
  }
  const ms = stream.lastAt - stream.startAt;
  const tokens = stream.chars / CHARS_PER_TOKEN;
  if (ms < 500 || tokens <= MIN_SPEED_TOKENS) {
    return null;
  }
  return (tokens / ms) * 1000;
}

export interface ModelUsage {
  modelId: string;
  calls: number;
  promptTokens: number;
  outputTokens: number;
  /** Nulo quando o catálogo não lista preço para este modelo. */
  cost: number | null;
}

export interface ToolUsage {
  tool: string;
  calls: number;
  /** Estimado a partir dos argumentos e da saída visível da chamada. */
  tokens: number;
}

export interface SubagentUsage {
  itemId: string;
  label: string;
  tokens: number;
}

export interface CompactionRecord {
  itemId: string;
  trigger: string | null;
  outcome: string | null;
  before: number | null;
  after: number | null;
}

export interface SessionUsage {
  calls: number;
  /** Totais da sessão contados uma vez, como o Muse os informa. */
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Contadores brutos por chamada, somados. */
  inputTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** Fração dos tokens de prompt servidos do cache do provedor; nulo antes de qualquer chamada. */
  cacheHit: number | null;
  modelMs: number;
  models: ModelUsage[];
  /** Estimado a partir dos preços do catálogo; nulo quando nenhum modelo usado aqui lista um. */
  cost: number | null;
  currency: string | null;
  /** Falso quando algumas chamadas rodaram num modelo sem preço, então `cost` subconta. */
  costComplete: boolean;
  lines: { added: number; removed: number; files: number };
  turns: number;
  workedMs: number;
  firstTokenMs: number | null;
  tools: ToolUsage[];
  subagents: SubagentUsage[];
  compactions: CompactionRecord[];
}

/** Tokens de prompt em cache para uma chamada, qualquer que seja o contador que o provedor preenche. */
function cacheReads(call: CallUsage): number {
  return Math.min(call.promptTokens, call.cacheReadTokens || call.cachedTokens);
}

export function sessionUsage(fold: ThreadFold, models: readonly ModelOption[]): SessionUsage {
  const calls = Object.values(fold.meta.calls);
  const sum = (pick: (call: CallUsage) => number) => calls.reduce((total, call) => total + pick(call), 0);
  const perCallPrompt = sum((c) => c.promptTokens);

  const byModel = new Map<string, ModelUsage>();
  let cost = 0;
  let priced = 0;
  let currency: string | null = null;
  for (const call of calls) {
    const id = call.modelId ?? "desconhecido";
    const entry = byModel.get(id) ?? { modelId: id, calls: 0, promptTokens: 0, outputTokens: 0, cost: null };
    entry.calls += 1;
    entry.promptTokens += call.promptTokens;
    entry.outputTokens += call.outputTokens;
    const price = models.find((m) => m.modelId === call.modelId)?.cost ?? null;
    if (price) {
      const cached = cacheReads(call);
      const callCost = ((call.promptTokens - cached) * price.input + cached * price.cached + call.outputTokens * price.output) / 1_000_000;
      entry.cost = (entry.cost ?? 0) + callCost;
      cost += callCost;
      priced += 1;
      currency = currency ?? price.currency;
    }
    byModel.set(id, entry);
  }

  let added = 0;
  let removed = 0;
  const files = new Set<string>();
  const tools = new Map<string, ToolUsage>();
  const subagents: SubagentUsage[] = [];
  const compactions: CompactionRecord[] = [];
  for (const id of fold.order) {
    const item = fold.items[id];
    if (!item) {
      continue;
    }
    if (item.kind === "toolCall") {
      const diff = extractDiff(item);
      if (diff) {
        const stats = diffStats(diff);
        added += stats.added;
        removed += stats.removed;
        files.add(diff.path ?? item.itemId);
      }
      const name = item.tool ?? "ferramenta";
      const entry = tools.get(name) ?? { tool: name, calls: 0, tokens: 0 };
      entry.calls += 1;
      entry.tokens += estimate(item.args) + estimate(item.visibleOutput);
      tools.set(name, entry);
    } else if (item.kind === "subagent" && item.usage) {
      const tokens = (item.usage.inputTokens ?? 0) + (item.usage.outputTokens ?? 0);
      subagents.push({ itemId: item.itemId, label: item.role ?? item.objective ?? "Subagente", tokens });
    } else if (item.kind === "compaction" && item.status !== "inProgress") {
      compactions.push({
        itemId: item.itemId,
        trigger: item.trigger ?? null,
        outcome: item.outcome ?? null,
        before: item.tokensBefore ?? null,
        after: item.tokensAfter ?? null,
      });
    }
  }

  const turns = Object.values(fold.turns).filter((turn) => turn.terminal);
  const firstTokens = turns.map((turn) => turn.firstTokenMs).filter((ms): ms is number => typeof ms === "number");
  const totals = fold.meta.tokenTotals;
  return {
    calls: calls.length,
    promptTokens: totals?.promptTokens ?? perCallPrompt,
    outputTokens: totals?.outputTokens ?? sum((c) => c.outputTokens),
    totalTokens: totals?.totalTokens ?? perCallPrompt + sum((c) => c.outputTokens),
    inputTokens: sum((c) => c.inputTokens),
    cachedTokens: sum((c) => c.cachedTokens),
    cacheReadTokens: sum((c) => c.cacheReadTokens),
    cacheWriteTokens: sum((c) => c.cacheWriteTokens),
    reasoningTokens: sum((c) => c.reasoningTokens),
    cacheHit: perCallPrompt > 0 ? sum(cacheReads) / perCallPrompt : null,
    modelMs: sum((c) => c.durationMs ?? 0),
    models: [...byModel.values()].sort((a, b) => b.promptTokens + b.outputTokens - (a.promptTokens + a.outputTokens)),
    cost: priced > 0 ? cost : null,
    currency,
    costComplete: priced === calls.length,
    lines: { added, removed, files: files.size },
    turns: turns.length,
    workedMs: turns.reduce((total, turn) => total + (turn.durationMs ?? 0), 0),
    firstTokenMs: firstTokens.length > 0 ? firstTokens.reduce((a, b) => a + b, 0) / firstTokens.length : null,
    tools: [...tools.values()].sort((a, b) => b.tokens - a.tokens),
    subagents: subagents.sort((a, b) => b.tokens - a.tokens),
    compactions,
  };
}
