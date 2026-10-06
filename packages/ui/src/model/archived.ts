import { basename, displayTitle, plural } from "./format.js";
import type { ProjectView, SessionSummary } from "../types.js";

export interface ArchivedGroup {
  cwd: string;
  name: string;
  sessions: SessionSummary[];
}

function byActivityDesc(a: SessionSummary, b: SessionSummary): number {
  if (a.activityAt !== b.activityAt) {
    return a.activityAt < b.activityAt ? 1 : -1;
  }
  return a.sessionId < b.sessionId ? -1 : 1;
}

/**
 * Arquivadas agrupadas por projeto, na ordem dos projetos da barra lateral e da mais
 * recente para a mais antiga dentro do grupo. Conversas cujo projeto sumiu caem num
 * grupo com o nome da pasta, por último.
 */
export function groupArchivedByProject(projects: ProjectView[], sessions: SessionSummary[]): ArchivedGroup[] {
  const names = new Map(projects.map((project) => [project.cwd, project.displayName]));
  const order = new Map(projects.map((project, index) => [project.cwd, index]));
  const buckets = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const bucket = buckets.get(session.cwd);
    if (bucket) {
      bucket.push(session);
    } else {
      buckets.set(session.cwd, [session]);
    }
  }
  return [...buckets.entries()]
    .map(([cwd, list]) => ({ cwd, name: names.get(cwd) ?? basename(cwd), sessions: [...list].sort(byActivityDesc) }))
    .sort(
      (a, b) =>
        (order.get(a.cwd) ?? projects.length) - (order.get(b.cwd) ?? projects.length) || (a.name < b.name ? -1 : 1),
    );
}

/** Busca pelo título exibido (caixa alta/baixa e espaços nas pontas não importam) e filtro por projeto. */
export function filterArchived(sessions: SessionSummary[], query: string, cwd: string | null): SessionSummary[] {
  const q = query.trim().toLowerCase();
  return sessions.filter(
    (session) => (cwd === null || session.cwd === cwd) && (q === "" || displayTitle(session).toLowerCase().includes(q)),
  );
}

/**
 * A seleção sobre a qual as ações em massa agem: só as conversas que o filtro atual mostra. Uma marcada e depois
 * escondida pela busca não pode ser excluída sem estar à vista; ela volta marcada quando o filtro a mostra de novo.
 */
export function visibleSelection(selectedIds: readonly string[], visible: readonly SessionSummary[]): string[] {
  const shown = new Set(visible.map((session) => session.sessionId));
  return selectedIds.filter((id) => shown.has(id));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Conversas com atividade anterior a `days` dias atrás; datas inválidas ficam de fora, nunca arquivam sem querer. */
export function olderThan(sessions: SessionSummary[], days: number, nowMs: number): SessionSummary[] {
  const cutoff = nowMs - Math.max(0, days) * DAY_MS;
  return sessions.filter((session) => {
    const at = Date.parse(session.activityAt);
    return Number.isFinite(at) && at < cutoff;
  });
}

export interface ArchiveWindow {
  days: number;
  count: number;
}

/** Quantas conversas cada janela de idade arquivaria agora. */
export function archiveWindows(sessions: SessionSummary[], days: readonly number[], nowMs: number): ArchiveWindow[] {
  return days.map((d) => ({ days: d, count: olderThan(sessions, d, nowMs).length }));
}

/** O texto do botão de uma janela: a contagem aparece sempre, inclusive zero, para o botão não parecer quebrado. */
export function archiveWindowLabel(range: ArchiveWindow): string {
  return `${range.days} dias (${range.count})`;
}

/** A dica de um botão: o que ele arquivaria ou, sem nada a arquivar, por que está desativado. */
export function archiveWindowHint(range: ArchiveWindow): string {
  return range.count === 0
    ? `Nenhuma conversa parada há mais de ${range.days} dias`
    : `Arquivar ${plural(range.count, "conversa parada", "conversas paradas")} há mais de ${range.days} dias`;
}

/** Quando nenhuma janela tem o que arquivar, uma linha explica os botões desativados; senão, nada. */
export function archiveOlderNote(windows: readonly ArchiveWindow[]): string | null {
  if (windows.length === 0 || windows.some((w) => w.count > 0)) return null;
  const shortest = Math.min(...windows.map((w) => w.days));
  return `Nenhuma conversa parada há mais de ${shortest} dias; nada para arquivar agora.`;
}
