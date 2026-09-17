import { Popover } from "radix-ui";
import { shallowEqual, useApp } from "../../app/context.js";
import { formatTokens, modelDisplayName } from "../../model/format.js";
import { formatCost } from "../../model/pricing.js";
import { sessionUsage } from "../../model/usage.js";
import { Tip, FLOATING } from "../ui/overlays.js";

/** Quanto esta conversa teria custado na cobrança por API, ao lado do medidor de contexto. */
export function CostMeter(props: { sessionId: string }) {
  const total = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    if (!fold) {
      return null;
    }
    const usage = sessionUsage(fold, s.models);
    return usage.cost === null ? null : { cost: usage.cost, currency: usage.currency, complete: usage.costComplete };
  }, shallowEqual);
  if (!total || total.cost <= 0) {
    return null;
  }
  return (
    <Popover.Root>
      <Tip label="Quanto esta conversa custaria nas tarifas de API">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Custo da conversa ${formatCost(total.cost, total.currency ?? undefined)}`}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-2xs text-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
          >
            {formatCost(total.cost, total.currency ?? undefined)}
            {total.complete ? null : <span aria-hidden="true">+</span>}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          {...FLOATING}
          className="pop z-[var(--z-dropdown)] max-h-[var(--radix-popover-content-available-height)] w-[340px] max-w-[calc(100dvw-24px)] overflow-y-auto rounded-xl bg-raised text-fg shadow-pop outline-none"
        >
          <CostPanel sessionId={props.sessionId} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Montado só enquanto o popover está aberto, para uma conversa em streaming não recalcular. */
function CostPanel(props: { sessionId: string }) {
  const usage = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    return fold ? sessionUsage(fold, s.models) : null;
  });
  const prices = useApp((s) => s.models);
  if (!usage) {
    return null;
  }
  const currency = usage.currency ?? undefined;
  const fresh = Math.max(0, usage.promptTokens - usage.cacheReadTokens - usage.cachedTokens);
  const cached = Math.min(usage.promptTokens, usage.cacheReadTokens || usage.cachedTokens);
  const rate = (modelId: string) => prices.find((m) => m.modelId === modelId)?.cost ?? null;
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div>
        <p className="text-sm font-semibold text-fg">
          {formatCost(usage.cost ?? 0, currency)} <span className="font-normal text-subtle">nas tarifas de API</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {usage.costComplete
            ? "Quanto estes tokens teriam custado cobrados por token, não o que foi cobrado de você."
            : "Parte desta conversa rodou num modelo sem preço publicado, então o total é um piso."}
        </p>
      </div>

      <dl className="flex flex-col gap-1 text-xs">
        <Row label="Entrada" tokens={fresh} />
        <Row label="Entrada em cache" tokens={cached} />
        <Row label="Saída" tokens={usage.outputTokens} />
        {usage.reasoningTokens > 0 ? <Row label="disso, raciocínio" tokens={usage.reasoningTokens} muted /> : null}
        <Row label="Chamadas ao modelo" tokens={usage.calls} raw />
      </dl>

      {usage.models.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          {usage.models.map((model) => {
            const option = prices.find((m) => m.modelId === model.modelId);
            const price = option?.cost ?? rate(model.modelId);
            return (
              <div key={model.modelId} className="flex items-baseline justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-fg">
                    {modelDisplayName(model.modelId)}
                    {option?.contributor || /contributor/i.test(model.modelId) ? (
                      <span className="ml-1.5 rounded bg-active px-1 py-px align-middle text-2xs font-medium text-muted">colaborador</span>
                    ) : null}
                  </p>
                  <p className="text-2xs text-subtle tabular-nums">
                    {price
                      ? `${formatCost(price.input, currency)}/M entrada · ${formatCost(price.cached, currency)}/M cache · ${formatCost(price.output, currency)}/M saída`
                      : "sem preço publicado"}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-muted">{model.cost === null ? "—" : formatCost(model.cost, currency)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Row(props: { label: string; tokens: number; muted?: boolean; raw?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={props.muted ? "text-subtle" : "text-muted"}>{props.label}</dt>
      <dd className="tabular-nums text-fg">{props.raw ? props.tokens : formatTokens(props.tokens)}</dd>
    </div>
  );
}
