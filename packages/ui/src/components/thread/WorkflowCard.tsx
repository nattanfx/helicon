import { ChevronDown, CircleStop, PanelRightOpen, RotateCcw, SkipForward, Workflow } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useApp, useController } from "../../app/context.js";
import { formatDuration, humanize } from "../../model/format.js";
import { TERMINAL_FAILURES, workflowView, type WorkflowAgent, type WorkflowView } from "../../model/workflow.js";
import type { MspItem } from "../../types.js";
import { Markdown } from "../ui/Markdown.js";
import { Sheet } from "../ui/overlays.js";
import { Button, IconButton, Spinner, cn } from "../ui/primitives.js";

type Tone = "running" | "done" | "failed";

const PILL: Record<Tone, string> = {
  running: "bg-accent-soft text-accent-text",
  done: "bg-active text-ok-text",
  failed: "bg-warn-soft text-warn-text",
};

const FILL: Record<Tone, string> = {
  running: "bg-accent",
  done: "bg-ok",
  failed: "bg-warn",
};

function toneOf(view: WorkflowView): Tone {
  if (view.running) {
    return "running";
  }
  // Uma execução rejeitada, cancelada ou que estourou o tempo não teve sucesso, mesmo sem nenhum agente com falha.
  return view.failed > 0 || TERMINAL_FAILURES.has(view.status) ? "failed" : "done";
}

function time(ms: number | null): string {
  return ms === null ? "Desconhecido" : formatDuration(ms) || "0s";
}

/**
 * Uma execução de workflow: para que foi, para quantos agentes se dividiu e como estão, com
 * todo o resto a um clique no painel. Sem tokens ou custo, porque o Muse não informa nenhum dos dois por execução.
 */
export const WorkflowCard = memo(function WorkflowCard(props: { item: MspItem; sessionId?: string }) {
  const controller = useController();
  const [detail, setDetail] = useState(false);
  const { item, sessionId } = props;
  // O item é trocado a cada revisão, então isto recalcula exatamente quando a execução muda.
  const view = useMemo(() => {
    const fold = sessionId ? (controller.store.get().threads[sessionId]?.fold ?? null) : null;
    return workflowView(item, fold);
  }, [item, sessionId, controller]);
  const cardKey = `workflow:${item.itemId}`;
  const open = useApp((s) => !s.prefs.collapsedCards.includes(cardKey));
  const tone = toneOf(view);
  const percent = view.used > 0 ? ((view.done + view.failed) / view.used) * 100 : 0;
  return (
    <section aria-label="Fluxo de trabalho" className="enter-up overflow-hidden rounded-2xl bg-raised shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => controller.setCardOpen(cardKey, !open)}
        className="flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-hover"
      >
        <Workflow size={15} className="shrink-0 text-subtle" />
        <span className="shrink-0 text-sm font-medium text-fg">Fluxo de trabalho</span>
        <span className={cn("shrink-0 rounded-md px-1.5 py-px text-2xs font-medium", PILL[tone])}>
          {view.running ? "Em execução" : humanize(view.status)}
        </span>
        {view.used > 0 ? (
          <span className="shrink-0 text-xs text-subtle tabular-nums">
            {view.done + view.failed} de {view.used}
          </span>
        ) : null}
        {!open ? <span className="min-w-0 truncate text-xs text-muted">{view.objective ?? view.label}</span> : null}
        <span className="min-w-2 flex-1" />
        {view.running ? <Spinner size={12} className="shrink-0 text-accent-text" /> : null}
        <ChevronDown size={14} className={cn("shrink-0 text-subtle transition-transform duration-200", !open && "-rotate-90")} />
      </button>
      {open ? (
        <div className="px-3.5 pb-3">
          <p className="line-clamp-3 text-sm text-pretty text-fg [overflow-wrap:anywhere]" title={view.objective ?? view.label}>
            {view.objective ?? view.label}
          </p>
          {view.used > 0 ? (
            <div
              role="progressbar"
              aria-label="Agentes concluídos"
              aria-valuemin={0}
              aria-valuemax={view.used}
              aria-valuenow={view.done + view.failed}
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-active"
            >
              <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[tone])} style={{ width: `${percent}%` }} />
            </div>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <Metric label="Agentes" value={String(view.used)} />
            <Metric label={view.running ? "Trabalhando" : "Concluídos"} value={String(view.running ? view.working : view.done)} />
            <Metric label="Chamadas de ferramenta" value={view.toolCalls === null ? "Desconhecido" : String(view.toolCalls)} />
            <Metric label="Agente mais longo" value={time(view.longestMs)} />
          </dl>
          {view.failed > 0 ? (
            <p className="mt-2 text-xs text-warn-text">
              {view.failed} de {view.used} {view.failed === 1 ? "agente não terminou" : "agentes não terminaram"}.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDetail(true)}>
              <PanelRightOpen size={13} /> Detalhes
            </Button>
            {view.running && view.runId && sessionId ? <CancelRun sessionId={sessionId} runId={view.runId} /> : null}
          </div>
        </div>
      ) : null}
      <Sheet
        open={detail}
        onOpenChange={setDetail}
        title="Fluxo de trabalho"
        description={view.objective ?? view.label}
      >
        <Detail view={view} tone={tone} sessionId={sessionId} />
      </Sheet>
    </section>
  );
});

/** Cancela toda a execução; o que já tinha terminado fica no relatório. */
function CancelRun(props: { sessionId: string; runId: string }) {
  const controller = useController();
  const readOnly = useApp((s) => s.threads[props.sessionId]?.readOnly ?? true);
  const busy = useApp((s) => Boolean(s.busy[`workflow:${props.sessionId}:${props.runId}:run`]));
  if (readOnly) {
    return null;
  }
  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={() => void controller.workflowAction(props.sessionId, "cancel", props.runId)}>
      <CircleStop size={13} /> Cancelar execução
    </Button>
  );
}

