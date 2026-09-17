import type { ProjectView, SessionSummary } from "../types.js";
import type { ThreadFold } from "./fold.js";

/** O que uma conversa precisa do usuário agora, do mais urgente para o menos. */
export type ThreadStatus = "approval" | "input" | "running" | "failed" | "unread" | "idle";

export const STATUS_PRIORITY: Record<ThreadStatus, number> = {
  approval: 0,
  input: 1,
  running: 2,
  failed: 3,
  unread: 4,
  idle: 5,
};

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  approval: "Precisa de aprovação",
  input: "Precisa da sua resposta",
  running: "Trabalhando",
  failed: "Falhou",
  unread: "Pronto, ainda não visto",
  idle: "Inativa",
};

export interface StatusContext {
  fold?: ThreadFold | null;
  /** Quando o usuário olhou esta conversa pela última vez (ISO). */
  lastSeen?: string | null;
  /** Atividade antes deste instante conta como vista; definido na primeira execução para o histórico antigo não ficar "não lido". */
  baseline: string;
  /** A conversa está aberta na tela. */
  active: boolean;
}

function later(a: string | null | undefined, b: string): string {
  return a && a > b ? a : b;
}

export function threadStatus(session: SessionSummary, ctx: StatusContext): ThreadStatus {
  const fold = ctx.fold ?? null;
  const approvals = fold ? Object.keys(fold.approvals).length : (session.live?.pendingApprovals ?? 0);
  if (approvals > 0) {
    return "approval";
  }
  const inputs = fold ? Object.keys(fold.userInputs).length : (session.live?.pendingInputs ?? 0);
  if (inputs > 0) {
    return "input";
  }
  const running = fold ? fold.activeTurnId !== null : Boolean(session.live?.activeTurnId);
  if (running) {
    return "running";
  }
  if (ctx.active) {
    return "idle";
  }
  if (session.activityAt > later(ctx.lastSeen, ctx.baseline)) {
    return session.live?.lastTerminal === "failed" ? "failed" : "unread";
  }
  return "idle";
}

export function isLive(status: ThreadStatus): boolean {
  return status === "approval" || status === "input" || status === "running";
}

export interface SidebarEntry {
  session: SessionSummary;
  status: ThreadStatus;
}

/** Conversas resolvidas saem da lista ativa, a não ser que voltem a ficar ocupadas antes de o servidor acompanhar. */
export function isSettled(entry: SidebarEntry): boolean {
  return entry.session.settled && !isLive(entry.status);
}

/**
 * Conversas ativas mantêm uma ordem estável, as mais novas primeiro pelo início ou pelo retorno.
 * A atividade nunca as reordena, como no T3 Code; a resolução e a resolução automática mantêm a lista curta.
 */
function activeOrder(a: SidebarEntry, b: SidebarEntry): number {
  const keyA = later(a.session.unsettledAt, a.session.createdAt);
  const keyB = later(b.session.unsettledAt, b.session.createdAt);
  return keyA < keyB ? 1 : keyA > keyB ? -1 : 0;
}

/** Conversas resolvidas, as resolvidas mais recentemente primeiro. */
function settledOrder(a: SidebarEntry, b: SidebarEntry): number {
  const keyA = a.session.settledAt ?? a.session.activityAt;
  const keyB = b.session.settledAt ?? b.session.activityAt;
  return keyA < keyB ? 1 : keyA > keyB ? -1 : 0;
}

export interface ProjectGroup {
  project: ProjectView;
  /** Conversas ativas, em sua ordem estável. */
  entries: SidebarEntry[];
  settled: SidebarEntry[];
  attention: number;
  running: number;
}

export function groupByProject(projects: ProjectView[], entries: SidebarEntry[]): ProjectGroup[] {
  const buckets = new Map<string, SidebarEntry[]>();
  for (const project of projects) {
    buckets.set(project.cwd, []);
  }
  for (const entry of entries) {
    buckets.get(entry.session.cwd)?.push(entry);
  }
  return projects.map((project) => {
    const all = buckets.get(project.cwd) ?? [];
    return {
      project,
      entries: all.filter((e) => !isSettled(e)).sort(activeOrder),
      settled: all.filter(isSettled).sort(settledOrder),
      attention: all.filter((e) => e.status === "approval" || e.status === "input").length,
      running: all.filter((e) => e.status === "running").length,
    };
  });
}

export type StatusGroupId = "attention" | "running" | "review" | "idle";

export interface StatusGroup {
  id: StatusGroupId;
  label: string;
  entries: SidebarEntry[];
}

const STATUS_GROUPS: { id: StatusGroupId; label: string; statuses: ThreadStatus[] }[] = [
  { id: "attention", label: "Precisam de você", statuses: ["approval", "input"] },
  { id: "running", label: "Trabalhando", statuses: ["running"] },
  { id: "review", label: "Prontas para revisar", statuses: ["failed", "unread"] },
  { id: "idle", label: "Inativas", statuses: ["idle"] },
];

/** Conversas ativas pelo que precisam; as resolvidas ficam para `settledEntries`. */
export function groupByStatus(entries: SidebarEntry[]): StatusGroup[] {
  const active = entries.filter((e) => !isSettled(e));
  return STATUS_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    entries: active
      .filter((e) => group.statuses.includes(e.status))
      .sort((a, b) => (a.status !== b.status ? STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] : activeOrder(a, b))),
  })).filter((group) => group.entries.length > 0);
}

export function settledEntries(entries: SidebarEntry[]): SidebarEntry[] {
  return entries.filter(isSettled).sort(settledOrder);
}
