import { BookOpen, Brain, CornerDownLeft, Cpu, FileText, GitFork, History, Minimize2, Shield, SquarePen, Target } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import type { SlashAction, SlashCommand } from "../../model/slash.js";
import { Spinner, cn } from "../ui/primitives.js";

/** O que o menu acima do composer mostra enquanto uma mensagem começa com barra. */
export type SlashMenuState =
  | { kind: "list"; items: SlashCommand[]; loading: boolean; error: string | null }
  | { kind: "unknown"; name: string }
  | { kind: "loading" };

const ACTION_ICONS: Record<SlashAction, ReactNode> = {
  compact: <Minimize2 size={14} />,
  model: <Cpu size={14} />,
  effort: <Brain size={14} />,
  permissions: <Shield size={14} />,
  fork: <GitFork size={14} />,
  new: <SquarePen size={14} />,
  resume: <History size={14} />,
  init: <FileText size={14} />,
  skill: <BookOpen size={14} />,
  goal: <Target size={14} />,
};

/** De onde vem uma skill, para as que não são nativas do Muse. */
const SCOPE_LABELS: Record<string, string> = { user: "Pessoal", project: "Projeto", plugin: "Plug-in" };

export function slashOptionId(menuId: string, index: number): string {
  return `${menuId}-option-${index}`;
}

const ROW = "flex min-h-9 cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm select-none";

/**
 * A listbox que a área de texto do composer controla. O foco nunca sai da área de texto: as linhas agem no
 * clique do mouse, e as setas movem a linha ativa via `aria-activedescendant`.
 */
export function SlashMenu(props: {
  id: string;
  state: SlashMenuState;
  /** Acima do composer no pé de uma conversa; abaixo dele na tela de nova conversa, onde fica perto do topo. */
  placement: "above" | "below";
  active: number;
  onActive: (index: number) => void;
  onPick: (command: SlashCommand) => void;
  onSendRaw: () => void;
}) {
  const { state, active } = props;

  useEffect(() => {
    document.getElementById(slashOptionId(props.id, active))?.scrollIntoView({ block: "nearest" });
  }, [props.id, active, state]);

  const grouped = state.kind === "list" && state.items.some((i) => i.kind === "action") && state.items.some((i) => i.kind === "skill");

  return (
    <div
      id={props.id}
      role="listbox"
      aria-label="Comandos e skills"
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "absolute inset-x-0 z-[var(--z-dropdown)] flex max-h-[min(380px,48vh)] flex-col overflow-hidden rounded-xl bg-raised text-fg shadow-pop",
        props.placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {state.kind === "list"
          ? state.items.map((item, index) => {
              const selected = index === active;
              const heading = grouped && (index === 0 || state.items[index - 1]?.kind !== item.kind);
              const scope = item.skill ? SCOPE_LABELS[item.skill.scope] : undefined;
              return (
                <div key={`${item.kind}:${item.name}`} role="presentation">
                  {heading ? (
                    <div role="presentation" className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">
                      {item.kind === "action" ? "Comandos" : "Skills"}
                    </div>
                  ) : null}
                  <div
                    id={slashOptionId(props.id, index)}
                    role="option"
                    aria-selected={selected}
                    title={item.skill ? item.skill.description : undefined}
                    onMouseMove={() => props.onActive(index)}
                    onClick={() => props.onPick(item)}
                    className={cn(ROW, selected && "bg-hover")}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-muted">
                      {item.action ? ACTION_ICONS[item.action] : ACTION_ICONS.skill}
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 font-medium">/{item.name}</span>
                      {item.hint ? <span className="shrink-0 text-xs text-subtle">{item.hint}</span> : null}
                      <span className="min-w-0 truncate text-xs text-muted">{item.description}</span>
                    </span>
                    {scope ? <span className="shrink-0 text-2xs text-subtle">{scope}</span> : null}
                  </div>
                </div>
              );
            })
          : null}
        {state.kind === "list" && state.loading ? (
          <div role="presentation" className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
            <Spinner size={12} />
            Carregando skills
          </div>
        ) : null}
        {state.kind === "list" && !state.loading && state.error ? (
          <p role="presentation" className="px-2 py-1.5 text-xs text-muted [overflow-wrap:anywhere]">
            As skills não carregaram: {state.error}
          </p>
        ) : null}
        {state.kind === "unknown" ? (
          <div
            id={slashOptionId(props.id, 0)}
            role="option"
            aria-selected
            onClick={props.onSendRaw}
            className={cn(ROW, "bg-hover")}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-muted">
              <CornerDownLeft size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Nenhum comando chamado <span className="font-medium">/{state.name}</span>
            </span>
            <span className="shrink-0 text-xs text-muted">Enviar como prompt</span>
          </div>
        ) : null}
        {state.kind === "loading" ? (
          <div id={slashOptionId(props.id, 0)} role="option" aria-selected aria-disabled className={cn(ROW, "text-muted")}>
            <Spinner size={12} />
            Carregando skills
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-3 py-1.5 text-2xs text-subtle">
        {state.kind === "list" ? (
          <>
            <span>Enter para executar</span>
            <span>Tab para completar</span>
          </>
        ) : state.kind === "unknown" ? (
          <span>Enter para enviar como prompt</span>
        ) : null}
        <span>Esc para fechar</span>
      </div>
    </div>
  );
}
