import { Switch } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../ui/primitives.js";

/** O controle de uma linha: uma escolha entre poucas. Rola de lado quando a linha é estreita demais. */
export function Pick<T extends string | null>(props: {
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain rounded-lg bg-sunken p-0.5 [scrollbar-width:thin]">
      {props.options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.hint}
          aria-pressed={props.value === option.value}
          disabled={props.disabled}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40",
            props.value === option.value ? "bg-raised text-fg shadow-btn" : "text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch.Root
      checked={props.checked}
      onCheckedChange={props.onChange}
      disabled={props.disabled}
      aria-label={props.label}
      className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-line-strong outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent"
    >
      <Switch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-150 ease-out data-[state=checked]:translate-x-4" />
    </Switch.Root>
  );
}

/** Subtítulo dentro de uma página de Configurações, para agrupar linhas sem virar outra seção. */
export function Subhead(props: { children: ReactNode }) {
  return <h2 className="mt-6 mb-2 text-2xs font-semibold tracking-wide text-subtle uppercase first:mt-0">{props.children}</h2>;
}

/** O cartão que agrupa as linhas de um bloco. */
export function Card(props: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl bg-raised shadow-card">{props.children}</div>;
}

export function Row(props: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0">
      {/* Um piso no rótulo, ou uma fileira larga de opções o espreme a uma palavra por linha em vez de quebrar. */}
      <div className="min-w-[13rem] flex-1 basis-64">
        <p className="text-sm text-fg">{props.label}</p>
        {props.description ? <p className="mt-0.5 text-xs text-pretty text-muted">{props.description}</p> : null}
      </div>
      {props.children ? <div className="min-w-0 w-full @min-[520px]:w-auto">{props.children}</div> : null}
    </div>
  );
}

/** Um fato sobre a instalação, não uma configuração: mostrado para que a resposta esteja aqui, não num balão. */
export function Fact(props: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 first:border-t-0">
      <p className="text-sm text-muted">{props.label}</p>
      <p className="min-w-0 font-mono text-xs break-all text-fg">{props.value}</p>
    </div>
  );
}
