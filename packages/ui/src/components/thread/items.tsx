import {
  ArrowDownToLine,
  Bot,
  ChevronRight,
  CircleAlert,
  CircleStop,
  FilePen,
  FileSearch,
  FilePlus,
  FileText,
  FolderTree,
  Globe,
  ListTodo,
  Minimize2,
  MessageCircleQuestion,
  Search,
  Send,
  SquareTerminal,
  Target,
  Wrench,
} from "lucide-react";
import { Popover } from "radix-ui";
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp, useController } from "../../app/context.js";
import { fileTarget } from "../../model/files.js";
import {
  basename,
  describeTool,
  diffLines,
  diffStats,
  extractDiff,
  formatDuration,
  formatTokens,
  humanize,
  lastLine,
  mergeDiffLines,
  parseArgs,
  withoutDiffEcho,
  type DiffLine,
  type DiffView,
  type ToolKind,
} from "../../model/format.js";
import type { MspItem, OutputRef, UserInputAnswer } from "../../types.js";
import { CodeBlock, Markdown, highlightCode, languageFromPath } from "../ui/Markdown.js";
import { Button, IconButton, Shimmer, Spinner, cn } from "../ui/primitives.js";
import { Collapse } from "../ui/sourced.js";
import { FLOATING, Tip } from "../ui/overlays.js";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const TERMINAL_FAILURES = new Set(["failed", "rejected", "cancelled", "timedOut"]);

export type Gate = "approval" | "input";

const TOOL_ICONS: Record<ToolKind, (props: { size: number; className?: string }) => ReactNode> = {
  shell: (p) => <SquareTerminal {...p} />,
  read: (p) => <FileText {...p} />,
  edit: (p) => <FilePen {...p} />,
  write: (p) => <FilePlus {...p} />,
  search: (p) => <Search {...p} />,
  list: (p) => <FolderTree {...p} />,
  web: (p) => <Globe {...p} />,
  question: (p) => <MessageCircleQuestion {...p} />,
  plan: (p) => <ListTodo {...p} />,
  agent: (p) => <Bot {...p} />,
  goal: (p) => <Target {...p} />,
  generic: (p) => <Wrench {...p} />,
};

/**
 * Uma linha do registro de trabalho: ícone, rótulo, um chip embutido para em que agiu, e um corpo expansível.
 * Pairar troca o ícone pela seta de abrir.
 * Layout via Beautiful UI ToolChips (beautifului.dev), MIT (c) 2026 Shane Levine.
 * Adaptado: tokens do Helicon, ícones lucide, dados reais de ferramenta, corpo Collapse.
 */
function Row(props: {
  icon: ReactNode;
  label: ReactNode;
  chip?: ReactNode;
  mono?: boolean;
  detail?: ReactNode;
  trailing?: ReactNode;
  body?: ReactNode;
  preview?: ReactNode;
  tone?: "default" | "warn" | "danger";
  /** Começa expandido, para saída que o usuário pediu para ver. */
  defaultOpen?: boolean;
  /** Controles ao lado da linha, fora de seu botão de abrir para cada um ser seu próprio controle. */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const expandable = Boolean(props.body);
  const toggle = (
    <button
      type="button"
      disabled={!expandable}
      aria-expanded={expandable ? open : undefined}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "group/row flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-lg px-1.5 text-left transition-colors duration-100 enabled:hover:bg-hover disabled:cursor-default",
        props.actions ? "flex-1" : "-mx-1.5 w-[calc(100%+0.75rem)]",
      )}
    >
        <span
          className={cn(
            "relative flex size-4 shrink-0 items-center justify-center",
            props.tone === "warn" ? "text-warn" : props.tone === "danger" ? "text-danger" : "text-subtle",
          )}
        >
          <span
            className={cn(
              "flex transition-opacity duration-100",
              expandable && "group-hover/row:opacity-0 group-focus-visible/row:opacity-0",
              expandable && open && "opacity-0",
            )}
          >
            {props.icon}
          </span>
          {expandable ? (
            <ChevronRight
              size={13}
              strokeWidth={2.2}
              className={cn(
                "absolute text-subtle opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
                open && "rotate-90 opacity-100",
              )}
            />
          ) : null}
        </span>
        <span className={cn("shrink-0 text-sm font-medium", props.tone === "danger" ? "text-danger-text" : "text-fg")}>{props.label}</span>
        {props.chip ? (
          <span
            className={cn(
              "min-w-0 truncate rounded-md bg-sunken px-1.5 py-[3px] text-xs leading-4 text-muted shadow-[0_0_0_1px_var(--border)]",
              props.mono && "font-mono text-[11.5px]",
            )}
          >
            {props.chip}
          </span>
        ) : null}
        {props.detail ? <span className="min-w-0 truncate text-sm text-subtle">{props.detail}</span> : null}
        <span className="min-w-2 flex-1" />
        {props.trailing}
    </button>
  );
  return (
    <div className="enter-up">
      {props.actions ? (
        <div className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-1">
          {toggle}
          <div className="flex shrink-0 items-center gap-0.5 pr-0.5">{props.actions}</div>
        </div>
      ) : (
        toggle
      )}
      {!open && props.preview ? <div className="ml-6 pb-1">{props.preview}</div> : null}
      {expandable ? (
        <Collapse open={open}>
          <div className="mt-0.5 mb-2 ml-[7px] flex flex-col gap-2 border-l border-line py-0.5 pl-[17px]">{props.body}</div>
        </Collapse>
      ) : null}
    </div>
  );
}

