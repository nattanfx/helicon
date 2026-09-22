import { Database, Gauge } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "../../app/context.js";
import { formatDuration, formatExactTokens, formatTokensPerSecond } from "../../model/format.js";
import {
  sessionTelemetry,
  timePillLabel,
  usagePillLabel,
  type SessionTelemetry,
  type TelemetryModelUsage,
} from "../../model/usage.js";
import { Tip, FLOATING } from "../ui/overlays.js";

/** Qual diálogo de telemetria está aberto; no máximo um por vez. */
type TelemetryDialog = "time" | "usage" | null;

/**
 * As duas pílulas de telemetria acima do composer: o que a sessão desta conversa fez até aqui, cada
 * pílula abrindo seu detalhe. Tudo no cliente — cada número vem do fold da conversa.
 *
 * A porta só lê a preferência: desligado, o conteúdo nem monta, então nenhuma assinatura do fold
 * nem cálculo acontece quando a conversa muda.
 */
export function TelemetryPills(props: { sessionId: string }) {
  const enabled = useApp((s) => s.prefs.showTelemetry);
  if (!enabled) {
    return null;
  }
  return <TelemetryPillsBody sessionId={props.sessionId} />;
}

function TelemetryPillsBody(props: { sessionId: string }) {
  const fold = useApp((s) => s.threads[props.sessionId]?.fold ?? null);
  const truncated = useApp((s) => s.threads[props.sessionId]?.truncated ?? false);
  const telemetry = useMemo(() => (fold ? sessionTelemetry(fold, truncated) : null), [fold, truncated]);
  const [open, setOpen] = useState<TelemetryDialog>(null);
  if (!telemetry || !fold) {
    return null;
  }
  // Uma conversa retomada pode informar uso acumulado mesmo sem o histórico de chamadas.
  if (telemetry.turns === 0 && telemetry.steps === 0 && telemetry.totalTokens === 0 && !fold.activeTurnId) {
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-1.5">
      <Pill
        icon={<Gauge size={12} />}
        open={open === "time"}
        onOpenChange={(next) => setOpen(next ? "time" : null)}
        label={timePillLabel(telemetry)}
        tip="Tempo das chamadas ao modelo desta sessão"
        aria="Tempo da sessão"
      >
        <TimingPanel telemetry={telemetry} />
      </Pill>
      <Pill
        icon={<Database size={12} />}
        open={open === "usage"}
        onOpenChange={(next) => setOpen(next ? "usage" : null)}
        label={usagePillLabel(telemetry)}
        tip="Tokens usados nesta sessão"
        aria="Tokens da sessão"
      >
        <UsagePanel telemetry={telemetry} />
      </Pill>
    </div>
  );
}

/** Uma pílula com seu diálogo, como os medidores de custo e contexto ao lado do composer. */
function Pill(props: {
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  tip: string;
  aria: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Tip label={props.tip}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={props.aria}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-2xs text-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
          >
            <span className="shrink-0">{props.icon}</span>
            {props.label}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          {...FLOATING}
          className="pop z-[var(--z-dropdown)] max-h-[var(--radix-popover-content-available-height)] w-[340px] max-w-[calc(100dvw-24px)] overflow-y-auto rounded-xl bg-raised text-fg shadow-pop outline-none"
        >
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Tempo de modelo, etapas, velocidade média por chamada e quanto da sessão foi de fato cronometrado. */
function TimingPanel(props: { telemetry: SessionTelemetry }) {
  const t = props.telemetry;
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div>
        <p className="text-sm font-semibold text-fg">
          {t.timedCalls > 0 ? formatDuration(t.durationMs) : "—"} <span className="font-normal text-subtle">de tempo de modelo</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {t.partial
            ? "Histórico parcial: tempo, turnos e etapas cobrem só as chamadas carregadas."
            : t.timedCalls === t.steps
              ? "Todas as chamadas informaram quanto tempo levaram."
              : "Algumas chamadas não informaram quanto tempo levaram."}
        </p>
      </div>
      <dl className="flex flex-col gap-1 text-xs">
        <Row label="Etapas" value={`${t.steps}`} />
        <Row label="Média por chamada" value={t.tokensPerSecond === null ? "—" : formatTokensPerSecond(t.tokensPerSecond)} />
        <Row label="Cronometradas" value={`${t.timedCalls} de ${t.steps} chamadas`} />
      </dl>
      <ModelBreakdown models={t.models} />
    </div>
  );
}

/** Contagens exatas de tokens, com a divisão do cache e os mesmos totais por modelo do painel de tempo. */
function UsagePanel(props: { telemetry: SessionTelemetry }) {
  const t = props.telemetry;
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div>
        <p className="text-sm font-semibold text-fg">
          {formatExactTokens(t.totalTokens)}{t.totalsComplete ? "" : "+"} <span className="font-normal text-subtle">tokens</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {t.partial
            ? t.totalsComplete
              ? "Os totais de tokens da sessão estão completos. Cache, raciocínio e detalhes por modelo cobrem só as chamadas carregadas."
              : "Histórico parcial: contagens e detalhes cobrem só as chamadas carregadas."
            : "Contagens exatas sobre todas as chamadas ao modelo desta conversa."}
        </p>
      </div>
      <dl className="flex flex-col gap-1 text-xs">
        <Row label="Saída" value={formatExactTokens(t.outputTokens)} />
        {t.reasoningTokens > 0 ? (
          <div className="pl-2 text-2xs text-subtle tabular-nums">
            {t.partial ? "chamadas carregadas incluem " : "inclui "}{formatExactTokens(t.reasoningTokens)} de raciocínio
          </div>
        ) : null}
        <Row label={t.partial ? "Entrada sem cache carregada" : "Entrada sem cache"} value={formatExactTokens(t.uncachedTokens)} />
        <Row label={t.partial ? "Entrada em cache carregada" : "Entrada em cache"} value={formatExactTokens(t.cachedTokens)} />
        {t.cacheWriteTokens > 0 ? <Row label={t.partial ? "Escrita em cache carregada" : "Escrita em cache"} value={formatExactTokens(t.cacheWriteTokens)} /> : null}
        <Row label={t.partial ? "Acerto de cache carregado" : "Acerto de cache"} value={t.cacheHitPct === null ? "—" : `${t.cacheHitPct}%`} />
      </dl>
      <ModelBreakdown models={t.models} />
    </div>
  );
}

function ModelBreakdown(props: { models: TelemetryModelUsage[] }) {
  if (props.models.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      {props.models.map((model) => (
        <div key={model.modelId} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-fg">{model.name}</span>
          <span className="shrink-0 text-muted tabular-nums">{model.calls === 1 ? "1 chamada" : `${model.calls} chamadas`}</span>
          <span className="w-20 shrink-0 text-right text-muted tabular-nums">{formatExactTokens(model.outputTokens)} saída</span>
        </div>
      ))}
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{props.label}</dt>
      <dd className="tabular-nums text-fg">{props.value}</dd>
    </div>
  );
}
