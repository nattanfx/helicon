import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp, useController } from "../../app/context.js";
import { useOverlayDragProps } from "../../app/frame.js";
import { basename, formatDuration, formatTokens, modelDisplayName, relativeTime } from "../../model/format.js";
import { costOf, formatCost, listedPrice, type TokenPrice } from "../../model/pricing.js";
import { fillUsageDays, USAGE_RANGES } from "../../model/usage-range.js";
import type { ModelOption, UsageBucket, UsageReport, UsageThread } from "../../types.js";
import { Button, Spinner, cn } from "../ui/primitives.js";
import { TopBar } from "../chrome.js";
import { PlanMeter } from "./PlanMeter.js";
import { Tip } from "../ui/overlays.js";

/** Uma cor por modelo, na ordem em que aparecem; o destaque lidera e as demais se afastam dele. */
const SERIES = [
  "var(--accent)",
  "color-mix(in oklch, var(--accent) 55%, var(--fg-muted))",
  "color-mix(in oklch, var(--accent) 30%, var(--fg-subtle))",
  "color-mix(in oklch, var(--ok) 70%, var(--fg-muted))",
  "color-mix(in oklch, var(--warn) 70%, var(--fg-muted))",
  "var(--fg-subtle)",
];

function priceFor(modelId: string, models: readonly ModelOption[]): TokenPrice | null {
  const catalog = models.find((m) => m.modelId === modelId)?.cost;
  if (catalog) {
    return { input: catalog.input, output: catalog.output, cached: catalog.cached, currency: catalog.currency ?? "USD" };
  }
  return listedPrice(modelId);
}

function bucketCost(bucket: UsageBucket, price: TokenPrice | null): number {
  if (!price) {
    return 0;
  }
  return costOf(price, { promptTokens: bucket.promptTokens, outputTokens: bucket.outputTokens, cachedTokens: bucket.cachedTokens });
}

