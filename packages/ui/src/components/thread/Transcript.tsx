import { ArrowDown, ChevronRight, CircleAlert, GitFork, RotateCcw, RotateCw, Square, SquarePen, SquareTerminal, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { useApp, useController, useNow } from "../../app/context.js";
import { useSampled } from "../../app/sampled.js";
import { buildTurns, type EchoAttachment, type LocalEcho, type ThreadFold, type TurnView } from "../../model/fold.js";
import { forkPoints, type ForkPoint } from "../../model/fork.js";
import {
  describeTool,
  formatClock,
  formatDuration,
  formatFullDate,
  formatSpeed,
  formatTokens,
  parseArgs,
  stripAttachmentMentions,
  stripImageMarkers,
  toolKind,
} from "../../model/format.js";
import { streamingSpeed, turnCosts, turnSpeeds, type TurnCost, type TurnSpeed } from "../../model/usage.js";
import { formatCost } from "../../model/pricing.js";
import { EMPTY_TURN_ERROR, stuckThread, turnErrorCopy } from "../../model/errors.js";
import type { ThreadState } from "../../model/store.js";
import type { AttachmentView, MspItem, OutgoingAttachment, ShellRun, UserInputAnswer } from "../../types.js";
import { CodeBlock, FileLinksContext, type FileLinks } from "../ui/Markdown.js";
import { fileTarget } from "../../model/files.js";
import { SentAttachments, refetchAttachments, toOutgoing, toPreview } from "../composer/attachments.js";
import { CopyButton } from "../ui/Markdown.js";
import { Menu, MenuContent, MenuItem, MenuTrigger, Modal, Tip } from "../ui/overlays.js";
import { Button, IconButton, Shimmer, Spinner, cn } from "../ui/primitives.js";
import { Collapse, PixelLoader } from "../ui/sourced.js";
import {
  AgentText,
  CompactionRow,
  DiffChips,
  GenericRow,
  ReasoningRow,
  ShellRow,
  SteerBubble,
  SubagentRow,
  ToolRow,
  type Gate,
} from "./items.js";
import { WorkflowCard } from "./WorkflowCard.js";

type GateMap = Record<string, Gate>;
type AnswerMap = Record<string, UserInputAnswer[]>;

function gateMap(fold: ThreadFold): GateMap {
  const map: GateMap = {};
  for (const approval of Object.values(fold.approvals)) {
    if (approval.itemId) {
      map[approval.itemId] = "approval";
    }
  }
  for (const input of Object.values(fold.userInputs)) {
    if (input.itemId) {
      map[input.itemId] = "input";
    }
  }
  return map;
}

function answerMap(fold: ThreadFold): AnswerMap {
  const map: AnswerMap = {};
  for (const [id, settled] of Object.entries(fold.settled)) {
    map[id] = settled.answers;
  }
  return map;
}

export function Transcript(props: { sessionId: string; thread: ThreadState }) {
  const { thread } = props;
  const fold = thread.fold;
  const turns = useMemo(() => buildTurns(fold), [fold]);
  const gates = useMemo(() => gateMap(fold), [fold.approvals, fold.userInputs]);
  const answers = useMemo(() => answerMap(fold), [fold.settled]);
  const speeds = useMemo(() => turnSpeeds(fold), [fold.meta.calls, fold.turns, fold.activeTurnId]);
  const models = useApp((s) => s.models);
  const controller = useController();
  const cwd = useApp((s) => s.sessions[props.sessionId]?.cwd ?? null);
  // Caminhos que o Muse menciona numa resposta abrem no visualizador de arquivos em vez de uma aba do navegador.
  const links = useMemo<FileLinks | null>(
    () =>
      cwd
        ? {
            resolve: (href) => fileTarget(href, cwd),
            open: (target) => controller.openFile(props.sessionId, target.path, target.line),
            imageUrl: (src) => {
              const target = fileTarget(src, cwd);
              return target ? controller.fileUrl(cwd, target.path) : null;
            },
          }
        : null,
    [controller, cwd, props.sessionId],
  );
  const costs = useMemo(() => turnCosts(fold, models), [fold.meta.calls, models]);
  const echoes = fold.echoes.filter((e) => e.disposition !== "queued");
  // Arquivos que o servidor guardou para esta conversa, agrupados pela mensagem com que foram enviados.
  // Mensagens e os comandos que o Helicon executou dividem uma linha do tempo: a saída de um comando causou o pedido após ele.
  const timeline = useMemo(() => {
    let last = 0;
    const blocks = turns.map((turn, index) => {
      const at = sentTime(turn) ?? completedTime(turn) ?? last + 1;
      last = at;
      return { kind: "turn" as const, at, turn, index };
    });
    const runs = (thread.shellRuns ?? []).map((run) => ({ kind: "run" as const, at: Date.parse(run.at) || 0, run }));
    return [...blocks, ...runs].sort((a, b) => a.at - b.at);
  }, [turns, thread.shellRuns]);

  const attachmentsByTurn = useMemo(() => {
    const map: Record<string, AttachmentView[]> = {};
    for (const file of thread.attachments ?? []) {
      const key = file.turnId ?? "";
      (map[key] ??= []).push(file);
    }
    return map;
  }, [thread.attachments]);
  const forks = useMemo(
    () => forkPoints(turns, thread.truncated, (id) => (attachmentsByTurn[id]?.length ?? 0) > 0),
    [turns, thread.truncated, attachmentsByTurn],
  );
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ initial: "instant", resize: "smooth" });

  // O dock abaixo cresce quando um pedido ou painel aparece, o que encolhe esta visão. Acompanhe para baixo para a
  // última coisa que o Muse disse nunca ficar cortada atrás do cartão que pergunta sobre ela.
  const requests = Object.keys(fold.approvals).length + Object.keys(fold.userInputs).length;
  useEffect(() => {
    if (requests > 0) {
      void scrollToBottom();
    }
  }, [requests, scrollToBottom]);
  const atBottom = useRef(isAtBottom);
  atBottom.current = isAtBottom;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const next = element.clientHeight;
      if (next < height && atBottom.current) {
        void scrollToBottom();
      }
      height = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef, scrollToBottom]);

  const empty = turns.length === 0 && echoes.length === 0;
  return (
    <FileLinksContext.Provider value={links}>
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]">
          <div ref={contentRef} className="mx-auto flex w-full max-w-[776px] flex-col gap-8 px-4 pt-8 pb-10 @min-[520px]:px-6">
            {thread.truncated ? (
              <p className="text-center text-xs text-subtle">Mensagens anteriores não aparecem. Abra a sessão no Muse para ver o histórico completo.</p>
            ) : null}
            {thread.load === "loading" && empty ? <TranscriptSkeleton /> : null}
            {timeline.map((entry) =>
              entry.kind === "turn" ? (
                <TurnBlock
                  key={entry.turn.key}
                  turn={entry.turn}
                  gates={gates}
                  answers={answers}
                  attachments={attachmentsByTurn}
                  sessionId={props.sessionId}
                  isLast={entry.index === turns.length - 1}
                  readOnly={thread.readOnly}
                  fork={forks[entry.index] ?? null}
                  speed={entry.turn.turnId ? (speeds[entry.turn.turnId] ?? null) : null}
                  cost={entry.turn.turnId ? (costs[entry.turn.turnId] ?? null) : null}
                />
              ) : (
                <ShellRunRow key={entry.run.id} run={entry.run} sessionId={props.sessionId} />
              ),
            )}
            {echoes.map((echo) => (
              <PendingPrompt key={echo.localId} echo={echo} />
            ))}
            {thread.load === "error" ? <LoadError sessionId={props.sessionId} message={thread.error} /> : null}
            {empty && thread.load === "ready" ? <EmptyThread /> : null}
          </div>
        </div>
        {!isAtBottom && !empty ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={() => void scrollToBottom()}
              className="enter-up pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-raised px-3 text-xs font-medium text-muted shadow-pop hover:text-fg"
            >
              <ArrowDown size={13} /> Mais recentes
            </button>
          </div>
        ) : null}
      </div>
    </FileLinksContext.Provider>
  );
}

