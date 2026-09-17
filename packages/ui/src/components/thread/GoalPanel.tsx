import { ChevronDown, Pause, Play, Square, Target, X } from "lucide-react";
import { useMemo } from "react";
import { shallowEqual, useApp, useController, useNow } from "../../app/context.js";
import { formatDuration, formatTokens, relativeTime } from "../../model/format.js";
import { goalView, type GoalTone, type GoalView } from "../../model/goal.js";
import { formatCost } from "../../model/pricing.js";
import { turnCost } from "../../model/usage.js";
import { CloseCard } from "../requests/Requests.js";
import { Tip } from "../ui/overlays.js";
import { Button, cn } from "../ui/primitives.js";

const PILL: Record<GoalTone, string> = {
  active: "bg-accent-soft text-accent-text",
  paused: "bg-active text-muted",
  done: "bg-active text-ok-text",
  attention: "bg-warn-soft text-warn-text",
  ended: "bg-active text-subtle",
};

const FILL: Record<GoalTone, string> = {
  active: "bg-accent",
  paused: "bg-line-strong",
  done: "bg-ok",
  attention: "bg-warn",
  ended: "bg-line-strong",
};

/** A meta que o Muse persegue nesta conversa, com há quanto tempo, quantas mensagens e quantos tokens levou. */
export function GoalPanel(props: { sessionId: string; running: boolean; readOnly: boolean }) {
  const controller = useController();
  // Só o que a meta lê: texto transmitido não muda nada disto, então tokens não redesenham o painel.
  const inputs = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold
      ? { goal: fold.meta.goal, seen: fold.meta.goalSeen, since: fold.meta.goalSince, calls: fold.meta.calls, items: fold.order.length }
      : null;
  }, shallowEqual);
  const view = useMemo(() => {
    const fold = controller.store.get().threads[props.sessionId]?.fold;
    return inputs && fold ? goalView(fold) : null;
  }, [inputs, controller, props.sessionId]);
  // Guardado nas prefs, não aqui: este painel desmonta sempre que o usuário olha outra conversa.
  const cardKey = `goal:${props.sessionId}`;
  const open = useApp((s) => !s.prefs.collapsedCards.includes(cardKey));
  const hidden = useApp((s) => s.prefs.hiddenCards.includes(cardKey));
  const ticking = view?.tone === "active" && view.startedAt !== null;
  const now = useNow(1000, ticking);
  if (!view || hidden) {
    return null;
  }
  const elapsed = view.startedAt === null ? null : Math.max(0, (view.endedAt ?? now) - view.startedAt - view.pausedMs);
  return (
    <section aria-label="Meta" className="enter-up overflow-hidden rounded-2xl bg-raised shadow-card">
      <div className="flex items-center pr-1.5 transition-colors hover:bg-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => controller.setCardOpen(cardKey, !open)}
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 pl-3.5 text-left"
        >
          <Target size={15} className="shrink-0 text-subtle" />
          <span className="text-sm font-medium text-fg">Meta</span>
          <span className={cn("shrink-0 rounded-md px-1.5 py-px text-2xs font-medium", PILL[view.tone])}>{view.label}</span>
          <span className="shrink-0 text-xs text-subtle tabular-nums">{Math.round(view.percent)}%</span>
          {!open ? <span className="min-w-0 truncate text-xs text-muted">{view.objective}</span> : null}
          <span className="flex-1" />
          {elapsed !== null ? <span className="shrink-0 text-xs text-subtle tabular-nums">{formatDuration(elapsed) || "0s"}</span> : null}
          <ChevronDown size={14} className={cn("shrink-0 text-subtle transition-transform duration-200", !open && "-rotate-90")} />
        </button>
        <CloseCard label="Ocultar a meta" onClose={() => controller.setCardHidden(cardKey, true)} />
      </div>
      {open ? <GoalBody view={view} elapsed={elapsed} now={now} {...props} /> : null}
    </section>
  );
}