export function UsagePage() {
  const controller = useController();
  const models = useApp((s) => s.models);
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    controller
      .usageReport(days)
      .then((next) => live && setReport(next))
      .catch((failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      live = false;
    };
  }, [controller, days]);

  const view = useMemo(() => (report ? summarize(report, models) : null), [report, models]);
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  const drag = useOverlayDragProps();

  return (
    <div className="@container flex h-full min-w-0 flex-col">
      {collapsed ? <TopBar /> : null}
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <header {...drag} className="mx-auto flex w-full max-w-[980px] shrink-0 flex-wrap items-center gap-3 px-4 pt-6 pb-4 @min-[520px]:px-6 sm:pt-8">
        <Button size="sm" variant="ghost" onClick={() => controller.goBack()}>
          <ArrowLeft size={14} /> Voltar
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-fg">Uso</h1>
          <p className="text-pretty text-xs text-muted">Quanto estas conversas teriam custado cobradas por token, não o que seu plano cobrou.</p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-sunken p-0.5 @min-[520px]:ml-auto @min-[520px]:w-auto">
          {USAGE_RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-medium transition-colors duration-100",
                days === range.days ? "bg-raised text-fg shadow-btn" : "text-muted hover:text-fg",
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto w-full min-w-0 max-w-[980px] px-4 pb-16 @min-[520px]:px-6">
        <div className="mb-6">
          <PlanMeter />
        </div>
        {error ? (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-text">{error}</p>
        ) : !view ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted">
            <Spinner size={13} /> Lendo uso
          </div>
        ) : view.calls === 0 ? (
          <EmptyUsage />
        ) : (
          <div className="flex flex-col gap-6">
            <Totals view={view} />
            <DailyChart view={view} />
            <Models view={view} />
            <Threads view={view} />
            <p className="text-xs text-subtle">
              Os preços são as tarifas publicadas pela Meta por milhão de tokens, ou o preço de catálogo do próprio modelo quando ele
              tem um. Níveis de colaborador são cobrados à parte e marcados como tal.
            </p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

interface ModelRow {
  modelId: string;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  price: TokenPrice | null;
  contributor: boolean;
}

interface DayRow {
  day: string;
  cost: number;
  byModel: { modelId: string; cost: number }[];
}

interface UsageView {
  calls: number;
  cost: number;
  currency: string;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  modelMs: number;
  cacheSaved: number;
  models: ModelRow[];
  days: DayRow[];
  threads: (UsageThread & { cost: number })[];
  unpriced: number;
}

function summarize(report: UsageReport, models: readonly ModelOption[]): UsageView {
  const byModel = new Map<string, ModelRow>();
  const byDay = new Map<string, DayRow>();
  let cost = 0;
  let calls = 0;
  let promptTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let modelMs = 0;
  let cacheSaved = 0;
  let unpriced = 0;
  let currency = "USD";

  for (const bucket of report.buckets) {
    const price = priceFor(bucket.modelId, models);
    const amount = bucketCost(bucket, price);
    if (!price) {
      unpriced += bucket.calls;
    } else {
      currency = price.currency;
      cacheSaved += (bucket.cachedTokens * (price.input - price.cached)) / 1_000_000;
    }
    cost += amount;
    calls += bucket.calls;
    promptTokens += bucket.promptTokens;
    cachedTokens += bucket.cachedTokens;
    outputTokens += bucket.outputTokens;
    reasoningTokens += bucket.reasoningTokens;
    modelMs += bucket.durationMs;

    const row = byModel.get(bucket.modelId) ?? {
      modelId: bucket.modelId,
      calls: 0,
      promptTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      price,
      contributor: /contributor/i.test(bucket.modelId),
    };
    row.calls += bucket.calls;
    row.promptTokens += bucket.promptTokens;
    row.cachedTokens += bucket.cachedTokens;
    row.outputTokens += bucket.outputTokens;
    row.reasoningTokens += bucket.reasoningTokens;
    row.cost += amount;
    byModel.set(bucket.modelId, row);

    const day = byDay.get(bucket.day) ?? { day: bucket.day, cost: 0, byModel: [] };
    day.cost += amount;
    const slice = day.byModel.find((s) => s.modelId === bucket.modelId);
    if (slice) {
      slice.cost += amount;
    } else {
      day.byModel.push({ modelId: bucket.modelId, cost: amount });
    }
    byDay.set(bucket.day, day);
  }

  const modelRows = [...byModel.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  const threads = report.threads
    .map((thread) => {
      // A parcela de cada modelo em sua própria tarifa: uma conversa que mudou de nível não tem um preço único.
      const shares = thread.models ?? [
        {
          modelId: thread.modelIds[0] ?? "",
          calls: thread.calls,
          promptTokens: thread.promptTokens,
          outputTokens: thread.outputTokens,
          cachedTokens: thread.cachedTokens,
        },
      ];
      const cost = shares.reduce((total, share) => {
        const price = priceFor(share.modelId, models);
        return price
          ? total +
              costOf(price, { promptTokens: share.promptTokens, outputTokens: share.outputTokens, cachedTokens: share.cachedTokens })
          : total;
      }, 0);
      return { ...thread, cost };
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  return {
    calls,
    cost,
    currency,
    promptTokens,
    cachedTokens,
    outputTokens,
    reasoningTokens,
    modelMs,
    cacheSaved,
    models: modelRows,
    days: fillUsageDays([...byDay.values()], report, (day) => ({ day, cost: 0, byModel: [] })),
    threads,
    unpriced,
  };
}

function Card(props: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-raised px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
      <p className="text-xs text-muted">{props.label}</p>
      <p className="text-xl font-semibold text-fg tabular-nums">{props.value}</p>
      {props.detail ? <p className="text-2xs text-subtle">{props.detail}</p> : null}
    </div>
  );
}

function Totals(props: { view: UsageView }) {
  const { view } = props;
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card
        label="Custo na tarifa de API"
        value={formatCost(view.cost, view.currency)}
        detail={view.unpriced > 0 ? `${view.unpriced} chamadas sem preço publicado` : `${view.calls} chamadas ao modelo`}
      />
      <Card label="Tokens de entrada" value={formatTokens(view.promptTokens)} detail={`${formatTokens(view.cachedTokens)} vindos do cache`} />
      <Card
        label="Tokens de saída"
        value={formatTokens(view.outputTokens)}
        detail={view.reasoningTokens > 0 ? `${formatTokens(view.reasoningTokens)} de raciocínio` : undefined}
      />
      <Card
        label="Cache economizou"
        value={formatCost(view.cacheSaved, view.currency)}
        detail={view.modelMs > 0 ? `${formatDuration(view.modelMs)} de tempo de modelo` : undefined}
      />
    </section>
  );
}

function DailyChart(props: { view: UsageView }) {
  const { view } = props;
  const max = Math.max(...view.days.map((d) => d.cost), 0.000001);
  const order = view.models.map((m) => m.modelId);
  return (
    <section className="min-w-0 overflow-hidden rounded-xl bg-raised px-4 py-4 shadow-[0_0_0_1px_var(--border)]">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-fg">Custo por dia</h2>
        <span className="text-2xs text-subtle tabular-nums">pico {formatCost(max, view.currency)}</span>
      </div>
      <div className="flex h-40 min-w-0 items-end gap-px overflow-hidden">
        {view.days.map((day) => (
          <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <Tip label={`${day.day}: ${formatCost(day.cost, view.currency)}`}>
              <div tabIndex={0} className="group/bar flex h-full w-full min-w-0 flex-col justify-end rounded-t-[3px]">
                {day.byModel
                  .slice()
                  .sort((a, b) => order.indexOf(a.modelId) - order.indexOf(b.modelId))
                  .map((slice) => (
                    <div
                      key={slice.modelId}
                      style={{
                        height: `${Math.max((slice.cost / max) * 100, slice.cost > 0 ? 1.5 : 0)}%`,
                        background: SERIES[Math.max(0, order.indexOf(slice.modelId)) % SERIES.length],
                      }}
                      className="w-full first:rounded-t-[3px] transition-opacity duration-100 group-hover/bar:opacity-80"
                    />
                  ))}
              </div>
            </Tip>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-2xs text-subtle tabular-nums">
        <span>{view.days[0]?.day ?? ""}</span>
        <span>{view.days[view.days.length - 1]?.day ?? ""}</span>
      </div>
    </section>
  );
}

function Models(props: { view: UsageView }) {
  const { view } = props;
  const max = Math.max(...view.models.map((m) => m.cost), 0.000001);
  return (
    <section className="rounded-xl bg-raised px-4 py-4 shadow-[0_0_0_1px_var(--border)]">
      <h2 className="mb-3 text-sm font-semibold text-fg">Por modelo</h2>
      <div className="flex flex-col gap-3">
        {view.models.map((model, index) => (
          <div key={model.modelId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="size-2 shrink-0 rounded-[3px]" style={{ background: SERIES[index % SERIES.length] }} aria-hidden="true" />
                <span className="truncate text-sm text-fg">{modelDisplayName(model.modelId)}</span>
                {model.contributor ? (
                  <span className="shrink-0 rounded bg-active px-1 py-px text-2xs font-medium text-muted">colaborador</span>
                ) : null}
              </div>
              <span className="shrink-0 text-sm text-fg tabular-nums">{formatCost(model.cost, view.currency)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max((model.cost / max) * 100, 2)}%`, background: SERIES[index % SERIES.length] }}
              />
            </div>
            <p className="text-2xs text-subtle tabular-nums">
              {model.calls} chamadas · {formatTokens(model.promptTokens)} de entrada ({formatTokens(model.cachedTokens)} do cache) ·{" "}
              {formatTokens(model.outputTokens)} de saída
              {model.price
                ? ` · ${formatCost(model.price.input, view.currency)}/M de entrada, ${formatCost(model.price.output, view.currency)}/M de saída`
                : " · sem preço publicado"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Threads(props: { view: UsageView }) {
  const controller = useController();
  const { view } = props;
  if (view.threads.length === 0) {
    return null;
  }
  return (
    <section className="rounded-xl bg-raised px-4 py-4 shadow-[0_0_0_1px_var(--border)]">
      <h2 className="mb-3 text-sm font-semibold text-fg">Conversas mais caras</h2>
      <ul className="flex flex-col">
        {view.threads.map((thread) => (
          <li key={thread.sessionId}>
            <button
              type="button"
              onClick={() => controller.openThread(thread.sessionId)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-100 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{thread.title ?? "Nova conversa"}</p>
                <p className="truncate text-2xs text-subtle tabular-nums">
                  {thread.cwd ? `${basename(thread.cwd)} · ` : ""}
                  {thread.calls} chamadas · {formatTokens(thread.promptTokens + thread.outputTokens)} tokens · {relativeTime(thread.lastAt)}
                </p>
              </div>
              <span className="shrink-0 text-sm text-fg tabular-nums">{formatCost(thread.cost, view.currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyUsage() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-raised px-6 py-16 text-center shadow-[0_0_0_1px_var(--border)]">
      <p className="text-sm font-medium text-fg">Nenhuma chamada ao modelo neste período</p>
      <p className="max-w-[42ch] text-xs text-muted">
        Isto se preenche conforme as conversas executam. Abrir uma conversa mais antiga também preenche o que ela gastou, então suas
        chamadas aparecem aqui também.
      </p>
    </div>
  );
}