function sameEntries(a: MspItem[], b: MspItem[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

const TurnBlock = memo(
  function TurnBlock(props: {
    turn: TurnView;
    gates: GateMap;
    answers: AnswerMap;
    attachments: Record<string, AttachmentView[]>;
    sessionId: string;
    isLast: boolean;
    readOnly: boolean;
    fork: ForkPoint | null;
    speed: TurnSpeed | null;
    cost: TurnCost | null;
  }) {
    const { turn } = props;
    const info = turn.info;
    const errorCopy = info?.error
      ? turnErrorCopy(info.error.kind, info.error.message, info.error.retryable, { turnId: turn.turnId })
      : null;
    const closed = useApp((s) => (turn.turnId ? s.prefs.dismissedTurnErrors.includes(`${props.sessionId}:${turn.turnId}`) : false));
    const failed = info?.terminal === "failed" && !info.dismissed && !closed;
    const cancelled = info?.terminal === "cancelled";
    const hasWork = turn.entries.length > 0;
    // Itens fora de qualquer mensagem são os próprios comandos `!` do usuário: mostrados como são, nunca dobrados num registro de trabalho.
    const standalone = !turn.turnId && !turn.prompt;
    return (
      <article className="flex flex-col gap-3" aria-label="Mensagem">
        {turn.prompt ? (
          <PromptBubble item={turn.prompt} sentAt={sentTime(turn)} files={props.attachments[turn.turnId ?? ""] ?? []}
            fork={props.fork} sessionId={props.sessionId} />
        ) : null}
        {turn.running || standalone ? (
          <div className="flex flex-col gap-1.5">
            {turn.entries.map((item) => (
              <Entry
                key={item.itemId}
                item={item}
                gate={props.gates[item.itemId]}
                answers={props.answers[item.itemId] ?? null}
                sessionId={props.sessionId}
                live
              />
            ))}
            {turn.running ? <LiveStatus turn={turn} gates={props.gates} /> : null}
          </div>
        ) : hasWork ? (
          <WorkLog turn={turn} gates={props.gates} answers={props.answers} sessionId={props.sessionId} speed={turn.final ? null : props.speed} />
        ) : null}
        {turn.final ? (
          <div className="group/final flex flex-col gap-2">
            <AgentText item={turn.final} />
            <TurnFooter turn={turn} speed={props.speed} cost={props.cost} />
          </div>
        ) : null}
        {failed && !props.isLast ? (
          // Uma falha que a conversa já deixou para trás fica no registro, mas discretamente.
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-subtle">
            <CircleAlert size={12} className="shrink-0 text-danger" />
            <span className="shrink-0">Falhou</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate" title={errorCopy?.technical ?? errorCopy?.explanation}>
              {errorCopy?.title ?? EMPTY_TURN_ERROR}
            </span>
          </p>
        ) : failed ? (
          <TurnError
            kind={info?.error?.kind ?? null}
            message={info?.error?.message ?? EMPTY_TURN_ERROR}
            retryable={info?.error?.retryable ?? true}
            prompt={props.isLast && !props.readOnly ? (turn.prompt?.displayText ?? turn.prompt?.text ?? null) : null}
            sessionId={props.sessionId}
            turnId={turn.turnId}
            readOnly={props.readOnly}
            files={props.attachments[turn.turnId ?? ""] ?? []}
          />
        ) : null}
        {cancelled ? (
          <p className="flex items-center gap-1.5 text-xs text-subtle">
            <Square size={11} className="fill-current" /> Parado
            {info?.durationMs ? <span className="tabular-nums">após {formatDuration(info.durationMs)}</span> : null}
          </p>
        ) : null}
      </article>
    );
  },
  (a, b) =>
    a.turn.prompt === b.turn.prompt &&
    a.turn.final === b.turn.final &&
    a.turn.info === b.turn.info &&
    a.turn.running === b.turn.running &&
    sameEntries(a.turn.entries, b.turn.entries) &&
    a.gates === b.gates &&
    a.answers === b.answers &&
    a.isLast === b.isLast &&
    a.readOnly === b.readOnly &&
    a.fork === b.fork &&
    a.attachments === b.attachments &&
    // Preços chegam após o catálogo carregar, então o custo de uma mensagem pode mudar sem nada mais sobre ela mudar.
    a.cost?.cost === b.cost?.cost &&
    a.speed?.tokensPerSecond === b.speed?.tokensPerSecond,
);

function parseTime(iso: string | undefined): number | null {
  if (!iso) {
    return null;
  }
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** Quando o pedido entrou: seu horário de registro, ou quando sua mensagem começou. */
function sentTime(turn: TurnView): number | null {
  return parseTime(turn.prompt?.recordedAt) ?? turn.info?.startedAt ?? null;
}

/** Quando a mensagem terminou: a conclusão ao vivo, ou o horário de registro de sua resposta para o histórico. */
function completedTime(turn: TurnView): number | null {
  return turn.info?.completedAt ?? parseTime(turn.final?.recordedAt) ?? parseTime(turn.entries[turn.entries.length - 1]?.recordedAt);
}

function Entry(props: { item: MspItem; gate?: Gate; answers: UserInputAnswer[] | null; sessionId?: string; live?: boolean }) {
  const { item } = props;
  switch (item.kind) {
    case "agentMessage":
      return (item.text ?? "").trim() ? (
        <div className="py-1">
          <AgentText item={item} streaming={item.status === "inProgress"} />
        </div>
      ) : null;
    case "reasoning":
      return <ReasoningRow item={item} />;
    case "toolCall":
      return <ToolRow item={item} gate={props.gate} answers={props.answers} sessionId={props.sessionId} />;
    case "userShell":
      return <ShellRow item={item} sessionId={props.sessionId} />;
    case "subagent":
      return <SubagentRow item={item} sessionId={props.sessionId} />;
    case "workflow":
      return <WorkflowCard item={item} sessionId={props.sessionId} />;
    case "compaction":
      return <CompactionRow item={item} />;
    case "userMessage":
      return <SteerBubble item={item} />;
    default:
      return <GenericRow item={item} />;
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function summarize(entries: MspItem[]): string {
  let commands = 0;
  let edits = 0;
  let reads = 0;
  let searches = 0;
  let goals = 0;
  let other = 0;
  for (const item of entries) {
    if (item.kind === "userShell") {
      commands += 1;
    } else if (item.kind === "toolCall") {
      const kind = toolKind(item.tool, parseArgs(item.args));
      if (kind === "shell") {
        commands += 1;
      } else if (kind === "edit" || kind === "write") {
        edits += 1;
      } else if (kind === "read" || kind === "list") {
        reads += 1;
      } else if (kind === "search" || kind === "web") {
        searches += 1;
      } else if (kind === "goal") {
        goals += 1;
      } else {
        other += 1;
      }
    }
  }
  const parts: string[] = [];
  if (edits) parts.push(plural(edits, "edição", "edições"));
  if (commands) parts.push(plural(commands, "comando", "comandos"));
  if (reads) parts.push(plural(reads, "arquivo lido", "arquivos lidos"));
  if (searches) parts.push(plural(searches, "busca", "buscas"));
  if (goals) parts.push(plural(goals, "atualização de meta", "atualizações de meta"));
  if (other) parts.push(plural(other, "chamada de ferramenta", "chamadas de ferramenta"));
  return parts.join(", ");
}

function turnDuration(turn: TurnView): number | null {
  const info = turn.info;
  if (!info) {
    return null;
  }
  if (info.durationMs !== undefined) {
    return info.durationMs;
  }
  if (info.startedAt !== undefined && info.completedAt !== undefined) {
    return info.completedAt - info.startedAt;
  }
  return null;
}

/**
 * O trabalho de uma mensagem terminada, dobrado numa linha; os arquivos que mudou ficam visíveis como chips.
 * Gramática do cabeçalho via Beautiful UI ToolChips (beautifului.dev), MIT (c) 2026 Shane Levine.
 */
function WorkLog(props: { turn: TurnView; gates: GateMap; answers: AnswerMap; sessionId: string; speed?: TurnSpeed | null }) {
  const { turn } = props;
  const failed = turn.info?.terminal === "failed";
  const [open, setOpen] = useState(failed);
  const duration = turnDuration(turn);
  const summary = summarize(turn.entries);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/log -mx-1.5 flex h-8 max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg px-1.5 text-sm text-subtle transition-colors duration-100 hover:bg-hover hover:text-muted"
      >
        <ChevronRight size={13} strokeWidth={2.2} className={cn("shrink-0 transition-transform duration-200 ease-out", open && "rotate-90")} />
        <span className="shrink-0">{duration !== null ? `Trabalhou por ${formatDuration(duration)}` : "Registro de trabalho"}</span>
        {summary ? (
          <>
            <span className="h-3 w-px shrink-0 bg-line-strong" aria-hidden="true" />
            <span className="truncate">{summary}</span>
          </>
        ) : null}
        {props.speed ? (
          <>
            <span className="h-3 w-px shrink-0 bg-line-strong" aria-hidden="true" />
            <span className="shrink-0 tabular-nums">{formatSpeed(props.speed.tokensPerSecond)}</span>
          </>
        ) : null}
      </button>
      <Collapse open={open}>
        <div className="mt-1 ml-[7px] flex flex-col gap-1 border-l border-line pl-4">
          {turn.entries.map((item) => (
            <Entry
              key={item.itemId}
              item={item}
              gate={props.gates[item.itemId]}
              answers={props.answers[item.itemId] ?? null}
              sessionId={props.sessionId}
            />
          ))}
        </div>
      </Collapse>
      <DiffChips entries={turn.entries} className="mt-2" sessionId={props.sessionId} />
    </div>
  );
}

function LiveStatus(props: { turn: TurnView; gates: GateMap }) {
  const now = useNow(1000);
  const { turn } = props;
  const infoRef = useRef(turn.info);
  infoRef.current = turn.info;
  const speed = useSampled(() => streamingSpeed(infoRef.current, Date.now()), true);
  const startedAt = turn.info?.startedAt;
  const elapsed = startedAt ? formatDuration(now - startedAt) : null;
  const waiting = turn.entries.some((e) => props.gates[e.itemId]);
  const last = turn.entries[turn.entries.length - 1];
  const retry = turn.info?.retry;
  let label = "Trabalhando";
  if (retry) {
    label = `Tentando de novo (tentativa ${retry.nextAttempt} de ${retry.maxAttempts})`;
  } else if (last?.status === "inProgress" && last.kind === "toolCall") {
    const d = describeTool(last);
    label = d.subject && d.mono ? `${d.verb} ${d.subject.split("\n")[0]}` : d.verb;
  } else if (last?.status === "inProgress" && last.kind === "reasoning") {
    label = "Pensando";
  } else if (last?.kind === "agentMessage" && last.status === "inProgress") {
    label = "Escrevendo";
  } else if (turn.entries.length > 0 && !turn.entries.some((e) => e.status === "inProgress")) {
    // Texto e ferramentas terminaram; o turno segue aberto por trabalho que a UI não mostra.
    label = "Finalizando…";
  }
  return (
    <div className="flex h-8 items-center gap-2.5 text-sm" role="status">
      {waiting ? (
        <>
          <span className="attention-pulse size-2 rounded-full bg-warn" />
          <span className="font-medium text-warn-text">Esperando você abaixo</span>
        </>
      ) : (
        <>
          <PixelLoader className="text-accent-text" />
          <Shimmer className="max-w-[60ch] truncate font-medium">{label}</Shimmer>
        </>
      )}
      {elapsed ? <span className="font-mono text-xs text-subtle tabular-nums">{elapsed}</span> : null}
      {speed !== null && !waiting ? (
        <Tip label="Estimado do texto transmitindo agora">
          <span tabIndex={0} className="font-mono text-xs text-subtle tabular-nums">
            ~{formatSpeed(speed)}
          </span>
        </Tip>
      ) : null}
      {retry?.reason ? <span className="truncate text-xs text-subtle">{retry.reason}</span> : null}
    </div>
  );
}

/** Sob uma resposta: quando terminou, quanto levou quando não houve registro de trabalho, e sua velocidade de saída. */
function TurnFooter(props: { turn: TurnView; speed: TurnSpeed | null; cost: TurnCost | null }) {
  const duration = turnDuration(props.turn);
  const hasWork = props.turn.entries.length > 0;
  const completed = completedTime(props.turn);
  const dot = (
    <span aria-hidden="true" className="text-line-strong">
      ·
    </span>
  );
  return (
    <div className="flex h-6 items-center gap-1.5 text-xs text-subtle">
      {completed !== null ? (
        <Tip label={`Concluída ${formatFullDate(completed)}`}>
          <span tabIndex={0} className="tabular-nums">
            Concluída {formatClock(completed)}
          </span>
        </Tip>
      ) : null}
      {duration !== null && !hasWork ? (
        <>
          {completed !== null ? dot : null}
          <span className="tabular-nums">{formatDuration(duration)}</span>
        </>
      ) : null}
      {props.speed ? (
        <>
          {completed !== null || (duration !== null && !hasWork) ? dot : null}
          <Tip label={`${formatTokens(props.speed.outputTokens)} tokens de saída em ${formatDuration(props.speed.generationMs)} de chamadas ao modelo`}>
            <span tabIndex={0} className="tabular-nums">
              {formatSpeed(props.speed.tokensPerSecond)}
            </span>
          </Tip>
        </>
      ) : null}
      {props.cost && props.cost.cost > 0 ? (
        <>
          {completed !== null || props.speed || (duration !== null && !hasWork) ? dot : null}
          <Tip
            label={`Nas tarifas de API: ${formatTokens(props.cost.promptTokens)} de entrada (${formatTokens(props.cost.cachedTokens)} do cache), ${formatTokens(props.cost.outputTokens)} de saída${props.cost.complete ? "" : "; uma chamada aqui não tem preço publicado"}`}
          >
            <span tabIndex={0} className="tabular-nums">
              {formatCost(props.cost.cost, props.cost.currency ?? undefined)}
              {props.cost.complete ? "" : "+"}
            </span>
          </Tip>
        </>
      ) : null}
      <span className="ml-0.5 opacity-0 transition-opacity duration-150 group-hover/final:opacity-100 focus-within:opacity-100">
        <CopyButton text={props.turn.final?.text ?? ""} label="Copiar resposta" />
      </span>
    </div>
  );
}

function PromptBubble(props: { item: MspItem; sentAt: number | null; files?: AttachmentView[]; fork: ForkPoint | null; sessionId: string }) {
  const text = stripAttachmentMentions(stripImageMarkers(props.item.displayText ?? props.item.text ?? ""));
  const long = text.split("\n").length > 12 || text.length > 900;
  const [expanded, setExpanded] = useState(false);
  const files = props.files ?? [];
  return (
    <div className="flex justify-end">
      <div className="group/prompt flex max-w-[85%] flex-col items-end gap-1">
        {files.length > 0 ? <SentAttachments files={files} className="pb-0.5" /> : null}
        {text ? (
          <div
            className={cn(
              "relative rounded-2xl rounded-tr-md bg-active px-4 py-2.5 text-md leading-relaxed whitespace-pre-wrap text-fg [overflow-wrap:anywhere]",
              long && !expanded && "max-h-[16.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
            )}
          >
            {text}
          </div>
        ) : null}
        <div className="flex h-6 items-center gap-1">
          <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/prompt:opacity-100 focus-within:opacity-100">
            {long ? (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded-md px-1.5 py-0.5 text-xs text-subtle hover:bg-hover hover:text-fg">
                {expanded ? "Mostrar menos" : "Mostrar tudo"}
              </button>
            ) : null}
            <CopyButton text={text} label="Copiar pedido" />
            {props.fork ? <ForkTurnAction sessionId={props.sessionId} point={props.fork} files={files} /> : null}
          </div>
          {props.sentAt !== null ? (
            <Tip label={`Enviado ${formatFullDate(props.sentAt)}`}>
              <span tabIndex={0} className="px-1 text-xs text-subtle tabular-nums">
                {formatClock(props.sentAt)}
              </span>
            </Tip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The selected prompt is the turn selector; the dialog spells out the inclusive cut before creating a branch. */
function ForkTurnAction(props: { sessionId: string; point: ForkPoint; files: AttachmentView[] }) {
  const controller = useController();
  const [gesture, setGesture] = useState<"continue" | "edit" | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = props.point.beforeTurnId !== null && props.point.editText !== null;

  const confirm = async () => {
    if (!gesture || busy) return;
    setBusy(true);
    try {
      if (gesture === "continue") {
        if (await controller.fork(props.sessionId, props.point.lastTurnId)) setGesture(null);
      } else if (canEdit) {
        // Read stored attachments before forking: a missing file must not leave a new branch with an incomplete prompt.
        const read = props.files.length > 0 ? await refetchAttachments(props.files) : [];
        const draft = {
          text: props.point.editText ?? "",
          attachments: read.map(toOutgoing),
          previews: read.map(toPreview),
        };
        if (await controller.fork(props.sessionId, props.point.beforeTurnId as string, draft)) setGesture(null);
      }
    } catch (error) {
      controller.toast("error", "Não foi possível preparar os anexos", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Menu>
        <Tip label="Ramificar a partir desta mensagem">
          <MenuTrigger asChild>
            <IconButton size="xs" label="Ramificar a partir desta mensagem"><GitFork size={13} /></IconButton>
          </MenuTrigger>
        </Tip>
        <MenuContent align="end">
          <MenuItem icon={<GitFork size={14} />} onSelect={() => setGesture("continue")}>Continuar depois desta mensagem</MenuItem>
          <MenuItem icon={<SquarePen size={14} />} onSelect={() => setGesture("edit")} disabled={!canEdit}>
            Editar e reenviar este pedido
          </MenuItem>
          {props.point.editUnavailable ? <p className="px-2 pb-1 text-xs text-subtle">{props.point.editUnavailable}</p> : null}
        </MenuContent>
      </Menu>
      <Modal
        open={gesture !== null}
        onOpenChange={(open) => { if (!open && !busy) setGesture(null); }}
        title={gesture === "edit" ? "Editar este pedido em uma ramificação?" : "Continuar daqui em uma ramificação?"}
        description={gesture === "edit"
          ? "A nova conversa copia o histórico até o turno anterior. Este pedido e seus anexos irão para o rascunho, sem envio automático."
          : "A nova conversa copia o histórico até este turno, inclusive. As mensagens posteriores ficam só na conversa original."}
      >
        <p className="mt-3 text-sm text-muted">A conversa original continua como está.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setGesture(null)}>Voltar</Button>
          <Button loading={busy} onClick={() => void confirm()}>
            {gesture === "edit" ? "Criar e editar" : "Criar ramificação"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * Um comando `!` que o próprio Helicon executou. O Muse nunca o viu, então sua saída fica aqui até o usuário a entregar.
 */
function ShellRunRow(props: { run: ShellRun; sessionId: string }) {
  const controller = useController();
  const { run } = props;
  const failed = run.exitCode !== 0;
  const output = run.output.trim();
  return (
    <section className="enter-up flex flex-col gap-1.5" aria-label={`Comando ${run.command}`}>
      <div className="flex items-center gap-2">
        <SquareTerminal size={14} className="shrink-0 text-subtle" />
        <span className="shrink-0 text-xs text-muted">Você executou</span>
        <code className="min-w-0 flex-1 truncate rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs text-fg">{run.command}</code>
        {failed ? <span className="shrink-0 text-xs text-danger-text">Saída {run.exitCode ?? "?"}</span> : null}
        {run.durationMs !== null ? (
          <span className="shrink-0 text-2xs text-subtle tabular-nums">{formatDuration(run.durationMs)}</span>
        ) : null}
        <Tip label="O Muse não viu esta execução; isto envia a ele o comando e sua saída">
          <Button size="sm" variant="ghost" onClick={() => void controller.sendShellOutput(props.sessionId, run)}>
            Enviar ao Muse
          </Button>
        </Tip>
      </div>
      {output ? <CodeBlock code={run.truncated ? `[saída anterior descartada]\n${output}` : output} language="text" className="my-0" /> : null}
    </section>
  );
}

/**
 * O que um pedido diz enquanto espera o stream ecoá-lo de volta. Só o primeiro destes ainda está a caminho:
 * uma vez que o host reconheceu a mensagem, ela está enviada, e dizer o contrário parece uma mensagem que nunca saiu.
 */
const ECHO_LABEL: Record<LocalEcho["disposition"], string> = {
  sending: "Enviando",
  started: "Enviado",
  queued: "Na fila",
  steered: "Adicionando à mensagem atual",
};

function PendingPrompt(props: { echo: LocalEcho }) {
  const files = props.echo.attachments ?? [];
  return (
    <div className="enter-up flex flex-col items-end gap-1.5">
      {files.length > 0 ? <SentAttachments files={files} className="max-w-[85%] opacity-75" /> : null}
      {props.echo.text ? (
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-active px-4 py-2.5 text-md leading-relaxed whitespace-pre-wrap text-fg opacity-75">
          {props.echo.text}
        </div>
      ) : null}
      <span className="flex items-center gap-1.5 text-2xs text-subtle">
        <Spinner size={9} />
        {ECHO_LABEL[props.echo.disposition]}
      </span>
    </div>
  );
}

function TurnError(props: {
  kind: string | null;
  message: string;
  retryable: boolean;
  prompt: string | null;
  sessionId: string;
  turnId: string | null;
  readOnly: boolean;
  /** Os próprios arquivos da mensagem falha: o que o provedor rejeita nas mesmas palavras, e o que uma nova tentativa tem de levar. */
  files: AttachmentView[];
}) {
  const controller = useController();
  const hadImages = props.files.some((file) => file.kind === "image");
  // Algumas falhas são sobre a conversa, não a mensagem: tentar de novo envia o mesmo histórico e falha do mesmo jeito.
  const stuck = stuckThread(props.message, { ownImages: hadImages });
  const copy = turnErrorCopy(props.kind, props.message, props.retryable, { turnId: props.turnId });
  const [confirmRestart, setConfirmRestart] = useState(false);
  /**
   * Envia o pedido de novo com os mesmos arquivos: seus bytes vivem no servidor, então são lidos de volta
   * em vez de omitidos, o que discretamente perguntaria outra coisa ao modelo. Nada vai se não puderem ser
   * lidos, então o aviso fica e a escolha segue do usuário.
   */
  const again = (send: (files: { attachments: OutgoingAttachment[]; previews: EchoAttachment[] }) => Promise<unknown>) => {
    void (async () => {
      let carried: { attachments: OutgoingAttachment[]; previews: EchoAttachment[] } = { attachments: [], previews: [] };
      if (props.files.length > 0) {
        try {
          const read = await refetchAttachments(props.files);
          carried = { attachments: read.map(toOutgoing), previews: read.map(toPreview) };
        } catch (error) {
          controller.toast(
            "error",
            "Não foi possível ler os arquivos anexados de novo",
            error instanceof Error ? error.message : String(error),
          );
          return;
        }
      }
      controller.dismissTurnError(props.sessionId, props.turnId);
      await send(carried);
    })();
  };
  return (
    <div className="flex items-start gap-3 rounded-xl bg-danger-soft px-3.5 py-3" role="alert">
      <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{stuck ? "Esta conversa não pode seguir como está" : copy.title}</p>
        <p className="mt-0.5 text-sm break-words text-muted">{stuck ? stuck.message : copy.explanation}</p>
        {stuck || copy.technical ? (
          <p className="mt-1 text-2xs break-words text-subtle">{stuck ? props.message : copy.technical}</p>
        ) : null}
      </div>
      {stuck && stuck.remedy !== "none" && !props.readOnly ? (
        <Tip
          label={
            stuck.remedy === "compact"
              ? "Resumir o histórico, deixar para trás o que não pode ser enviado, e seguir"
              : "Começar uma conversa ao lado desta, sem o histórico que não pode ser enviado"
          }
        >
          <Button
            size="sm"
            onClick={() => {
              // Estas falhas voltam como não-tentáveis, mas reparar o histórico é o que muda isto:
              // o pedido vai de novo quando a conversa puder levá-lo.
              // De todo jeito os arquivos vão junto: uma imagem ilegível mais antiga é o que trava esta conversa, e
              // a mensagem tentada de novo pode levar arquivos bons seus.
              const prompt = props.prompt;
              again((files) =>
                stuck.remedy === "compact"
                  ? controller.compactAndRetry(props.sessionId, prompt, files)
                  : controller.freshThread(props.sessionId, prompt, files),
              );
            }}
          >
            {stuck.remedy === "compact" ? (
              <>
                <RotateCcw size={13} /> {props.prompt ? "Compactar e tentar de novo" : "Compactar esta conversa"}
              </>
            ) : (
              <>
                <SquarePen size={13} /> Começar uma conversa nova
              </>
            )}
          </Button>
        </Tip>
      ) : stuck && stuck.remedy === "none" && !props.readOnly ? (
        <Tip label="Se a imagem que você enviou abre bem em outro lugar, uma mais antiga nesta conversa é a ilegível">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              // Sem nova tentativa aqui: o pedido voltaria sem sua imagem, discretamente perguntando outra coisa.
              controller.dismissTurnError(props.sessionId, props.turnId);
              void controller.compactAndRetry(props.sessionId, null);
            }}
          >
            <RotateCcw size={13} /> Compactar a conversa
          </Button>
        </Tip>
      ) : props.prompt && copy.offerRetry ? (
        <Tip label="Enviar o mesmo pedido de novo">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => again((files) => controller.retryTurn(props.sessionId, props.prompt as string, files))}
          >
            <RotateCcw size={13} /> Tentar de novo
          </Button>
        </Tip>
      ) : null}
      {!props.readOnly ? (
        <Tip label="Reinicia os servidores Muse; turnos em execução são interrompidos">
          <Button size="sm" variant="ghost" onClick={() => setConfirmRestart(true)}>
            <RotateCw size={13} /> Reiniciar o Muse
          </Button>
        </Tip>
      ) : null}
      <Tip label="Dispensar">
        <IconButton size="sm" label="Dispensar este erro" className="-mt-0.5 -mr-1 shrink-0" onClick={() => controller.dismissTurnError(props.sessionId, props.turnId)}>
          <X size={13} />
        </IconButton>
      </Tip>
      <Modal
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Reiniciar o Muse?"
        description="Os servidores Muse em execução reiniciam agora e os turnos em andamento são interrompidos — a conversa segue normal depois, é só enviar a mensagem de novo. Use quando mensagens falham repetidamente sem explicação."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRestart(false)}>
            Voltar
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmRestart(false);
              void controller.restartMuseHosts();
            }}
          >
            Reiniciar o Muse
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function LoadError(props: { sessionId: string; message: string | null }) {
  const controller = useController();
  return (
    <div className="flex items-start gap-3 rounded-xl bg-danger-soft px-3.5 py-3" role="alert">
      <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Não foi possível abrir esta conversa</p>
        <p className="mt-0.5 text-sm break-words text-muted">{props.message ?? "O Muse não respondeu."}</p>
      </div>
      <Tip label="Tenta abrir de novo. Não troca o modelo nem o perfil.">
        <Button size="sm" onClick={() => void controller.loadThread(props.sessionId)}>
          Recarregar conversa
        </Button>
      </Tip>
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="flex flex-col items-center pt-[14vh] text-center">
      <p className="font-display text-2xl text-fg">Uma folha em branco</p>
      <p className="mt-2 max-w-[44ch] text-sm text-muted">
        Descreva a mudança que você quer. O Muse lê o projeto, executa o que precisa, e pergunta antes de qualquer coisa arriscada.
      </p>
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Carregando conversa">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="ml-auto h-10 w-[46%] rounded-2xl bg-hover" />
          <div className="h-3 w-[30%] rounded bg-hover" />
          <div className="h-3 w-[88%] rounded bg-hover" />
          <div className="h-3 w-[72%] rounded bg-hover" />
        </div>
      ))}
    </div>
  );
}
