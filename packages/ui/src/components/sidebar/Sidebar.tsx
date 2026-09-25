import {
  Archive,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Code,
  Copy,
  Download,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Layers,
  ListFilter,
  PanelLeftClose,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  ShieldOff,
  SquarePen,
  Target,
  Undo2,
  X,
} from "lucide-react";
import { memo, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { shallowEqual, useApp, useController, useNow } from "../../app/context.js";
import { useOverlayDragProps, useTitlebarOverlay } from "../../app/frame.js";
import { isTurnFinalizing } from "../../model/fold.js";
import { basename, displayTitle, formatElapsed, relativeTime } from "../../model/format.js";
import { statusLabel } from "../../model/goal.js";
import { PlanPill } from "../usage/PlanMeter.js";
import { SettingsNav } from "./SettingsNav.js";
import {
  STATUS_LABEL,
  groupByProject,
  groupByStatus,
  isLive,
  settledEntries,
  threadStatus,
  type ProjectGroup,
  type SidebarEntry,
} from "../../model/status.js";
import { identityHeading } from "../../model/identity.js";
import { DEFAULT_SIDEBAR_WIDTH, type CodeTheme } from "../../model/store.js";
import type { UpdateState } from "../../model/updates.js";
import type { ProjectView, SessionSummary } from "../../types.js";
import { Menu, MenuCheck, MenuContent, MenuItem, MenuOption, MenuRadioGroup, MenuSeparator, MenuTrigger, Tip } from "../ui/overlays.js";
import { IconButton, Logo, MOD, Shortcut, Spinner, cn, isMac } from "../ui/primitives.js";
import { StatusGlyph } from "../ui/StatusGlyph.js";

const PROJECT_PREVIEW = 6;
const STATUS_PREVIEW = 30;
/** A faixa sob o último projeto: soltar ali manda um projeto para o fim. */
const END_DROP = "end";
const REORDER_SLOP = 6;

function projectUnderPoint(x: number, y: number): string | null {
  for (const node of document.elementsFromPoint(x, y)) {
    if (!(node instanceof Element)) {
      continue;
    }
    if (node.closest("[data-project-end-drop]")) {
      return END_DROP;
    }
    const section = node.closest("[data-project-cwd]");
    if (section instanceof HTMLElement && section.dataset.projectCwd) {
      return section.dataset.projectCwd;
    }
  }
  return null;
}

export function Sidebar() {
  const width = useApp((s) => s.prefs.sidebarWidth);
  const overlay = useTitlebarOverlay();
  const routeKind = useApp((s) => s.route.kind);
  return (
    <aside
      aria-label="Barra lateral"
      className="@container relative flex h-full shrink-0 flex-col border-r border-line bg-sidebar"
      style={{ width }}
    >
      {overlay ? <TrafficLightsSlot /> : null}
      <SidebarTop />
      {routeKind === "settings" ? <SettingsNav /> : <ThreadList />}
      <SidebarFooter />
      <ResizeHandle />
    </aside>
  );
}

/**
 * Os semáforos do macOS flutuam neste espaço, 20px da esquerda e 20px do topo.
 * Ele também arrasta a janela.
 */
function TrafficLightsSlot() {
  const drag = useOverlayDragProps("self");
  return <div data-drag-region {...drag} aria-hidden="true" className="h-10 shrink-0" />;
}

function SidebarTop() {
  const controller = useController();
  const routeKind = useApp((s) => s.route.kind);
  const drag = useOverlayDragProps();
  return (
    <div data-drag-region {...drag} className="flex flex-col gap-px px-2 pt-2 pb-1.5">
      <div className="mb-2 flex h-8 items-center gap-2 pr-0.5 pl-1.5">
        <Logo size={20} />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-fg">Helicon</span>
        <span className="flex-1" />
        <Tip label="Ocultar barra lateral" shortcut={[MOD, "B"]}>
          <IconButton label="Ocultar barra lateral" onClick={() => controller.toggleSidebar()}>
            <PanelLeftClose size={16} />
          </IconButton>
        </Tip>
      </div>
      <NavRow
        icon={<SquarePen size={15} />}
        label="Nova conversa"
        keys={[MOD, "Shift", "O"]}
        active={routeKind === "new"}
        onClick={() => controller.newThread()}
      />
      <NavRow icon={<Search size={15} />} label="Buscar" keys={[MOD, "K"]} onClick={() => controller.setPaletteOpen(true)} />
    </div>
  );
}

function NavRow(props: { icon: ReactNode; label: string; keys: string[]; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "group/nav flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-fg",
        props.active && "bg-active text-fg",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>
      {/* A dica só ocupa espaço quando a barra é larga o bastante para manter o rótulo numa linha. */}
      <span className="hidden shrink-0 @min-[16rem]:block">
        <Shortcut keys={props.keys} className="opacity-0 transition-opacity duration-150 group-hover/nav:opacity-100" />
      </span>
    </button>
  );
}

function useSidebarEntries(): { entries: SidebarEntry[]; activeId: string | null } {
  const sessions = useApp((s) => s.sessions);
  const threads = useApp((s) => s.threads);
  const lastSeen = useApp((s) => s.prefs.lastSeen);
  const baseline = useApp((s) => s.prefs.baseline);
  const activeId = useApp((s) => (s.route.kind === "thread" ? s.route.sessionId : null));
  const entries = useMemo(
    () =>
      Object.values(sessions).map((session) => ({
        session,
        status: threadStatus(session, {
          fold: threads[session.sessionId]?.fold ?? null,
          lastSeen: lastSeen[session.sessionId] ?? null,
          baseline,
          active: session.sessionId === activeId,
        }),
      })),
    [sessions, threads, lastSeen, baseline, activeId],
  );
  return { entries, activeId };
}

function ThreadList() {
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const groupBy = useApp((s) => s.prefs.groupBy);
  const collapsed = useApp((s) => s.prefs.collapsedProjects);
  const loaded = useApp((s) => s.sessionsLoaded);
  const now = useNow(30_000);
  const { entries, activeId } = useSidebarEntries();

  const projectGroups = useMemo(() => groupByProject(projects, entries), [projects, entries]);
  // Arrastar um cabeçalho de projeto o move: ao soltar, ele cai acima da linha sob o cursor, ou por último.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };
  // O projeto arrastado vem com o soltar, não de `dragging`: os manipuladores de ponteiro foram criados no
  // apertar do botão, antes do arrasto começar, então o `dragging` que eles enxergam ainda é null.
  const drop = (cwd: string, beforeCwd: string | null) => {
    void controller.reorderProjects(cwd, beforeCwd);
    endDrag();
  };
  const statusGroups = useMemo(() => groupByStatus(entries), [entries]);
  const settled = useMemo(() => settledEntries(entries), [entries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 items-center justify-between pr-2 pl-3.5">
        <h2 className="text-xs font-medium text-subtle">{groupBy === "project" ? "Projetos" : "Por status"}</h2>
        <div className="flex items-center gap-0.5">
          <GroupByMenu />
          <Tip label="Adicionar projeto">
            <IconButton size="xs" label="Adicionar projeto" onClick={() => controller.setAddProjectOpen(true)}>
              <FolderPlus size={14} />
            </IconButton>
          </Tip>
        </div>
      </div>
      <nav aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-6">
        {!loaded ? (
          <SidebarSkeleton />
        ) : projects.length === 0 ? (
          <SidebarEmpty />
        ) : groupBy === "project" ? (
          <>
            {projectGroups.map((group) => (
              <ProjectSection
                key={group.project.cwd}
                group={group}
                collapsed={collapsed.includes(group.project.cwd)}
                activeId={activeId}
                now={now}
                dragging={dragging}
                over={over}
                onDragStart={setDragging}
                onDragOver={setOver}
                onDrop={drop}
                onDragEnd={endDrag}
              />
            ))}
            {dragging ? (
              <div
                aria-hidden="true"
                data-project-end-drop=""
                className={cn(
                  "mx-1 h-7 rounded-lg border border-dashed transition-colors duration-100",
                  over === END_DROP ? "border-accent bg-hover" : "border-line",
                )}
              />
            ) : null}
          </>
        ) : (
          <>
            {statusGroups.map((group) => (
              <StatusSection key={group.id} label={group.label} entries={group.entries} activeId={activeId} now={now} cap={group.id === "idle"} />
            ))}
            {settled.length > 0 ? <SettledShelf shelfKey="status" entries={settled} activeId={activeId} now={now} showProject /> : null}
          </>
        )}
      </nav>
    </div>
  );
}

const ProjectSection = memo(function ProjectSection(props: {
  group: ProjectGroup;
  collapsed: boolean;
  activeId: string | null;
  now: number;
  dragging: string | null;
  over: string | null;
  onDragStart: (cwd: string) => void;
  onDragOver: (cwd: string) => void;
  onDrop: (cwd: string, beforeCwd: string | null) => void;
  onDragEnd: () => void;
}) {
  const controller = useController();
  const noWindowDrag = useOverlayDragProps("off");
  const didReorder = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const { project, entries } = props.group;
  const activeIndex = entries.findIndex((e) => e.session.sessionId === props.activeId);
  const liveCount = entries.filter((e) => isLive(e.status)).length;
  const limit = expanded ? entries.length : Math.max(PROJECT_PREVIEW, liveCount, activeIndex + 1);
  const visible = entries.slice(0, limit);
  return (
    <section
      data-project-cwd={project.cwd}
      className={cn("mb-1", props.dragging === project.cwd && "opacity-50")}
      aria-label={project.displayName}
    >
      <div
        className={cn(
          "mx-1 mb-0.5 h-0.5 rounded-full transition-colors duration-100",
          props.over === project.cwd && props.dragging && props.dragging !== project.cwd ? "bg-accent" : "bg-transparent",
        )}
      />
      <div
        data-no-drag
        {...noWindowDrag}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          const origin = event.target;
          if (origin instanceof Element && origin.closest("[data-no-reorder]")) {
            return;
          }
          const startX = event.clientX;
          const startY = event.clientY;
          const cwd = project.cwd;
          let started = false;
          const onMove = (move: globalThis.PointerEvent) => {
            if (!started) {
              if (Math.hypot(move.clientX - startX, move.clientY - startY) < REORDER_SLOP) {
                return;
              }
              started = true;
              didReorder.current = true;
              props.onDragStart(cwd);
            }
            const over = projectUnderPoint(move.clientX, move.clientY);
            if (over) {
              props.onDragOver(over);
            }
          };
          const onUp = (up: globalThis.PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            // Ao soltar sobre outro projeto, o clique pode ir para a lista, não para este cabeçalho.
            // Limpa a marca depois desse clique para não bloquear o próximo clique do usuário.
            setTimeout(() => {
              didReorder.current = false;
            }, 0);
            if (!started) {
              return;
            }
            const over = projectUnderPoint(up.clientX, up.clientY);
            if (over === END_DROP) {
              props.onDrop(cwd, null);
            } else if (over && over !== cwd) {
              props.onDrop(cwd, over);
            } else {
              props.onDragEnd();
            }
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        }}
        onClickCapture={(event) => {
          if (!didReorder.current) {
            return;
          }
          didReorder.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className="group/project flex h-8 cursor-grab items-center gap-0.5 rounded-lg pr-1 transition-colors duration-100 hover:bg-hover active:cursor-grabbing"
      >
        <button
          type="button"
          aria-expanded={!props.collapsed}
          onClick={() => controller.toggleProjectCollapsed(project.cwd)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-left"
          title={project.cwd}
        >
          <ChevronRight
            size={13}
            className={cn("shrink-0 text-subtle transition-transform duration-150 ease-out", !props.collapsed && "rotate-90")}
          />
          {props.collapsed ? (
            <Folder size={15} className="shrink-0 text-subtle" />
          ) : (
            <FolderOpen size={15} className="shrink-0 text-subtle" />
          )}
          <span className="truncate text-sm font-medium text-fg">{project.displayName}</span>
          {project.pinned ? <Pin size={11} className="shrink-0 text-subtle" aria-label="Fixado" /> : null}
          {props.collapsed && props.group.attention > 0 ? (
            <span className="mr-1 ml-auto size-1.5 shrink-0 rounded-full bg-warn" aria-label={`${props.group.attention} precisam de você`} />
          ) : props.collapsed && props.group.running > 0 ? (
            <Spinner size={10} className="mr-1 ml-auto text-accent-text" label="Trabalhando" />
          ) : null}
        </button>
        <div
          data-no-reorder
          className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover/project:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
        >
          <Tip label={`Nova conversa em ${project.displayName}`}>
            <IconButton size="xs" label={`Nova conversa em ${project.displayName}`} onClick={() => controller.newThread(project.cwd)}>
              <SquarePen size={13} />
            </IconButton>
          </Tip>
          <ProjectMenu project={project} />
        </div>
      </div>
      {props.collapsed ? null : (
        <ul className="flex flex-col gap-px pt-px">
          {visible.map((entry) => (
            <ThreadRow key={entry.session.sessionId} entry={entry} active={entry.session.sessionId === props.activeId} now={props.now} />
          ))}
          {entries.length === 0 && props.group.settled.length === 0 ? (
            <li>
              <button
                type="button"
                onClick={() => controller.newThread(project.cwd)}
                className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
              >
                Começar a primeira conversa
              </button>
            </li>
          ) : null}
          {entries.length > visible.length || (expanded && entries.length > PROJECT_PREVIEW) ? (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
              >
                {expanded ? "Mostrar menos" : `Mostrar mais ${entries.length - visible.length}`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {props.collapsed || props.group.settled.length === 0 ? null : (
        <SettledShelf shelfKey={`project:${project.cwd}`} entries={props.group.settled} activeId={props.activeId} now={props.now} />
      )}
    </section>
  );
});

function StatusSection(props: { label: string; entries: SidebarEntry[]; activeId: string | null; now: number; cap: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const limit = props.cap && !expanded ? STATUS_PREVIEW : props.entries.length;
  return (
    <section className="mb-2" aria-label={props.label}>
      <h3 className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-subtle">
        <span>{props.label}</span>
        <span className="tabular-nums">{props.entries.length}</span>
      </h3>
      <ul className="flex flex-col gap-px">
        {props.entries.slice(0, limit).map((entry) => (
          <ThreadRow
            key={entry.session.sessionId}
            entry={entry}
            active={entry.session.sessionId === props.activeId}
            now={props.now}
            showProject
          />
        ))}
        {props.entries.length > limit ? (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
            >
              Mostrar mais {props.entries.length - limit}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

const SHELF_PAGE = 10;
const SHELF_MORE = 25;

/**
 * Conversas resolvidas, recolhidas sob um divisor "Resolvidas" como no T3 Code. Mesmo recolhido, ainda
 * mostra a conversa aberta, para a barra nunca perder a seleção atual.
 */
function SettledShelf(props: { shelfKey: string; entries: SidebarEntry[]; activeId: string | null; now: number; showProject?: boolean }) {
  const controller = useController();
  const open = useApp((s) => s.prefs.openShelves.includes(props.shelfKey));
  const [limit, setLimit] = useState(SHELF_PAGE);
  const visible = open ? props.entries.slice(0, limit) : props.entries.filter((e) => e.session.sessionId === props.activeId);
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => controller.toggleShelf(props.shelfKey)}
        className="group/shelf flex h-7 w-full items-center gap-2 rounded-lg pr-2 pl-[30px] text-left text-xs text-subtle transition-colors duration-100 hover:text-fg"
      >
        <span>Resolvidas</span>
        <span className="tabular-nums">{props.entries.length}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        <ChevronRight size={12} className={cn("shrink-0 transition-transform duration-150 ease-out", open && "rotate-90")} />
      </button>
      {visible.length > 0 ? (
        <ul className="flex flex-col gap-px">
          {visible.map((entry) => (
            <ThreadRow
              key={entry.session.sessionId}
              entry={entry}
              active={entry.session.sessionId === props.activeId}
              now={props.now}
              showProject={props.showProject}
              settled
            />
          ))}
        </ul>
      ) : null}
      {open && props.entries.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + SHELF_MORE)}
          className="flex h-7 w-full items-center rounded-lg pl-[30px] text-left text-xs text-subtle hover:bg-hover hover:text-fg"
        >
          Mostrar mais {Math.min(SHELF_MORE, props.entries.length - limit)}
        </button>
      ) : null}
    </div>
  );
}

/** "Trabalhando há 1m" contado do início da mensagem e atualizando a cada segundo, como o cronômetro do T3 Code. */
function WorkingFor(props: { session: SessionSummary }) {
  const foldStart = useApp((s) => {
    const fold = s.threads[props.session.sessionId]?.fold;
    return fold?.activeTurnId ? (fold.turns[fold.activeTurnId]?.startedAt ?? null) : null;
  });
  const finalizing = useApp((s) => {
    const fold = s.threads[props.session.sessionId]?.fold;
    return fold ? isTurnFinalizing(fold, fold.activeTurnId) : false;
  });
  const liveStart = props.session.live?.turnStartedAt ? Date.parse(props.session.live.turnStartedAt) : null;
  const start = foldStart ?? liveStart;
  const now = useNow(1000);
  return (
    <span className="text-accent-text">
      {finalizing ? "Finalizando…" : "Trabalhando"}
      {start ? <span className="ml-1">{formatElapsed(now - start)}</span> : null}
    </span>
  );
}

/** O espaço à direita de uma linha: do que a conversa precisa, um cronômetro rodando, ou há quanto tempo ela se moveu. */
function RowStatus(props: { entry: SidebarEntry; now: number; settled?: boolean }) {
  const { session, status } = props.entry;
  if (props.settled) {
    return <span className="text-subtle">{relativeTime(session.settledAt ?? session.activityAt, props.now)}</span>;
  }
  switch (status) {
    case "running":
      return <WorkingFor session={session} />;
    case "approval":
      return <span className="font-medium text-warn-text">Aprovação</span>;
    case "input":
      return <span className="font-medium text-status-input">Pergunta</span>;
    case "failed":
      return <span className="font-medium text-danger-text">Falhou</span>;
    case "unread":
      return (
        <span className="flex items-center gap-1 font-medium text-ok-text">
          <Check size={11} strokeWidth={2.5} aria-hidden="true" />
          Concluída
        </span>
      );
    default:
      return <span className="text-subtle">{relativeTime(session.activityAt, props.now)}</span>;
  }
}

/** A segunda linha de um cartão ativo: o projeto na visão por estado, uma meta aberta e o branch quando conhecido. */
function RowMeta(props: { session: SessionSummary; showProject?: boolean }) {
  const branch = useApp((s) => s.threads[props.session.sessionId]?.fold.meta.branch ?? null);
  // A meta da própria conversa aberta é a mais fresca; senão, o que o servidor viu por último.
  const goal = useApp((s) => {
    const fold = s.threads[props.session.sessionId]?.fold;
    return fold?.meta.goalSeen ? fold.meta.goal : (props.session.live?.goal ?? null);
  });
  const tone = goal ? statusLabel(goal.status).tone : null;
  const open = goal !== null && (tone === "active" || tone === "paused" || tone === "attention");
  if (!props.showProject && !branch && !open) {
    return null;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-subtle">
      {props.showProject ? <span className="truncate">{basename(props.session.cwd)}</span> : null}
      {open && goal ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 tabular-nums",
            tone === "active" ? "text-accent-text" : tone === "attention" ? "text-warn-text" : "text-subtle",
          )}
          title={`Meta: ${goal.objective}`}
        >
          <Target size={11} className="shrink-0" aria-hidden="true" />
          <span className="sr-only">Meta </span>
          {Math.round(Math.max(0, Math.min(100, goal.percentComplete)))}%
        </span>
      ) : null}
      {branch ? (
        <span className="flex min-w-0 items-center gap-1">
          <GitBranch size={11} className="shrink-0" aria-hidden="true" />
          <span className="truncate font-mono text-2xs">{branch}</span>
        </span>
      ) : null}
    </span>
  );
}

export const ThreadRow = memo(
  function ThreadRow(props: { entry: SidebarEntry; active: boolean; now: number; showProject?: boolean; settled?: boolean }) {
    const controller = useController();
    const { session, status } = props.entry;
    const [renaming, setRenaming] = useState(false);
    const emphasized = props.active || status === "unread" || isLive(status);
    return (
      <li>
        <div
          className={cn(
            "group/row relative flex min-h-8 items-center gap-2 rounded-lg py-1 pr-1 pl-[30px] transition-colors duration-100",
            props.active ? "bg-active" : "hover:bg-hover",
          )}
        >
          {props.settled ? null : (
            <span className="absolute top-1/2 left-[10px] flex size-4 -translate-y-1/2 items-center justify-center">
              <StatusGlyph status={status} />
            </span>
          )}
          {renaming ? (
            <RenameField
              initial={session.title}
              onDone={(title) => {
                setRenaming(false);
                if (title !== null) {
                  void controller.rename(session.sessionId, title);
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => controller.openThread(session.sessionId)}
              onDoubleClick={() => setRenaming(true)}
              aria-current={props.active ? "page" : undefined}
              title={displayTitle(session)}
              className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-accent focus-visible:after:outline"
            >
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-sm",
                  props.settled ? "text-subtle" : emphasized ? "text-fg" : "text-muted",
                  status === "unread" && !props.settled && "font-medium",
                )}
              >
                {session.sandboxDisabled === true ? (
                  <span title="Sandbox desligada" className="flex shrink-0 text-warn-text">
                    <ShieldOff size={12} aria-hidden="true" />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{displayTitle(session)}</span>
              </span>
              {props.settled ? null : <RowMeta session={session} showProject={props.showProject} />}
              <span className="sr-only">{`, ${STATUS_LABEL[status]}${session.sandboxDisabled === true ? ", sandbox desligada" : ""}`}</span>
            </button>
          )}
          {renaming ? null : (
            <>
              <span
                // pr-1.5 sobre o pr-1 da linha espelha o recuo de 10px do glifo de estado à esquerda.
                className="shrink-0 pr-1.5 text-2xs tabular-nums group-focus-within/row:hidden group-hover/row:hidden group-has-[[data-state=open]]/row:hidden"
                aria-hidden="true"
              >
                <RowStatus entry={props.entry} now={props.now} settled={props.settled} />
              </span>
              <div className="relative z-10 hidden items-center group-focus-within/row:flex group-hover/row:flex group-has-[[data-state=open]]/row:flex">
                {props.settled ? (
                  <Tip label="Reabrir">
                    <IconButton size="xs" label="Reabrir conversa" onClick={() => void controller.setSettled(session.sessionId, false)}>
                      <Undo2 size={13} />
                    </IconButton>
                  </Tip>
                ) : isLive(status) ? null : (
                  <Tip label="Resolver">
                    <IconButton size="xs" label="Resolver conversa" onClick={() => void controller.setSettled(session.sessionId, true)}>
                      <Check size={14} />
                    </IconButton>
                  </Tip>
                )}
                <ThreadMenu session={session} onRename={() => setRenaming(true)} />
              </div>
            </>
          )}
        </div>
      </li>
    );
  },
  (a, b) =>
    a.entry.session === b.entry.session &&
    a.entry.status === b.entry.status &&
    a.active === b.active &&
    a.now === b.now &&
    a.showProject === b.showProject &&
    a.settled === b.settled,
);

function RenameField(props: { initial: string; onDone: (title: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (!done.current) {
      done.current = true;
      props.onDone(value);
    }
  };
  return (
    <input
      autoFocus
      defaultValue={props.initial}
      aria-label="Título da conversa"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          finish(null);
        }
      }}
      className="relative z-10 h-6 min-w-0 flex-1 rounded-md bg-raised px-1.5 text-sm text-fg outline-none shadow-[0_0_0_1.5px_var(--accent)]"
    />
  );
}

function ThreadMenu(props: { session: SessionSummary; onRename: () => void }) {
  const controller = useController();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="xs" label="Ações da conversa">
          <Ellipsis size={14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<Pencil size={14} />} onSelect={props.onRename}>
          Renomear
        </MenuItem>
        <MenuItem icon={<Copy size={14} />} onSelect={() => void navigator.clipboard?.writeText(props.session.sessionId)}>
          Copiar ID da sessão
        </MenuItem>
        <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void controller.openFolder(props.session.cwd, "files")}>
          {revealLabel()}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Archive size={14} />} onSelect={() => void controller.archive(props.session.sessionId)}>
          Arquivar conversa
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function revealLabel(): string {
  if (isMac) {
    return "Revelar no Finder";
  }
  return typeof navigator !== "undefined" && /Win/.test(navigator.platform) ? "Abrir no Explorador de Arquivos" : "Abrir pasta";
}

function ProjectMenu(props: { project: ProjectView }) {
  const controller = useController();
  const { project } = props;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="xs" label={`${project.displayName}: ações`}>
          <Ellipsis size={14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<SquarePen size={14} />} onSelect={() => controller.newThread(project.cwd)}>
          Nova conversa
        </MenuItem>
        <MenuItem
          icon={project.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          onSelect={() => void controller.togglePin(project.cwd)}
        >
          {project.pinned ? "Desafixar" : "Fixar no topo"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void controller.openFolder(project.cwd, "files")}>
          {revealLabel()}
        </MenuItem>
        <MenuItem icon={<Code size={14} />} onSelect={() => void controller.openFolder(project.cwd, "editor")}>
          Abrir no VS Code
        </MenuItem>
        <MenuItem icon={<Copy size={14} />} onSelect={() => void navigator.clipboard?.writeText(project.cwd)}>
          Copiar caminho
        </MenuItem>
        <MenuItem icon={<RefreshCw size={14} />} onSelect={() => void controller.refreshProject(project.cwd)}>
          Atualizar conversas
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<X size={14} />} tone="danger" onSelect={() => void controller.hideProject(project.cwd)}>
          Remover da barra lateral
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function GroupByMenu() {
  const controller = useController();
  const groupBy = useApp((s) => s.prefs.groupBy);
  return (
    <Menu>
      <Tip label="Agrupar conversas">
        <MenuTrigger asChild>
          <IconButton size="xs" label="Agrupar conversas">
            <ListFilter size={14} />
          </IconButton>
        </MenuTrigger>
      </Tip>
      <MenuContent align="end">
        <MenuRadioGroup value={groupBy} onValueChange={(v) => controller.setGroupBy(v === "status" ? "status" : "project")}>
          <MenuOption value="project" icon={<Folder size={14} />} label="Por projeto" description="Cada projeto com suas conversas" />
          <MenuOption value="status" icon={<Layers size={14} />} label="Por status" description="Precisam de você, trabalhando, prontas para revisão" />
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function SidebarFooter() {
  const controller = useController();
  const env = useApp((s) => s.env);
  const identity = useApp((s) => s.identity);
  const connection = useApp((s) => s.connection);
  const discovering = useApp((s) => s.discovering);
  const hostError = useApp((s) => s.hostError);
  const status =
    connection === "lost"
      ? { dot: "bg-warn", text: "Reconectando ao Helicon" }
      : hostError
        ? { dot: "bg-danger", text: "Muse precisa de atenção" }
        : env?.platform === "win32" && env.runtime !== "native"
          ? { dot: "bg-ok", text: `Muse no WSL (${env.defaultDistro ?? "Ubuntu"})` }
          : { dot: "bg-ok", text: "Muse pronto" };
  const heliconLabel = identity ? identityHeading(identity) : `Helicon ${env?.version ?? ""}`;
  const detail = hostError ?? (env?.musePath ? `${env.musePath}  |  ${heliconLabel}` : heliconLabel);
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-t border-line px-2">
      <Tip label={detail} side="top" align="start">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-xs text-muted" tabIndex={0}>
          <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} aria-hidden="true" />
          <span className="truncate">{status.text}</span>
        </div>
      </Tip>
      <Tip label="Atualizar conversas a partir do Muse" side="top">
        <IconButton label="Atualizar conversas a partir do Muse" onClick={() => void controller.discoverAll()} disabled={discovering}>
          <RefreshCw size={14} className={cn(discovering && "animate-spin")} />
        </IconButton>
      </Tip>
      <PlanPill />
      <Tip label="Configurações" side="top">
        <IconButton label="Configurações" onClick={() => controller.navigate({ kind: "settings" })}>
          <Settings size={14} />
        </IconButton>
      </Tip>
      {!identity ? <UpdatesMenu /> : null}
    </div>
  );
}

export function updateSummary(updates: UpdateState, autoUpdate: boolean, paused: boolean, now: number): string {
  const version = updates.update?.version ?? "";
  switch (updates.status) {
    case "checking":
      return "Verificando atualizações";
    case "available":
      return paused ? `A versão ${version} está disponível. Atualizações pausadas.` : `A versão ${version} está disponível`;
    case "downloading":
      return `Baixando a versão ${version}${updates.progress !== null ? `, ${Math.round(updates.progress * 100)}%` : ""}`;
    case "ready":
      return autoUpdate && !paused ? `A versão ${version} instala quando você fechar o Helicon` : `A versão ${version} está pronta para instalar`;
    case "installing":
      return "Instalando a atualização";
    case "error":
      return "Não foi possível verificar atualizações";
    case "upToDate": {
      const ago = updates.checkedAt ? relativeTime(new Date(updates.checkedAt).toISOString(), now) : "";
      return paused ? "Em dia. Atualizações pausadas." : ago && ago !== "agora" ? `Em dia, verificado há ${ago}` : "Em dia";
    }
    default:
      return paused ? "Atualizações pausadas" : autoUpdate ? "O Helicon se atualiza sozinho" : "Atualizações automáticas desligadas";
  }
}

/** Atualizações do app desktop. O ícone do rodapé mostra um ponto enquanto uma nova versão espera. */
function UpdatesMenu() {
  const controller = useController();
  const updates = useApp((s) => s.updates);
  const autoUpdate = useApp((s) => s.prefs.autoUpdate);
  const paused = useApp((s) => s.prefs.updatesPaused);
  const now = useNow(60_000);
  if (!updates) {
    return null;
  }
  const { status } = updates;
  const version = updates.update?.version ?? "";
  const waiting = status === "available" || status === "downloading" || status === "ready";
  const busy = status === "checking" || status === "downloading" || status === "installing";
  return (
    <Menu>
      <Tip label={status === "ready" ? `Helicon ${version} está pronto para instalar` : waiting ? `Helicon ${version} está disponível` : "Atualizações"} side="top">
        <MenuTrigger asChild>
          <IconButton label="Atualizações" className="relative">
            <Download size={15} />
            {waiting ? (
              <span
                aria-hidden="true"
                className={cn("absolute top-1.5 right-1.5 size-1.5 rounded-full", status === "ready" ? "bg-accent" : "bg-accent/50")}
              />
            ) : null}
          </IconButton>
        </MenuTrigger>
      </Tip>
      <MenuContent side="top" align="start" className="w-[290px]">
        <div className="px-2 pt-1.5 pb-2">
          <p className="text-sm font-medium text-fg">Helicon {updates.currentVersion ?? ""}</p>
          <p className="mt-0.5 text-xs text-muted">{updateSummary(updates, autoUpdate, paused, now)}</p>
          {status === "downloading" && updates.progress !== null ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-active" role="progressbar" aria-valuenow={Math.round(updates.progress * 100)}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${updates.progress * 100}%` }} />
            </div>
          ) : null}
          {updates.error ? <p className="mt-1.5 text-xs break-words text-danger-text">{updates.error}</p> : null}
        </div>
        <MenuSeparator />
        {status === "ready" ? (
          <MenuItem icon={<RotateCw size={14} />} onSelect={() => controller.restartToUpdate()}>
            Reiniciar para atualizar
          </MenuItem>
        ) : null}
        {status === "available" ? (
          <MenuItem icon={<ArrowDownToLine size={14} />} onSelect={() => controller.downloadUpdate()}>
            Baixar a versão {version}
          </MenuItem>
        ) : null}
        <MenuItem icon={<RefreshCw size={14} />} disabled={busy} onSelect={() => controller.checkForUpdates()}>
          Verificar atualizações
        </MenuItem>
        <MenuSeparator />
        <MenuCheck
          checked={autoUpdate}
          onChange={(on) => controller.setAutoUpdate(on)}
          description="Baixar novas versões em segundo plano e instalá-las quando o Helicon fechar"
        >
          Atualizações automáticas
        </MenuCheck>
        <MenuItem icon={paused ? <Play size={14} /> : <Pause size={14} />} onSelect={() => controller.setUpdatesPaused(!paused)}>
          {paused ? "Retomar atualizações" : "Pausar atualizações"}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export const CODE_THEME_LABELS: Record<CodeTheme, string> = {
  helicon: "Helicon",
  ayu: "Ayu",
  github: "GitHub",
  vercel: "Vercel",
  cursor: "Cursor",
  catppuccin: "Catppuccin",
};

function ResizeHandle() {
  const controller = useController();
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = controller.store.get().prefs.sidebarWidth;
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    const move = (e: globalThis.PointerEvent) => controller.setSidebarWidth(startWidth + e.clientX - startX);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar barra lateral"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => controller.setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={(e) => {
        const width = controller.store.get().prefs.sidebarWidth;
        if (e.key === "ArrowLeft") {
          controller.setSidebarWidth(width - 16);
        } else if (e.key === "ArrowRight") {
          controller.setSidebarWidth(width + 16);
        }
      }}
      className="absolute top-0 right-[-3px] z-[var(--z-resize)] h-full w-1.5 cursor-col-resize transition-colors duration-150 hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:outline-none"
    />
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2 pt-2" aria-hidden="true">
      {[62, 80, 54, 70, 46, 66].map((w, i) => (
        <div key={i} className="h-3 rounded bg-hover" style={{ width: `${w}%`, marginLeft: i % 3 === 0 ? 0 : 22 }} />
      ))}
    </div>
  );
}

function SidebarEmpty() {
  const controller = useController();
  const discovering = useApp((s) => s.discovering);
  return (
    <div className="px-2 pt-3 text-sm">
      <p className="font-medium text-fg">Nenhum projeto ainda</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Adicione uma pasta para começar uma conversa. Conversas que você rodou no terminal do Muse aparecem aqui sozinhas.
      </p>
      <button
        type="button"
        onClick={() => controller.setAddProjectOpen(true)}
        className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent-text hover:bg-hover"
      >
        <FolderPlus size={14} /> Adicionar projeto
      </button>
      {discovering ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
          <Spinner size={10} /> Procurando conversas do Muse
        </p>
      ) : null}
    </div>
  );
}

export { useSidebarEntries, shallowEqual };