/** Quanto de saída guardada um "mostrar mais" carrega, e o máximo que uma linha guarda antes de mandar você ao arquivo. */
const OUTPUT_PAGE_LIMIT = 4 * 1024 * 1024;

/** De onde os bytes completos de uma saída cortada podem ser lidos, quando o Muse os guardou. */
export interface StoredOutput {
  sessionId: string;
  itemId: string;
  ref: OutputRef;
}

export function OutputBlock(props: { text: string; truncated?: boolean; label?: string; stored?: StoredOutput | null }) {
  const controller = useController();
  const [full, setFull] = useState<{ text: string; next: number; eof: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = full ? full.text : props.text;
  // The shown bytes only change when the page does; stripping them again every flush would cost the whole log.
  const clean = useMemo(() => shown.replace(ANSI, "").replace(/\s+$/, ""), [shown]);
  if (!clean) {
    return null;
  }
  const stored = props.truncated && props.stored?.ref.availability !== "unavailable" ? props.stored : null;
  // Página até o fim ou o teto, para um log descontrolado não travar a conversa onde aparece.
  const load = async () => {
    if (!stored || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let text = full?.text ?? "";
      let offset = full?.next ?? 0;
      let eof = false;
      while (!eof && offset < OUTPUT_PAGE_LIMIT + (full?.next ?? 0)) {
        const page = await controller.readOutput(stored.sessionId, stored.itemId, stored.ref.id, offset);
        text += page.encoding === "base64" ? "[saída binária]" : page.content;
        offset = page.offsetBytes + page.byteLen;
        eof = page.eof || page.byteLen === 0;
      }
      setFull({ text, next: offset, eof });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  };
  const total = stored?.ref.byteLen;
  return (
    <div className="overflow-hidden rounded-lg bg-sunken shadow-[0_0_0_1px_var(--border)]">
      {props.label ? <div className="px-3 pt-2 font-sans text-2xs font-medium text-subtle">{props.label}</div> : null}
      <pre className="max-h-72 overflow-x-hidden overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
        {clean}
      </pre>
      {props.truncated && !full?.eof ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1.5">
          <p className="min-w-0 flex-1 text-2xs text-subtle">
            {error ? (
              <span className="text-danger-text">{error}</span>
            ) : full ? (
              `Mostrando os primeiros ${formatBytes(full.next)}${total ? ` de ${formatBytes(total)}` : ""}.`
            ) : stored ? (
              `A saída foi cortada aqui${total ? `; o log completo tem ${formatBytes(total)}` : ""}.`
            ) : (
              "A saída foi cortada aqui; o log completo está na sessão do Muse."
            )}
          </p>
          {stored ? (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" loading={loading} onClick={() => void load()}>
              {full ? "Mostrar mais" : "Mostrar saída completa"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** O ponteiro de saída guardada num item, quando sua visão foi cortada e o Muse guardou o resto. */
function storedOutput(item: MspItem, sessionId: string | undefined): StoredOutput | null {
  const ref = item.outputRef;
  return sessionId && item.truncated && ref && typeof ref.id === "string" ? { sessionId, itemId: item.itemId, ref } : null;
}

/**
 * Levar uma chamada de ferramenta em execução para o segundo plano, ou parar uma que já roda lá. O Muse nomeia a tarefa pelo
 * próprio id de item da chamada de ferramenta. Oculto em conversas que outro cliente segura, onde o Muse recusaria o comando.
 */
/** Abre um arquivo que uma ferramenta tocou no visualizador de arquivos ao lado da conversa. */
function OpenFileAction(props: { sessionId: string; path: string }) {
  const controller = useController();
  const cwd = useApp((s) => s.sessions[props.sessionId]?.cwd ?? null);
  const target = cwd ? fileTarget(props.path, cwd) : null;
  if (!target) {
    return null;
  }
  return (
    <Tip label="Abrir nos arquivos">
      <IconButton size="sm" label={`Abrir ${target.path}`} onClick={() => controller.openFile(props.sessionId, target.path, target.line)}>
        <FileSearch size={13} />
      </IconButton>
    </Tip>
  );
}

function TaskActions(props: { item: MspItem; sessionId: string }) {
  const controller = useController();
  const { item, sessionId } = props;
  const readOnly = useApp((s) => s.threads[sessionId]?.readOnly ?? true);
  const busy = useApp((s) => Boolean(s.busy[`task:${sessionId}:${item.itemId}`]));
  if (readOnly || item.status !== "inProgress") {
    return null;
  }
  return item.background ? (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-xs"
      loading={busy}
      onClick={() => void controller.taskAction(sessionId, "stop", item.itemId)}
    >
      <CircleStop size={12} /> Parar
    </Button>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-xs"
      loading={busy}
      title="Deixar isto executando enquanto o Muse segue adiante"
      onClick={() => void controller.taskAction(sessionId, "background", item.itemId)}
    >
      <ArrowDownToLine size={12} /> Segundo plano
    </Button>
  );
}

export function DiffBlock(props: { diff: DiffView }) {
  // Sem cabeçalho: a linha de recibo acima, ou o chip pairado, já nomeia o arquivo e seus totais.
  // Um diff é código, então ganha as mesmas cores que um bloco de código ganha; a linguagem vem do nome do arquivo.
  return <DiffCard lines={diffLines(props.diff)} language={languageFromPath(props.diff.path)} />;
}

/** Toda mudança de um arquivo pairado como um cartão contínuo único, em ordem de mensagem. */
function FileDiffCard(props: { diffs: DiffView[] }) {
  return <DiffCard lines={mergeDiffLines(props.diffs)} language={languageFromPath(props.diffs[0]?.path ?? null)} />;
}

function DiffCard(props: { lines: DiffLine[]; language: string | null }) {
  const { lines, language } = props;
  return (
    <div className="overflow-hidden rounded-lg bg-sunken shadow-[0_0_0_1px_var(--border)]">
      <div className="max-h-80 overflow-x-hidden overflow-y-auto py-1 font-mono text-xs leading-[1.65]">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex pr-3",
              line.kind === "add" && "bg-diff-add",
              line.kind === "del" && "bg-diff-del",
              line.kind === "meta" && "text-subtle",
            )}
          >
            <span
              className={cn(
                "w-6 shrink-0 text-center select-none",
                line.kind === "add" ? "text-ok-text" : line.kind === "del" ? "text-danger-text" : "text-subtle",
              )}
              aria-hidden="true"
            >
              {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]",
                line.kind === "ctx" || line.kind === "meta" ? "text-muted" : "text-fg",
              )}
            >
              {line.kind === "meta" ? line.text || " " : <DiffText text={line.text} language={language} />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** O código de uma linha de diff, colorido quando a linguagem do arquivo é uma que o sugar-high conhece. */
const DiffText = memo(function DiffText(props: { text: string; language: string | null }) {
  const html = useMemo(() => highlightCode(props.text, props.language), [props.text, props.language]);
  if (html === null) {
    return <>{props.text || " "}</>;
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
});

export function DiffCount(props: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-2xs tabular-nums">
      <span className="text-ok-text">+{props.added}</span> <span className="text-danger-text">-{props.removed}</span>
    </span>
  );
}

interface FileChanges {
  path: string;
  added: number;
  removed: number;
  diffs: DiffView[];
}

/**
 * Os arquivos que uma mensagem mudou, como chips; paire ou foque um para prever seu diff.
 * via chips de diff de arquivo do Beautiful UI ToolChips (beautifului.dev), MIT (c) 2026 Shane Levine.
 * Adaptado: Radix Popover para acesso por teclado em vez de um portal posicionado à mão.
 */
export function DiffChips(props: { entries: MspItem[]; className?: string; sessionId?: string }) {
  const files = useMemo(() => {
    const byPath = new Map<string, FileChanges>();
    for (const item of props.entries) {
      if (item.kind !== "toolCall") {
        continue;
      }
      const diff = extractDiff(item);
      if (!diff) {
        continue;
      }
      const key = diff.path ?? item.itemId;
      const stats = diffStats(diff);
      const entry = byPath.get(key) ?? { path: diff.path ?? "arquivo", added: 0, removed: 0, diffs: [] };
      entry.added += stats.added;
      entry.removed += stats.removed;
      entry.diffs.push(diff);
      byPath.set(key, entry);
    }
    return [...byPath.values()];
  }, [props.entries]);
  if (files.length === 0) {
    return null;
  }
  return (
    <div className={cn("flex max-w-full flex-wrap gap-1.5", props.className)} aria-label="Arquivos alterados">
      {files.map((file) => (
        <DiffChip key={file.path} file={file} sessionId={props.sessionId} />
      ))}
    </div>
  );
}

function DiffChip(props: { file: FileChanges; sessionId?: string }) {
  const controller = useController();
  const cwd = useApp((s) => (props.sessionId ? (s.sessions[props.sessionId]?.cwd ?? null) : null));
  const target = cwd ? fileTarget(props.file.path, cwd) : null;
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const show = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    setOpen(true);
  };
  const hide = () => {
    timer.current = window.setTimeout(() => setOpen(false), 140);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          title={props.file.path}
          className="inline-flex h-7 max-w-full items-center gap-2 rounded-lg bg-raised px-2 font-mono text-[11.5px] text-fg shadow-btn transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover"
        >
          <FilePen size={12} className="shrink-0 text-subtle" />
          <span className="min-w-0 truncate">{basename(props.file.path)}</span>
          <DiffCount added={props.file.added} removed={props.file.removed} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          {...FLOATING}
          onMouseEnter={show}
          onMouseLeave={hide}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="pop z-[var(--z-dropdown)] flex max-h-[60vh] w-[min(560px,calc(100dvw-32px))] flex-col gap-2 overflow-y-auto rounded-xl bg-raised p-2 shadow-pop outline-none"
        >
          {target && props.sessionId ? (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="min-w-0 truncate font-mono text-2xs text-subtle">{target.path}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={() => {
                  setOpen(false);
                  controller.openFile(props.sessionId!, target.path);
                }}
              >
                <FileSearch size={12} /> Abrir arquivo
              </Button>
            </div>
          ) : null}
          <FileDiffCard diffs={props.file.diffs} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function QuestionSummary(props: { item: MspItem; answers: UserInputAnswer[] | null }) {
  const args = parseArgs(props.item.args);
  const questions = args && Array.isArray(args["questions"]) ? (args["questions"] as Record<string, unknown>[]) : [];
  return (
    <div className="flex flex-col gap-2 text-sm">
      {questions.map((q, i) => {
        const id = typeof q["id"] === "string" ? q["id"] : String(i);
        const answer = props.answers?.find((a) => a.questionId === id);
        const chosen = answer?.selectedLabel ?? answer?.selectedLabels?.join(", ") ?? answer?.freeText ?? null;
        return (
          <div key={id}>
            <p className="text-muted">{typeof q["question"] === "string" ? q["question"] : "Pergunta"}</p>
            <p className="mt-0.5 font-medium text-fg">{chosen ?? (props.answers ? "Ignorada" : "Esperando sua resposta")}</p>
          </div>
        );
      })}
    </div>
  );
}

export const ToolRow = memo(function ToolRow(props: { item: MspItem; gate?: Gate; answers?: UserInputAnswer[] | null; sessionId?: string }) {
  const { item } = props;
  const d = useMemo(() => describeTool(item), [item]);
  const diff = useMemo(() => (d.kind === "edit" || d.kind === "write" ? extractDiff(item) : null), [d.kind, item]);
  const running = item.status === "inProgress";
  const failed = TERMINAL_FAILURES.has(item.status);
  const stats = diff ? diffStats(diff) : null;
  const Icon = TOOL_ICONS[d.kind];
  const args = parseArgs(item.args);

  let trailing: ReactNode = null;
  if (props.gate) {
    trailing = (
      <span className="shrink-0 text-xs font-medium text-warn-text">
        {props.gate === "approval" ? "Esperando aprovação" : "Esperando sua resposta"}
      </span>
    );
  } else if (running) {
    trailing = item.background ? (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-subtle">
        <Spinner size={12} className="text-accent-text" label="Executando em segundo plano" /> Em segundo plano
      </span>
    ) : (
      <Spinner size={12} className="text-accent-text" label="Executando" />
    );
  } else if (failed) {
    trailing = <span className="shrink-0 text-xs text-danger-text">{humanize(item.status)}</span>;
  } else if (stats) {
    trailing = <DiffCount added={stats.added} removed={stats.removed} />;
  }

  const body: ReactNode[] = [];
  if (d.note) {
    body.push(
      <p key="note" className="text-xs text-muted">
        {d.note}
      </p>,
    );
  }
  if (d.kind === "question") {
    body.push(<QuestionSummary key="q" item={item} answers={props.answers ?? null} />);
  } else {
    if (d.kind === "shell" && d.subject && d.subject.includes("\n")) {
      body.push(<CodeBlock key="cmd" code={d.subject} language="bash" className="my-0" />);
    }
    if (diff) {
      body.push(<DiffBlock key="diff" diff={diff} />);
    }
    if (item.visibleOutput) {
      // O runtime ecoa a edição abaixo de seu cabeçalho de resultado, sem alinhar; o diff acima já mostra
      // aquela mudança direito, então só o resto que a saída trouxe fica visível.
      const stripped =
        diff && (d.kind === "edit" || d.kind === "write") && !item.truncated ? withoutDiffEcho(item.visibleOutput) : null;
      const text = stripped ?? item.visibleOutput;
      if (text.trim().length > 0) {
        body.push(
          <OutputBlock
            key="out"
            text={text}
            truncated={item.truncated}
            label={d.kind === "shell" ? "Saída" : undefined}
            stored={storedOutput(item, props.sessionId)}
          />,
        );
      }
    }
    if (d.kind === "generic" && args) {
      body.push(<CodeBlock key="args" code={JSON.stringify(args, null, 2)} language="json" className="my-0" />);
    }
  }
  if (item.failureReason) {
    body.push(
      <p key="fail" className="flex items-start gap-1.5 text-xs text-danger-text">
        <CircleAlert size={13} className="mt-px shrink-0" /> {item.failureReason}
      </p>,
    );
  }

  const tail = running && d.kind === "shell" ? lastLine(item.visibleOutput) : null;
  return (
    <Row
      icon={<Icon size={14} />}
      tone={props.gate ? "warn" : failed ? "danger" : "default"}
      label={d.verb}
      chip={d.subject ? d.subject.split("\n")[0] : undefined}
      mono={d.mono}
      trailing={trailing}
      body={body.length > 0 ? body : undefined}
      preview={tail ? <p className="truncate font-mono text-2xs text-subtle">{tail}</p> : undefined}
      actions={
        props.sessionId && running && !props.gate ? (
          <TaskActions item={item} sessionId={props.sessionId} />
        ) : props.sessionId && !running && (d.kind === "read" || d.kind === "edit" || d.kind === "write") && d.subject ? (
          <OpenFileAction sessionId={props.sessionId} path={d.subject.split("\n")[0]!} />
        ) : undefined
      }
    />
  );
});

export const ReasoningRow = memo(function ReasoningRow(props: { item: MspItem }) {
  const { item } = props;
  const summary = (item.summary ?? []).filter((part) => part.trim().length > 0);
  const text = summary.length > 0 ? summary.join("\n\n") : (item.text ?? "");
  const running = item.status === "inProgress";
  const headline =
    (summary[summary.length - 1] ?? text)
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/\*\*/g, "") ?? "";
  return (
    <Row
      icon={running ? <Spinner size={11} /> : <span className="size-1.5 rounded-full bg-[var(--border-strong)]" />}
      label={running ? <Shimmer>Pensando</Shimmer> : <span className="text-muted">Pensou</span>}
      detail={headline || undefined}
      body={text ? <Markdown text={text} className="text-sm text-muted" /> : undefined}
    />
  );
});

export const ShellRow = memo(function ShellRow(props: { item: MspItem; sessionId?: string }) {
  const { item } = props;
  const running = item.status === "inProgress";
  const code = item.exitCode;
  // Um comando que o Muse não conseguiu iniciar (sem sandbox, digamos) falha sem código de saída; sua saída diz por quê.
  const failed = (code !== undefined && code !== 0) || TERMINAL_FAILURES.has(item.status);
  // O Muse 1.1.1 não tem sandbox para comandos `!` sob `muse serve` no WSL, embora a ferramenta shell do próprio agente funcione lá.
  const noSandbox = failed && /shell sandbox is unavailable/i.test(item.visibleOutput ?? "");
  return (
    <Row
      icon={<SquareTerminal size={14} />}
      label="Você executou"
      chip={item.commandText ?? "um comando"}
      mono
      defaultOpen
      tone={failed ? "danger" : "default"}
      trailing={
        running ? (
          <Spinner size={12} className="text-accent-text" label="Executando" />
        ) : code !== undefined && code !== 0 ? (
          <span className="text-xs text-danger-text">Saída {code}</span>
        ) : failed ? (
          <span className="text-xs text-danger-text">Não executado</span>
        ) : item.durationMs ? (
          <span className="text-2xs text-subtle tabular-nums">{formatDuration(item.durationMs)}</span>
        ) : null
      }
      body={
        item.visibleOutput ? (
          <>
            <OutputBlock text={item.visibleOutput} truncated={item.truncated} stored={storedOutput(item, props.sessionId)} />
            {noSandbox ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="text-xs text-pretty text-muted">
                  O Muse não consegue isolar comandos <code className="font-mono">!</code> quando o Helicon o hospeda, então este nem
                  começou. O shell do próprio agente funciona.
                </p>
                {props.sessionId && item.commandText ? <AskToRun sessionId={props.sessionId} command={item.commandText} /> : null}
              </div>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
});

function AskToRun(props: { sessionId: string; command: string }) {
  const controller = useController();
  const [sending, setSending] = useState(false);
  // Um pedido por clique: um segundo envio executaria o mesmo comando duas vezes.
  const ask = () => {
    if (sending) {
      return;
    }
    setSending(true);
    void controller.askToRun(props.sessionId, props.command).finally(() => setSending(false));
  };
  return (
    <Button size="sm" variant="secondary" loading={sending} onClick={ask}>
      Pedir ao Muse para executar
    </Button>
  );
}

export const SubagentRow = memo(function SubagentRow(props: { item: MspItem; sessionId?: string }) {
  const { item } = props;
  const running = item.status === "inProgress";
  const result = item.result?.summary ?? item.result?.text ?? null;
  // O Muse chama um subagente por seu id durável; uma build que não informa um fica sem controles.
  const controls = props.sessionId && item.subagentId ? <SubagentControls item={item} sessionId={props.sessionId} subagentId={item.subagentId} /> : null;
  return (
    <Row
      icon={<Bot size={14} />}
      label={running ? "Subagente trabalhando em" : "Subagente"}
      detail={item.objective ?? item.role ?? "uma tarefa"}
      tone={TERMINAL_FAILURES.has(item.status) ? "danger" : "default"}
      trailing={
        running ? (
          <Spinner size={12} className="text-accent-text" label="Executando" />
        ) : item.usage?.outputTokens ? (
          <span className="text-2xs text-subtle tabular-nums">{formatTokens((item.usage.inputTokens ?? 0) + item.usage.outputTokens)} tokens</span>
        ) : null
      }
      body={
        result || item.failureReason || controls ? (
          <>
            {result ? <Markdown text={result} className="text-sm" /> : null}
            {item.failureReason ? <p className="text-xs text-danger-text">{item.failureReason}</p> : null}
            {controls}
          </>
        ) : undefined
      }
    />
  );
});

/** O que `subagent/*` permite para o estado em que o filho está: falar com um em execução, ou trazer um terminado de volta. */
function SubagentControls(props: { item: MspItem; sessionId: string; subagentId: string }) {
  const controller = useController();
  const { item, sessionId, subagentId } = props;
  const readOnly = useApp((s) => s.threads[sessionId]?.readOnly ?? true);
  const busy = useApp((s) => Boolean(s.busy[`subagent:${sessionId}:${subagentId}`]));
  const [note, setNote] = useState("");
  if (readOnly) {
    return null;
  }
  const control = item.controlStatus ?? "";
  const running = item.status === "inProgress" || control === "running" || control === "starting";
  const act = (action: import("../../types.js").SubagentAction, body?: string) =>
    void controller.subagentAction(sessionId, action, subagentId, body).then((ok) => {
      if (ok && body) {
        setNote("");
      }
    });
  const send = () => {
    const text = note.trim();
    if (text) {
      act(running ? "sendMessage" : "followupTask", text);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={busy}
          aria-label={running ? "Mandar mensagem a este subagente" : "Dar a este subagente uma tarefa de retorno"}
          placeholder={running ? "Diga algo a este subagente" : "Dê a ele uma tarefa de retorno"}
          className="h-7 min-w-0 flex-1 rounded-md bg-sunken px-2 text-sm text-fg shadow-[0_0_0_1px_var(--border)] outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_1px_var(--accent)]"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!note.trim()} loading={busy}>
          <Send size={12} /> Enviar
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1">
        {running ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("interrupt")}>
              Pausar no próximo passo
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("stop")}>
              <CircleStop size={13} /> Parar
            </Button>
          </>
        ) : null}
        {control === "resultReady" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("readResult")}>
            Pegar o resultado
          </Button>
        ) : null}
        {control === "recoveryPending" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("resume")}>
            Retomar
          </Button>
        ) : null}
        {!running && (control === "closed" || TERMINAL_FAILURES.has(item.status)) ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("reopen")}>
            Reabrir
          </Button>
        ) : null}
        {!running && control !== "closed" && control !== "closing" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("close")}>
            Fechar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CompactionRow(props: { item: MspItem }) {
  const { item } = props;
  const running = item.status === "inProgress";
  const saved =
    item.tokensBefore !== undefined && item.tokensAfter !== undefined
      ? `${formatTokens(item.tokensBefore)} para ${formatTokens(item.tokensAfter)} tokens`
      : null;
  const label = running
    ? "Compactando contexto"
    : item.outcome === "noop"
      ? "Nada para compactar"
      : item.outcome === "failed"
        ? "Compactação de contexto falhou"
        : "Contexto compactado";
  return (
    <div className="my-1 flex items-center gap-3 text-xs text-subtle" role="note">
      <span className="h-px flex-1 bg-line" />
      <span className="flex items-center gap-1.5">
        {running ? <Spinner size={10} /> : <Minimize2 size={12} />}
        {label}
        {saved ? <span className="tabular-nums">({saved})</span> : null}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function GenericRow(props: { item: MspItem }) {
  const { item } = props;
  return (
    <Row
      icon={<Wrench size={14} />}
      label={humanize(item.kind)}
      detail={item.fallbackText}
      trailing={item.status === "inProgress" ? <Spinner size={12} /> : null}
      body={item.text ? <Markdown text={item.text} className="text-sm" /> : undefined}
    />
  );
}

export function SteerBubble(props: { item: MspItem }) {
  return (
    <div className="enter-up flex flex-col items-end gap-1">
      <span className="text-2xs font-medium text-subtle">Você adicionou</span>
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-active px-3.5 py-2 text-sm whitespace-pre-wrap text-fg">
        {props.item.displayText ?? props.item.text}
      </div>
    </div>
  );
}

export function AgentText(props: { item: MspItem; streaming?: boolean }) {
  return <Markdown text={props.item.text ?? ""} stream={props.streaming} className={cn(props.streaming && "streaming")} />;
}