function GoalBody(props: { view: GoalView; elapsed: number | null; now: number; sessionId: string; running: boolean; readOnly: boolean }) {
  const controller = useController();
  const { view } = props;
  const models = useApp((s) => s.models);
  // As mesmas mensagens que a contagem de tokens cobre, precificadas na tarifa do modelo de cada chamada.
  const spend = useMemo(() => {
    const fold = controller.store.get().threads[props.sessionId]?.fold;
    if (!fold) {
      return null;
    }
    let cost = 0;
    let currency: string | null = null;
    let complete = true;
    let priced = false;
    for (const turnId of view.turnIds) {
      const turn = turnCost(fold, turnId, models);
      if (!turn) {
        continue;
      }
      priced = true;
      cost += turn.cost;
      currency = currency ?? turn.currency;
      complete = complete && turn.complete;
    }
    return priced ? { cost, currency, complete } : null;
  }, [view, models, controller, props.sessionId]);
  const busy = useApp((s) => Boolean(s.busy[`goal:${props.sessionId}`]));
  const muse = view.tokensUsed !== null && view.tokensUsed > 0 ? ` Contagem do próprio Muse em sua última atualização de meta: ${formatTokens(view.tokensUsed)}.` : "";
  const lastUpdate = view.lastProgressAt ?? view.endedAt;
  const newGoal = () => {
    // Mantém um rascunho não enviado: ele vira o início do objetivo, e nada é enviado até o usuário enviar.
    const draft = document.querySelector<HTMLTextAreaElement>("textarea")?.value.trim() ?? "";
    controller.prefillComposer(props.sessionId, !draft ? "/goal " : /^\/goal\b/i.test(draft) ? draft : `/goal ${draft}`);
    // A caixa de mensagem recebe o texto no próximo render; põe o cursor após ele.
    requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>("textarea[aria-autocomplete], textarea");
      composer?.focus();
      composer?.setSelectionRange(composer.value.length, composer.value.length);
    });
  };
  return (
    <div className="px-3.5 pb-3">
      <p className="line-clamp-3 text-sm text-pretty text-fg [overflow-wrap:anywhere]" title={view.objective}>
        {view.objective}
      </p>
      <div
        role="progressbar"
        aria-label="Progresso da meta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(view.percent)}
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-active"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[view.tone])} style={{ width: `${view.percent}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-5">
        <Metric label={view.tone === "active" ? "Executando há" : "Executou por"} value={props.elapsed === null ? "Desconhecido" : formatDuration(props.elapsed) || "0s"} />
        <Metric label="Mensagens" value={String(view.turns)} />
        <Tip label={`Tokens de entrada e saída das chamadas ao modelo desta meta.${muse}`}>
          <div tabIndex={0} className="min-w-0 cursor-default">
            <Metric label="Tokens" value={view.tokenBudget ? `${formatTokens(view.tokens)} de ${formatTokens(view.tokenBudget)}` : formatTokens(view.tokens)} />
          </div>
        </Tip>
        <Tip
          label={`Quanto o trabalho desta meta teria custado nas tarifas de API publicadas.${
            spend && !spend.complete ? " Um de seus modelos não tem preço listado, então o valor real é maior." : ""
          }`}
        >
          <div tabIndex={0} className="min-w-0 cursor-default">
            <Metric
              label="Custo"
              value={spend ? `${spend.complete ? "" : "≥ "}${formatCost(spend.cost, spend.currency ?? undefined)}` : "Desconhecido"}
            />
          </div>
        </Tip>
        <Metric label="Última atualização" value={lastUpdate ? relativeTime(new Date(lastUpdate).toISOString(), props.now) : "Nenhuma ainda"} />
      </dl>
      {/* Em que o Muse está e o que planeja depois só faz sentido enquanto a meta ainda está aberta. */}
      {(view.tone === "active" || view.tone === "paused" || view.tone === "attention") && (view.currentWork || view.nextWork) ? (
        <dl className="mt-2.5 flex flex-col gap-1 text-xs">
          {view.currentWork ? <Work label="Agora" text={view.currentWork} /> : null}
          {view.nextWork ? <Work label="Depois" text={view.nextWork} /> : null}
        </dl>
      ) : null}
      {props.readOnly ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Pausar mantém a meta e impede o Muse de começar trabalho novo nela; parar só encerra a mensagem em execução. */}
          {view.tone === "active" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.goalAction(props.sessionId, "pause")}>
              <Pause size={13} /> Pausar meta
            </Button>
          ) : null}
          {view.tone === "active" && props.running ? (
            <Button size="sm" variant="ghost" onClick={() => void controller.stop(props.sessionId)}>
              <Square size={12} /> Parar mensagem
            </Button>
          ) : null}
          {(view.tone === "paused" || view.tone === "attention") && !props.running ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void controller.continueGoal(props.sessionId, view.objective, view.status)}
            >
              <Play size={13} /> {view.tone === "paused" ? "Retomar meta" : "Continuar"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={newGoal}>
            {view.tone === "active" ? "Trocar meta" : "Nova meta"}
          </Button>
          {view.tone !== "done" && view.tone !== "ended" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.goalAction(props.sessionId, "clear")}>
              <X size={13} /> Limpar
            </Button>
          ) : null}
        </div>
      )}
    </div>
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

function Work(props: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-9 shrink-0 text-subtle">{props.label}</dt>
      <dd className="min-w-0 text-muted [overflow-wrap:anywhere]">{props.text}</dd>
    </div>
  );
}
