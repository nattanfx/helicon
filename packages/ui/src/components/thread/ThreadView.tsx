import { Archive, CircleStop, Code, Copy, Ellipsis, Folder, FolderOpen, FolderTree, PanelBottomOpen, GitBranch, Lock, Minimize2, Pencil, ShieldOff, Square, SquarePen } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { CaptionSpacer, useOverlayDragProps } from "../../app/frame.js";
import { isTurnFinalizing } from "../../model/fold.js";
import { basename, displayTitle, formatDuration } from "../../model/format.js";
import { backgroundTasks } from "../../model/plan.js";
import { goalView } from "../../model/goal.js";
import type { ThreadState } from "../../model/store.js";
import type { SessionSummary } from "../../types.js";
import { SidebarToggle, TrafficLightSpacer } from "../chrome.js";
import { Composer, ComposerFooter } from "../composer/Composer.js";
import { TelemetryPills } from "../composer/TelemetryPills.js";
import { ApprovalPanel, CloseCard, PlanPanel, QuestionPanel, QueuedList, ReadOnlyNotice, StalledNotice } from "../requests/Requests.js";
import { GoalPanel } from "./GoalPanel.js";
import { revealLabel } from "../sidebar/Sidebar.js";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip } from "../ui/overlays.js";
import { Button, IconButton, MOD, Spinner } from "../ui/primitives.js";
import { FilesPanel } from "../files/FilesPanel.js";
import { Transcript } from "./Transcript.js";

export function ThreadView(props: { sessionId: string }) {
  const session = useApp((s) => s.sessions[props.sessionId] ?? null);
  const thread = useApp((s) => s.threads[props.sessionId] ?? null);
  const filesOpen = useApp((s) => s.prefs.filesOpen);
  if (!session) {
    return <MissingThread />;
  }
  const running = thread ? thread.fold.activeTurnId !== null : Boolean(session.live?.activeTurnId);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <ThreadHeader session={session} thread={thread} running={running} />
      <div className="flex min-h-0 flex-1">
        <div className="@container flex min-w-0 flex-1 flex-col">
          {thread ? <Transcript sessionId={props.sessionId} thread={thread} /> : <div className="min-h-0 flex-1" />}
          <Dock session={session} thread={thread} running={running} />
        </div>
        {filesOpen ? <FilesPanel sessionId={props.sessionId} cwd={session.cwd} /> : null}
      </div>
    </div>
  );
}

