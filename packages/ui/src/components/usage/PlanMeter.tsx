import { Gauge } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useEffect, useMemo } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { relativeTime } from "../../model/format.js";
import { planView, type PlanTone, type PlanView } from "../../model/plan.js";
import { FLOATING } from "../ui/overlays.js";
import { cn } from "../ui/primitives.js";

const FILL: Record<PlanTone, string> = {
  ok: "bg-accent",
  warn: "bg-warn",
  danger: "bg-danger",
};

const TEXT: Record<PlanTone, string> = {
  ok: "text-muted",
  warn: "text-warn-text",
  danger: "text-danger-text",
};

function usePlan(): PlanView | null {
  const usage = useApp((s) => s.planUsage);
  // Um minuto basta para uma contagem regressiva medida em horas, e mantém parada uma barra ociosa.
  const now = useNow(60_000, usage !== null);
  return useMemo(() => planView(usage, now), [usage, now]);
}

/**
 * Quanto resta do plano do Muse Code, como o próprio Muse informou por último: a janela móvel e o teto
 * semanal. Esta é a franquia real, diferente do custo da página de uso, que precifica o mesmo trabalho em
 * tarifa de API.
 */
export function PlanMeter() {
  const controller = useController();
  const view = usePlan();
  const now = useNow(60_000, view !== null);
  useEffect(() => {
    void controller.loadPlanUsage();
  }, [controller]);
  if (!view) {
    return (
      <section aria-label="Uso do plano" className="rounded-2xl bg-raised px-4 py-3.5 shadow-card">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <Gauge size={15} className="text-subtle" /> Uso do plano
        </div>
        <p className="mt-1 text-xs text-pretty text-muted">
          O Muse informa a franquia do seu plano a cada chamada ao modelo. Mande um pedido em qualquer conversa e aparece aqui.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Uso do plano" className="rounded-2xl bg-raised px-4 py-3.5 shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Gauge size={15} className="shrink-0 text-subtle" />
        <h2 className="text-sm font-medium text-fg">Uso do plano</h2>
        {view.tier ? <span className="rounded-md bg-active px-1.5 py-px text-2xs font-medium text-muted">{view.tier}</span> : null}
        <span className="flex-1" />
        <span className={cn("text-2xs", view.stale ? "text-warn-text" : "text-subtle")}>{updatedLabel(view, now)}</span>
      </div>
      <div className="mt-3 grid gap-3 @min-[520px]:grid-cols-2">
        {view.rows.map((row) => (
          <div key={row.key} className="min-w-0">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted">{row.label}</span>
              <span className="flex-1" />
              <span className={cn("font-medium tabular-nums", TEXT[row.tone])}>{row.percent}% usados</span>
              <span className="shrink-0 text-2xs text-subtle">{view.age === "agora" ? "agora" : `há ${view.age}`}</span>
            </div>
            <div
              role="progressbar"
              aria-label={`${row.label} usados`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={row.percent}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-active"
            >
              <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", FILL[row.tone])} style={{ width: `${row.percent}%` }} />
            </div>
            <p className="mt-1 text-2xs text-subtle tabular-nums">{row.resets}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-2xs leading-4 text-pretty text-subtle">
        Estes números vêm do Muse a cada chamada ao modelo, então só mudam quando você envia um pedido em uma conversa aqui.
        O trabalho feito no terminal consome seu plano sem aparecer neste cartão.
      </p>
    </section>
  );
}

/** O Muse informa estes números a cada chamada ao modelo; a idade indica quando a leitura foi feita. */
function updatedLabel(view: PlanView, now: number): string {
  const age = relativeTime(new Date(view.observedAtMs).toISOString(), now);
  if (age === "agora") {
    return "Informado pelo Muse agora";
  }
  return `Informado pelo Muse há ${age}`;
}

/** Percentuais da janela móvel e semanal, compactos no rodapé; abre a página de uso. */
export function PlanPill() {
  const controller = useController();
  const view = usePlan();
  const first = view?.rows[0];
  const weekly = view?.rows.find((row) => row.key === "weekly");
  if (!view || !first) {
    return null;
  }
  const label = view.rows.map((row) => `${row.label}: ${row.percent}% usados, ${row.resets.toLowerCase()}`).join(". ");
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={`Uso do plano. ${label}`}
          onClick={() => controller.toggleUsage()}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium tabular-nums transition-colors duration-100 hover:bg-hover",
            TEXT[first.tone],
          )}
        >
          <Gauge size={12} />
          <span>{first.percent}%</span>
          {weekly ? (
            <>
              <span aria-hidden="true" className="mx-1 h-3 w-px shrink-0 bg-line-strong" />
              <span className={TEXT[weekly.tone]}>{weekly.percent}%</span>
            </>
          ) : null}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={8}
          {...FLOATING}
          className="pop z-[var(--z-tooltip)] w-[280px] max-w-[calc(100dvw-24px)] rounded-xl border border-[#42484c] bg-[#181a1b] px-4 py-3 text-xs text-[#eceef0] shadow-lg"
        >
          <div className="divide-y divide-[#42484c]">
            {view.rows.map((row) => (
              <div key={row.key} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3 font-medium">
                  <span>{row.label}</span>
                  <span className="shrink-0 tabular-nums">{row.percent}% usados</span>
                </div>
                <p className="mt-1 text-[#adb3b8] tabular-nums">{row.resets}</p>
              </div>
            ))}
          </div>
          <Tooltip.Arrow asChild width={16} height={8}>
            <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
              <path d="M0 0 L8 8 L16 0" fill="#181a1b" stroke="#42484c" strokeWidth="1" />
            </svg>
          </Tooltip.Arrow>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
