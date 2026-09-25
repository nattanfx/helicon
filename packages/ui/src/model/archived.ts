import { basename } from "./format.js";
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

/** Busca por título (caixa alta/baixa e espaços nas pontas não importam) e filtro por projeto. */
export function filterArchived(sessions: SessionSummary[], query: string, cwd: string | null): SessionSummary[] {
  const q = query.trim().toLowerCase();
  return sessions.filter(
    (session) => (cwd === null || session.cwd === cwd) && (q === "" || session.title.toLowerCase().includes(q)),
  );
}