function ThreadHeader(props: { session: SessionSummary; thread: ThreadState | null; running: boolean }) {
  const controller = useController();
  const { session, thread } = props;
  const [renaming, setRenaming] = useState(false);
  const fold = thread?.fold ?? null;
  const finalizing = fold ? isTurnFinalizing(fold, fold.activeTurnId) : false;
  const waiting = fold ? Object.keys(fold.approvals).length + Object.keys(fold.userInputs).length > 0 : false;
  const startedAt = fold?.activeTurnId ? fold.turns[fold.activeTurnId]?.startedAt : undefined;
  const now = useNow(1000, props.running && startedAt !== undefined);
  const drag = useOverlayDragProps();
  const noDrag = useOverlayDragProps("off");
  const filesOpen = useApp((s) => s.prefs.filesOpen);
  return (
    <header data-drag-region {...drag} className="@container flex h-12 shrink-0 items-center gap-1.5 overflow-hidden border-b border-line px-3">
      <TrafficLightSpacer />
      <SidebarToggle />
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
        {renaming ? (
          <TitleField
            initial={session.title}
            onDone={(title) => {
              setRenaming(false);
              if (title !== null) {
                void controller.rename(session.sessionId, title);
              }
            }}
          />
        ) : (
          <h1
            data-no-drag
            {...noDrag}
            className="min-w-0 flex-1 cursor-text truncate overflow-hidden text-sm font-semibold text-nowrap text-ellipsis text-fg"
            title={`${displayTitle(session)} (clique duplo para renomear)`}
            onDoubleClick={() => setRenaming(true)}
          >
            {displayTitle(session)}
          </h1>
        )}
        <span className="hidden min-w-0 shrink @min-[420px]:flex">
          <ProjectChip cwd={session.cwd} />
        </span>
        {fold?.meta.branch ? (
          <span className="hidden min-w-0 items-center gap-1 text-xs text-subtle lg:flex">
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate font-mono text-2xs">{fold.meta.branch}</span>
          </span>
        ) : null}
      </div>
      {session.sandboxDisabled === true ? (
        <Tip label="Esta conversa começou com a sandbox desligada, então seus shells rodam sem confinamento">
          <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs font-medium text-warn-text">
            <ShieldOff size={12} aria-hidden="true" />
            <span className="sr-only">Sandbox desligada</span>
            <span aria-hidden="true" className="@max-[420px]:hidden">Sandbox desligada</span>
          </span>
        </Tip>
      ) : null}
      {waiting ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs font-medium text-warn-text">
          <span className="attention-pulse size-1.5 rounded-full bg-warn" aria-hidden="true" />
          <span className="@max-[420px]:hidden">Esperando você</span>
        </span>
      ) : props.running ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted" role="status">
          <Spinner size={11} className="text-accent-text" />
          <span className="@max-[420px]:hidden">{finalizing ? "Finalizando…" : "Trabalhando"}</span>
          {startedAt ? <span className="text-subtle tabular-nums">{formatDuration(now - startedAt)}</span> : null}
        </span>
      ) : thread?.readOnly ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-subtle">
          <Lock size={12} />
          <span className="@max-[420px]:hidden">Somente leitura</span>
        </span>
      ) : null}
      {props.running ? (
        <Tip label="Parar a mensagem" shortcut={["Esc"]}>
          <IconButton label="Parar a mensagem" onClick={() => void controller.stop(session.sessionId)}>
            <Square size={11} className="fill-current" />
          </IconButton>
        </Tip>
      ) : null}
      <HiddenCardsButton sessionId={session.sessionId} running={props.running} />
      <Tip label={filesOpen ? "Ocultar arquivos" : "Mostrar arquivos"} shortcut={[MOD, "Shift", "E"]}>
        <IconButton label={filesOpen ? "Ocultar arquivos" : "Mostrar arquivos"} active={filesOpen} onClick={() => controller.toggleFiles()}>
          <FolderTree size={15} />
        </IconButton>
      </Tip>
      <span className="@max-[360px]:hidden">
        <Tip label="Abrir no VS Code">
          <IconButton label="Abrir no VS Code" onClick={() => void controller.openFolder(session.cwd, "editor")}>
            <Code size={15} />
          </IconButton>
        </Tip>
      </span>
      <Menu>
        <Tip label="Mais">
          <MenuTrigger asChild>
            <IconButton label="Ações da conversa">
              <Ellipsis size={16} />
            </IconButton>
          </MenuTrigger>
        </Tip>
        <MenuContent align="end">
          <MenuItem icon={<Pencil size={14} />} onSelect={() => setRenaming(true)}>
            Renomear
          </MenuItem>
          <MenuItem icon={<Minimize2 size={14} />} onSelect={() => void controller.compact(session.sessionId)} disabled={thread?.readOnly}>
            Compactar contexto
          </MenuItem>
          <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void controller.openFolder(session.cwd, "files")}>
            {revealLabel()}
          </MenuItem>
          <MenuItem icon={<Copy size={14} />} onSelect={() => void navigator.clipboard?.writeText(session.sessionId)}>
            Copiar ID da sessão
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Archive size={14} />} onSelect={() => void controller.archive(session.sessionId)}>
            Arquivar conversa
          </MenuItem>
        </MenuContent>
      </Menu>
      <CaptionSpacer />
    </header>
  );
}

function ProjectChip(props: { cwd: string }) {
  const controller = useController();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-subtle transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
          title={props.cwd}
        >
          <Folder size={12} className="shrink-0" />
          <span className="truncate">{basename(props.cwd)}</span>
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<SquarePen size={14} />} onSelect={() => controller.newThread(props.cwd)}>
          Nova conversa em {basename(props.cwd)}
        </MenuItem>
        <MenuItem icon={<FolderOpen size={14} />} onSelect={() => void controller.openFolder(props.cwd, "files")}>
          {revealLabel()}
        </MenuItem>
        <MenuItem icon={<Code size={14} />} onSelect={() => void controller.openFolder(props.cwd, "editor")}>
          Abrir no VS Code
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function TitleField(props: { initial: string; onDone: (title: string | null) => void }) {
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
      aria-label="Título da conversa"
      defaultValue={props.initial}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          finish(null);
        }
      }}
      className="h-7 w-[min(420px,50%)] rounded-md bg-raised px-2 text-sm font-semibold text-fg outline-none shadow-[0_0_0_1.5px_var(--accent)]"
    />
  );
}

function planShown(todo: ThreadState["fold"]["meta"]["todoList"] | null | undefined, running: boolean): boolean {
  return Boolean(todo && todo.length > 0 && (running || todo.some((t) => t.status !== "completed")));
}

/** Exibido enquanto um cartão fechado pelo usuário tem algo a mostrar; traz de volta todos os cartões fechados da conversa. */
function HiddenCardsButton(props: { sessionId: string; running: boolean }) {
  const controller = useController();
  const names = useApp((s) => {
    const hidden = s.prefs.hiddenCards;
    const fold = s.threads[props.sessionId]?.fold;
    if (!fold || !hidden.some((k) => k.endsWith(`:${props.sessionId}`))) {
      return "";
    }
    const out: string[] = [];
    if (hidden.includes(`plan:${props.sessionId}`) && planShown(fold.meta.todoList, props.running)) {
      out.push("o plano");
    }
    if (hidden.includes(`goal:${props.sessionId}`) && goalView(fold) !== null) {
      out.push("a meta");
    }
    if (hidden.includes(`tasks:${props.sessionId}`) && backgroundTasks(fold).length > 0) {
      out.push("as tarefas em segundo plano");
    }
    return out.join(", ");
  });
  if (!names) {
    return null;
  }
  const label = `Mostrar ${names.replace(/, ([^,]*)$/, " e $1")}`;
  return (
    <Tip label={label}>
      <IconButton label={label} onClick={() => controller.showThreadCards(props.sessionId)}>
        <PanelBottomOpen size={15} />
      </IconButton>
    </Tip>
  );
}