function Detail(props: { view: WorkflowView; tone: Tone; sessionId?: string }) {
  const { view } = props;
  // Pular ou repetir um agente precisa da execução a que pertence e de uma conversa que seja nossa para conduzir.
  const controls = useApp((s) => (props.sessionId && view.runId && !s.threads[props.sessionId]?.readOnly ? { sessionId: props.sessionId, runId: view.runId } : null), (a, b) => a?.sessionId === b?.sessionId && a?.runId === b?.runId);
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs sm:grid-cols-3">
        <Metric label="Status" value={view.running ? "Em execução" : humanize(view.status)} />
        <Metric label="Agentes usados" value={String(view.used)} />
        <Metric label="Trabalhando" value={String(view.working)} />
        <Metric label="Concluídos" value={String(view.done)} />
        <Metric label="Com falha" value={String(view.failed)} />
        <Metric label="Chamadas de ferramenta" value={view.toolCalls === null ? "Desconhecido" : String(view.toolCalls)} />
        <Metric label="Agente mais longo" value={time(view.longestMs)} />
        {/* Agentes executam lado a lado, então isto é mais do que a execução levou no relógio. */}
        <Metric label="Tempo de agente" value={time(view.agentMs)} />
        <Metric label="Iniciado por" value={view.trigger ? humanize(view.trigger) : "Desconhecido"} />
      </dl>

      {view.failure ? (
        <section>
          <h3 className="text-xs font-medium text-subtle">Última falha</h3>
          <p className="mt-1 text-sm text-danger-text [overflow-wrap:anywhere]">{view.failure}</p>
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-medium text-subtle">Agentes</h3>
        {view.agents.length > 0 ? (
          <ul className="mt-1.5 flex flex-col">
            {view.agents.map((agent) => (
              <AgentRow key={`${agent.id}:${agent.attempt}`} agent={agent} controls={controls} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">Nenhum agente reportado ainda.</p>
        )}
      </section>

      {view.summary ? (
        <section>
          <h3 className="text-xs font-medium text-subtle">
            Relatório{view.summaryStatus ? ` · ${humanize(view.summaryStatus)}` : ""}
          </h3>
          <div className="mt-1.5">
            <Markdown text={view.summary} className="text-sm" />
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-medium text-subtle">Execução</h3>
        <dl className="mt-1.5 flex flex-col gap-1 text-xs">
          <Identifier label="Execução" value={view.runId} />
          <Identifier label="Script" value={view.scriptId} />
          <Identifier label="Admitida" value={view.admitted ? "Sim" : "Não"} />
          {view.deferred ? <Identifier label="Adiada" value="Executou em segundo plano" /> : null}
        </dl>
      </section>
    </div>
  );
}

function AgentRow(props: { agent: WorkflowAgent; controls: { sessionId: string; runId: string } | null }) {
  const controller = useController();
  const { agent, controls } = props;
  const failed = Boolean(agent.terminal) && agent.terminal !== "completed";
  const busy = useApp((s) => Boolean(controls && s.busy[`workflow:${controls.sessionId}:${controls.runId}:${agent.id}`]));
  // A tentativa vai junto como a atual do filho: se ele avançou nesse meio-tempo, o Muse recusa em vez de adivinhar.
  const act = (action: "skip" | "retry") =>
    controls && void controller.workflowAction(controls.sessionId, action, controls.runId, { childId: agent.id, attempt: agent.attempt });
  return (
    <li className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
      {agent.terminal ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-danger" : "bg-ok")} />
      ) : (
        <Spinner size={10} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={agent.id}>
        {agent.id}
      </span>
      {agent.attempt > 1 ? <span className="shrink-0 text-2xs text-subtle">tentativa {agent.attempt}</span> : null}
      {agent.toolCalls !== null ? (
        <span className="shrink-0 text-2xs text-subtle tabular-nums">
          {agent.toolCalls} {agent.toolCalls === 1 ? "chamada" : "chamadas"}
        </span>
      ) : null}
      <span className="w-12 shrink-0 text-right text-2xs text-subtle tabular-nums">
        {agent.durationMs === null ? "" : formatDuration(agent.durationMs) || "0s"}
      </span>
      {controls && !agent.terminal ? (
        <IconButton size="xs" label={`Pular ${agent.id}`} title="Pular este agente" disabled={busy} onClick={() => act("skip")}>
          <SkipForward size={12} />
        </IconButton>
      ) : null}
      {controls && failed ? (
        <IconButton size="xs" label={`Repetir ${agent.id}`} title="Executar este agente de novo" disabled={busy} onClick={() => act("retry")}>
          <RotateCcw size={12} />
        </IconButton>
      ) : null}
    </li>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-subtle">{props.label}</dt>
      <dd className="truncate text-fg tabular-nums">{props.value}</dd>
    </div>
  );
}

function Identifier(props: { label: string; value: string | null }) {
  if (!props.value) {
    return null;
  }
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-subtle">{props.label}</dt>
      <dd className="min-w-0 truncate font-mono text-[11.5px] text-muted" title={props.value}>
        {props.value}
      </dd>
    </div>
  );
}
