import { ChevronDown, Folder, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { filterArchived, groupArchivedByProject } from "../../model/archived.js";
import { displayTitle, formatClock, shortenPath } from "../../model/format.js";
import type { SessionSummary } from "../../types.js";
import { Menu, MenuContent, MenuOption, MenuRadioGroup, MenuTrigger, Modal, Tip } from "../ui/overlays.js";
import { Button, IconButton, Spinner } from "../ui/primitives.js";

function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function ProjectFilter(props: { project: string | null; onChange: (cwd: string | null) => void }) {
  const projects = useApp((s) => s.projects);
  const label =
    props.project === null ? "Todos os projetos" : (projects.find((p) => p.cwd === props.project)?.displayName ?? props.project);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="secondary" aria-label="Filtrar por projeto">
          <Folder size={13} /> {label} <ChevronDown size={14} />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-[320px]">
        <MenuRadioGroup value={props.project ?? ""} onValueChange={(value) => props.onChange(value === "" ? null : value)}>
          <MenuOption value="" label="Todos os projetos" />
          {projects.map((p) => (
            <MenuOption
              key={p.cwd}
              value={p.cwd}
              label={p.displayName}
              description={
                <span className="block truncate" title={p.cwd}>
                  {shortenPath(p.cwd, 44)}
                </span>
              }
            />
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function ArchivedRow(props: { session: SessionSummary; now: number; onDelete: (session: SessionSummary) => void }) {
  const controller = useController();
  const deleting = useApp((s) => Boolean(s.busy[`delete:${props.session.sessionId}`]));
  const meta = `${formatClock(Date.parse(props.session.activityAt), props.now)} · ${countLabel(props.session.turnCount, "turno", "turnos")}`;
  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">{displayTitle(props.session)}</p>
        <p className="mt-0.5 text-xs text-muted">{meta}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => void controller.restoreArchived(props.session.sessionId)}>
        Desarquivar
      </Button>
      <Tip label="Excluir conversa">
        <IconButton label="Excluir conversa" disabled={deleting} onClick={() => props.onDelete(props.session)}>
          <Trash2 size={14} />
        </IconButton>
      </Tip>
    </div>
  );
}

/** Chats arquivados agrupados por projeto, com busca, filtro, restauragem e exclusão. */
export function ArchivedChats() {
  const controller = useController();
  const archived = useApp((s) => s.archived);
  const loaded = useApp((s) => s.archivedLoaded);
  const error = useApp((s) => s.archivedError);
  const projects = useApp((s) => s.projects);
  const busyMap = useApp((s) => s.busy);
  const now = useNow(60_000);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SessionSummary | null>(null);

  const filtered = useMemo(() => filterArchived(archived, query, project), [archived, query, project]);
  const groups = useMemo(() => groupArchivedByProject(projects, filtered), [projects, filtered]);

  if (!loaded && !error) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-8">
        <Spinner size={16} label="Carregando arquivadas" />
        <p className="text-sm text-muted">Carregando arquivadas…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4">
        <p className="text-sm text-muted">Não foi possível carregar as arquivadas: {error}</p>
        <Button size="sm" variant="secondary" onClick={() => void controller.loadArchived()}>
          <RefreshCw size={13} /> Tentar de novo
        </Button>
      </div>
    );
  }
  if (archived.length === 0) {
    return <p className="px-4 py-4 text-sm text-muted">Nenhum chat arquivado.</p>;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar arquivadas"
            aria-label="Buscar conversas arquivadas"
            className="h-8 w-full rounded-lg bg-sunken pr-2 pl-8 text-sm text-fg outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <ProjectFilter project={project} onChange={setProject} />
        <p className="w-full text-xs text-muted sm:w-auto sm:flex-1 sm:text-right">
          {countLabel(filtered.length, "conversa", "conversas")}
        </p>
      </div>
      {filtered.length === 0 ? (
        <p className="border-t border-line px-4 py-4 text-sm text-muted">Nenhuma arquivada combina com a busca.</p>
      ) : (
        groups.map((group) => (
          <div key={group.cwd}>
            <div className="flex items-center gap-2 border-t border-line px-4 py-2">
              <Folder size={14} aria-hidden="true" className="shrink-0 text-subtle" />
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={group.cwd}>
                {group.name}
              </p>
              <p className="shrink-0 text-xs text-muted">{countLabel(group.sessions.length, "conversa", "conversas")}</p>
            </div>
            {group.sessions.map((session) => (
              <ArchivedRow key={session.sessionId} session={session} now={now} onDelete={setConfirming} />
            ))}
          </div>
        ))
      )}
      <Modal
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
        title="Excluir esta conversa?"
        description={
          confirming
            ? `“${displayTitle(confirming)}” sai do Helicon para sempre, com seus anexos e uso registrado. A sessão do Muse é preservada.`
            : ""
        }
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={confirming !== null && busyMap[`delete:${confirming.sessionId}`] === true}
            onClick={() => {
              if (confirming) {
                void controller.deleteArchived(confirming.sessionId);
              }
              setConfirming(null);
            }}
          >
            Excluir conversa
          </Button>
        </div>
      </Modal>
    </>
  );
}