function Dock(props: { session: SessionSummary; thread: ThreadState | null; running: boolean }) {
  const controller = useController();
  const { session, thread } = props;
  const fold = thread?.fold ?? null;
  const approvals = fold ? Object.values(fold.approvals) : [];
  const inputs = fold ? Object.values(fold.userInputs) : [];
  const queued = fold ? fold.echoes.filter((e) => e.disposition === "queued") : [];
  const todo = fold?.meta.todoList ?? null;
  const showPlan = planShown(todo, props.running);
  return (
    <div className="shrink-0">
      <div className="mx-auto flex w-full max-w-[776px] flex-col gap-2 px-4 pb-2 @min-[520px]:px-6">
        {thread?.readOnly ? (
          <ReadOnlyNotice
            reason={thread.readOnlyReason}
            busy={thread.load === "loading"}
            onRetry={() => void controller.loadThread(session.sessionId)}
          />
        ) : null}
        {thread?.stalled && !thread.readOnly && approvals.length === 0 && inputs.length === 0 ? (
          <StalledNotice
            busy={thread.load === "loading"}
            onRetry={() => void controller.retryStalledThread(session.sessionId)}
          />
        ) : null}
        {approvals.map((request, index) => (
          <ApprovalPanel key={request.approvalId} request={request} primary={index === 0} />
        ))}
        {inputs.map((request, index) => (
          <QuestionPanel key={request.userInputId} request={request} keyboard={approvals.length === 0 && index === 0} />
        ))}
        {fold && !thread?.readOnly ? <BackgroundTasks sessionId={session.sessionId} /> : null}
        <GoalPanel sessionId={session.sessionId} running={props.running} readOnly={Boolean(thread?.readOnly)} />
        {showPlan && todo ? <PlanPanel sessionId={session.sessionId} items={todo} /> : null}
        {queued.length > 0 ? <QueuedList sessionId={session.sessionId} items={queued} /> : null}
        <TelemetryPills sessionId={session.sessionId} />
        <Composer
          sessionId={session.sessionId}
          cwd={session.cwd}
          running={props.running}
          readOnly={Boolean(thread?.readOnly)}
          variant="thread"
          autoFocus
        />
        <ComposerFooter cwd={session.cwd} branch={fold?.meta.branch ?? null} running={props.running} />
      </div>
    </div>
  );
}

/** Chamadas de ferramenta ainda executando após irem para o segundo plano, com um jeito de parar todas. */
function BackgroundTasks(props: { sessionId: string }) {
  const controller = useController();
  const count = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold ? backgroundTasks(fold).length : 0;
  });
  const busy = useApp((s) => Boolean(s.busy[`task:${props.sessionId}:all`]));
  const hidden = useApp((s) => s.prefs.hiddenCards.includes(`tasks:${props.sessionId}`));
  if (count === 0 || hidden) {
    return null;
  }
  return (
    <div role="status" className="flex items-center gap-2 rounded-xl bg-raised px-3 py-1.5 text-xs text-muted shadow-card">
      <Spinner size={11} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1 truncate">
        {count === 1 ? "1 tarefa executando em segundo plano" : `${count} tarefas executando em segundo plano`}
      </span>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" loading={busy} onClick={() => void controller.taskAction(props.sessionId, "stopAll")}>
        <CircleStop size={12} /> Parar todas
      </Button>
      <CloseCard label="Ocultar tarefas em segundo plano" onClose={() => controller.setCardHidden(`tasks:${props.sessionId}`, true)} />
    </div>
  );
}

function MissingThread() {
  const controller = useController();
  const drag = useOverlayDragProps();
  return (
    <div className="flex h-full flex-1 flex-col">
      <header data-drag-region {...drag} className="flex h-12 items-center px-3">
        <TrafficLightSpacer />
        <SidebarToggle />
        <CaptionSpacer />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-[12vh] text-center">
        <p className="font-display text-2xl text-fg">Esta conversa não está mais aqui</p>
        <p className="max-w-[40ch] text-sm text-muted">Ela pode ter sido arquivada ou removida com seu projeto.</p>
        <button type="button" className="mt-2 text-sm font-medium text-accent-text hover:underline" onClick={() => controller.newThread()}>
          Começar uma nova conversa
        </button>
      </div>
    </div>
  );
}
