import {
  ArrowUp,
  Brain,
  ChevronDown,
  CircleHelp,
  Cpu,
  Folder,
  GitBranch,
  Lock,
  Minimize2,
  Shield,
  ShieldAlert,
  ShieldQuestion,
  Square,
  SquareTerminal,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AttachButton, AttachmentTray, readFiles, restoreFiles, toOutgoing, toPreview, type PendingFile } from "./attachments.js";
import { CostMeter } from "./CostPanel.js";
import { Popover, Slider, Switch } from "radix-ui";
import { shallowEqual, useApp, useController } from "../../app/context.js";
import { useSampled } from "../../app/sampled.js";
import { basename, CONTRIBUTOR_LABEL, CONTRIBUTOR_NOTICE, formatDuration, formatSpeed, formatTokens, modelDisplayName } from "../../model/format.js";
import { matchSlash, parseSlash, resolveSlash, slashCommands, type SlashCommand } from "../../model/slash.js";
import type { SkillsState } from "../../model/store.js";
import { lastTurnSpeed, streamingSpeed } from "../../model/usage.js";
import type { ApprovalMode, ReasoningEffort } from "../../types.js";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuOption, MenuRadioGroup, MenuSeparator, MenuTrigger, Modal, Tip, FLOATING } from "../ui/overlays.js";
import { Button, IconButton, MOD, Spinner, cn } from "../ui/primitives.js";
import { PixelFlow } from "../ui/PixelFlow.js";
import { ContextMeter } from "./ContextPanel.js";
import { SlashMenu, slashOptionId, type SlashMenuState } from "./SlashMenu.js";
import { SwapIcon } from "../ui/sourced.js";

const DRAFT_PREFIX = "helicon.draft.";

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

/** Um rascunho da caixa de mensagem que sobrevive a trocar de conversa e a recarregar. */
function useDraft(key: string): [string, (value: string) => void] {
  const [state, setState] = useState(() => ({ key, value: readDraft(key) }));
  const value = state.key === key ? state.value : readDraft(key);
  if (state.key !== key) {
    setState({ key, value });
  }
  const set = useCallback(
    (next: string) => {
      setState({ key, value: next });
      try {
        if (next) {
          window.localStorage.setItem(DRAFT_PREFIX + key, next);
        } else {
          window.localStorage.removeItem(DRAFT_PREFIX + key);
        }
      } catch {
        /* rascunhos são melhor-esforço */
      }
    },
    [key],
  );
  return [value, set];
}

/** O menu de barra para um rascunho, com o que escolher uma linha escreve na frente do nome do comando. */
type SlashMenuView = SlashMenuState & { prefix: string };

/**
 * O que o menu mostra para o rascunho e o cursor. Enquanto o cursor está na primeira palavra, ele lista
 * comandos coincidentes; `/skill <nome>` lista skills; depois disso só aparece para sinalizar um comando
 * que o Muse não conhece.
 */
function slashMenuFor(text: string, caret: number, commands: SlashCommand[], skills: SkillsState | undefined): SlashMenuView | null {
  const first = /^\/(\S*)/.exec(text);
  if (!first) {
    return null;
  }
  const loading = !skills || skills.status === "loading";
  const error = skills?.status === "error" ? skills.error : null;
  // Só enquanto digita a palavra do comando: um cursor antes da barra não está digitando um comando.
  if (caret >= 1 && caret <= first[0].length) {
    const query = first[1] as string;
    const items = matchSlash(commands, query);
    if (items.length > 0 || !query) {
      return { kind: "list", items, loading, error, prefix: "/" };
    }
    return loading ? { kind: "loading", prefix: "/" } : { kind: "unknown", name: query.toLowerCase(), prefix: "/" };
  }
  const naming = /^\/skill\s+(\S*)$/i.exec(text);
  if (naming && caret === text.length) {
    const items = matchSlash(
      commands.filter((c) => c.kind === "skill"),
      naming[1] as string,
    );
    if (items.length > 0) {
      return { kind: "list", items, loading, error, prefix: "/skill " };
    }
  }
  const parsed = parseSlash(text);
  if (!parsed || resolveSlash(parsed, commands, skills?.skills ?? []).kind !== "unknown") {
    return null;
  }
  return loading ? { kind: "loading", prefix: "/" } : { kind: "unknown", name: parsed.name, prefix: "/" };
}

/** Tantos arquivos por mensagem quantos o servidor aceita. */
const MAX_FILES = 10;

export interface ComposerProps {
  sessionId: string | null;
  cwd: string | null;
  running: boolean;
  readOnly: boolean;
  variant: "thread" | "home";
  autoFocus?: boolean;
}

export function Composer(props: ComposerProps) {
  const controller = useController();
  const draftKey = props.sessionId ?? `new:${props.cwd ?? ""}`;
  const [text, setText] = useDraft(draftKey);
  // Um pedido que falhou ao enviar de outra caixa (a tela de nova conversa) volta para cá.
  const handoff = useApp((s) => (s.draftHandoff?.key === draftKey ? s.draftHandoff : null));
  useEffect(() => {
    if (handoff) {
      const handed = controller.takeDraftHandoff(draftKey);
      if (handed) {
        setText(handed.text);
        if (handed.attachments?.length) {
          setFiles(restoreFiles(handed.attachments, handed.previews ?? []));
        }
      }
    }
  }, [handoff, draftKey, controller, setText]);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Um aperto de tecla, um envio: limpar é estado do React, então um segundo Enter no mesmo quadro relê
  // o mesmo rascunho. O marcador é síncrono onde o estado não é; só um rascunho inalterado combina com
  // ele, então uma mensagem genuinamente nova digitada com um envio em voo ainda vai.
  const consumedRef = useRef<{ value: string; files: PendingFile[] | null } | null>(null);
  const tryConsume = (value: string, files: PendingFile[] | null): boolean => {
    const last = consumedRef.current;
    if (last && last.value === value && last.files === files) {
      return false;
    }
    consumedRef.current = { value, files };
    return true;
  };
  const id = useId();
  const menuId = useId();
  const starting = useApp((s) => Boolean(s.busy["start"]));
  const stopping = useApp((s) => (props.sessionId ? Boolean(s.busy[`stop:${props.sessionId}`]) : false));
  const hasText = text.trim().length > 0;
  const showStop = props.running && Boolean(props.sessionId) && !hasText;
  const shell = !props.readOnly && /^!\s*\S/.test(text);

  // Arquivos pegam carona na próxima mensagem: o Muse vê imagens ele mesmo, qualquer outra coisa cai na pasta do projeto.
  const [files, setFiles] = useState<PendingFile[]>([]);
  const addFiles = (incoming: Iterable<File>) => {
    if (props.readOnly) {
      return;
    }
    void readFiles(incoming).then((read) => setFiles((current) => [...current, ...read].slice(0, MAX_FILES)));
  };
  const removeFile = (id: string) => {
    setFiles((current) => {
      const gone = current.find((file) => file.id === id);
      if (gone?.url) {
        URL.revokeObjectURL(gone.url);
      }
      return current.filter((file) => file.id !== id);
    });
  };

  // O menu de barra: quais comandos coincidem, qual linha está ativa e se o Esc o fechou para esta palavra.
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const skills = useApp((s) => (props.cwd ? s.skills[props.cwd] : undefined));
  const slashing = !props.readOnly && text.startsWith("/");
  useEffect(() => {
    if (slashing && props.cwd) {
      void controller.loadSkills(props.cwd);
    }
  }, [slashing, props.cwd, controller]);
  const commands = useMemo(
    () => slashCommands(skills?.skills ?? [], { inThread: Boolean(props.sessionId) }),
    [skills?.skills, props.sessionId],
  );
  const word = /^\/\S*/.exec(text)?.[0] ?? null;
  /** O menu para uma posição de cursor. As teclas leem o cursor ao vivo: um rascunho restaurado o move sem evento de seleção. */
  const menuAt = (at: number): SlashMenuView | null => {
    const view = slashing ? slashMenuFor(text, at, commands, skills) : null;
    return view && dismissed !== word ? view : null;
  };
  const menu = menuAt(caret);
  const rows = menu?.kind === "list" ? menu.items.length : menu ? 1 : 0;
  const activeRow = Math.max(0, Math.min(active, rows - 1));
  useEffect(() => {
    setActive(0);
  }, [word, menu?.kind, menu?.prefix]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
    // Um rascunho restaurado, devolvido ou preenchido põe o cursor no fim sem evento de seleção.
    setCaret(el.selectionStart);
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (props.autoFocus && !props.readOnly && el) {
      el.focus({ preventScroll: true });
      // Focar põe o cursor antes de um rascunho restaurado; continue digitando no fim dele.
      el.setSelectionRange(el.value.length, el.value.length);
      setCaret(el.value.length);
    }
  }, [props.autoFocus, props.readOnly, props.sessionId, props.cwd]);

  const submit = async (steer: boolean) => {
    if ((!hasText && files.length === 0) || props.readOnly || starting) {
      return;
    }
    const value = text;
    const outgoing = files;
    if (!tryConsume(value, outgoing)) {
      return;
    }
    setText("");
    setFiles([]);
    const sent = await controller.send(value, {
      steer,
      attachments: outgoing.map(toOutgoing),
      previews: outgoing.map(toPreview),
    });
    if (!sent) {
      consumedRef.current = null;
      setText(value);
      setFiles(outgoing);
    }
  };

  /** Executa um comando escolhido no menu, ou envia o rascunho como pedido simples quando o Muse não tem tal comando. */
  const runNow = async (value: string, raw: boolean) => {
    if (props.readOnly || starting) {
      return;
    }
    if (!tryConsume(value, null)) {
      return;
    }
    setText("");
    const sent = await controller.send(value, { raw });
    if (!sent) {
      consumedRef.current = null;
      setText(value);
    }
  };

  const fill = (prefix: string, command: SlashCommand) => {
    const next = `${prefix}${command.name} `;
    setText(next);
    setCaret(next.length);
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(next.length, next.length);
    });
  };

  const pick = (view: SlashMenuView, command: SlashCommand) => {
    if (view.prefix === "/" && command.kind === "action" && command.runsBare) {
      void runNow(`/${command.name}`, false);
    } else {
      fill(view.prefix, command);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const live = menuAt(event.currentTarget.selectionStart);
    if (live) {
      const list = live.kind === "list" ? live.items : [];
      const row = Math.max(0, Math.min(active, list.length - 1));
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && list.length > 0) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((row + step + list.length) % list.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(word);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && list[row]) {
        event.preventDefault();
        fill(live.prefix, list[row] as SlashCommand);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        // Um Enter segurado repete: o primeiro aperto já escolheu, então os seguintes não fazem nada.
        if (event.repeat) {
          return;
        }
        if (live.kind === "list" && list[row]) {
          pick(live, list[row] as SlashCommand);
        } else if (live.kind === "unknown") {
          void runNow(text, true);
        } else {
          // Skills ainda carregando: envia assim mesmo, e o controlador resolve o comando quando elas chegarem.
          void submit(props.running && (event.metaKey || event.ctrlKey));
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Um Enter segurado repete: o primeiro aperto já enviou, então os seguintes não fazem nada. Shift+Enter
      // continua repetindo, já que segurá-lo por várias linhas novas é de propósito.
      if (event.repeat) {
        return;
      }
      void submit(props.running && (event.metaKey || event.ctrlKey));
    } else if (event.key === "Escape" && props.running && !hasText && props.sessionId) {
      event.preventDefault();
      void controller.stop(props.sessionId);
    }
  };

  const placeholder = props.readOnly
    ? "Somente leitura enquanto outra sessão do Muse estiver com esta conversa"
    : props.running
      ? `Enfileire um complemento, ou aperte ${MOD}+Enter para juntar a esta mensagem`
      : props.variant === "home"
        ? "Descreva uma mudança, uma correção ou uma pergunta sobre o código. Use @caminho para apontar arquivos."
        : "Responda, ou peça a próxima mudança";

  const sendLabel = showStop ? "Parar a mensagem" : shell ? "Executar comando" : props.running ? "Enfileirar mensagem" : "Enviar";

  return (
    <div
      className={cn(
        "relative min-w-0 max-w-full rounded-[18px] bg-raised shadow-[0_0_0_1px_var(--border-strong),0_1px_2px_oklch(0_0_0/0.05)] transition-shadow duration-150 ease-out focus-within:shadow-[0_0_0_1px_color-mix(in_oklch,var(--fg)_30%,transparent),0_2px_8px_-2px_oklch(0_0_0/0.12)]",
        props.readOnly && "opacity-75",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          ref.current?.focus();
        }
      }}
      onPaste={(event) => {
        // Só assume a colagem quando a área de transferência tem arquivos de verdade; texto colado continua texto.
        if (event.clipboardData?.files?.length) {
          event.preventDefault();
          addFiles(Array.from(event.clipboardData.files));
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer?.files?.length) {
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      {menu ? (
        <SlashMenu
          id={menuId}
          state={menu}
          placement={props.variant === "home" ? "below" : "above"}
          active={activeRow}
          onActive={setActive}
          onPick={(command) => pick(menu, command)}
          onSendRaw={() => void runNow(text, true)}
        />
      ) : null}
      <label htmlFor={id} className="sr-only">
        Mensagem para o Muse
      </label>
      {shell ? (
        <div className="flex items-center gap-1.5 px-4 pt-2.5 text-xs text-muted">
          <SquareTerminal size={13} className="shrink-0" />
          <span className="truncate">
            O Helicon executa isto{props.cwd ? ` em ${basename(props.cwd)}` : ""}; a saída fica aqui até você enviá-la ao Muse
          </span>
        </div>
      ) : null}
      <AttachmentTray files={files} onRemove={removeFile} />
      <textarea
        id={id}
        ref={ref}
        value={text}
        rows={props.variant === "home" ? 3 : 1}
        disabled={props.readOnly}
        placeholder={placeholder}
        spellCheck
        role={menu ? "combobox" : undefined}
        aria-expanded={menu ? true : undefined}
        aria-controls={menu ? menuId : undefined}
        aria-autocomplete={menu ? "list" : undefined}
        aria-activedescendant={menu ? slashOptionId(menuId, activeRow) : undefined}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setCaret(event.currentTarget.selectionStart);
          if (!event.currentTarget.value.startsWith("/")) {
            setDismissed(null);
          }
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setDismissed(word)}
        onFocus={() => setDismissed(null)}
        className={cn(
          "block max-h-[40vh] min-h-[52px] w-full min-w-0 max-w-full resize-none overflow-x-hidden bg-transparent px-4 pb-1.5 text-md leading-relaxed text-fg outline-none [field-sizing:fixed] [overflow-wrap:anywhere] whitespace-pre-wrap placeholder:text-subtle focus-visible:outline-none disabled:cursor-not-allowed",
          shell ? "pt-1.5 font-mono text-sm" : "pt-3.5",
        )}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-0.5 px-2 pb-2">
        {/* A caixa de nova conversa fica no alto, então seus menus abrem para baixo; ainda viram quando não há espaço. */}
        <AttachButton onFiles={(picked) => addFiles(Array.from(picked))} disabled={props.readOnly || files.length >= MAX_FILES} />
        <ModelPicker sessionId={props.sessionId} side={props.variant === "home" ? "bottom" : "top"} />
        <EffortPicker side={props.variant === "home" ? "bottom" : "top"} />
        <AccessPicker sessionId={props.sessionId} side={props.variant === "home" ? "bottom" : "top"} />
        <span className="min-w-2 flex-1" />
        {props.sessionId ? <SpeedReadout sessionId={props.sessionId} /> : null}
        {props.sessionId ? <CostMeter sessionId={props.sessionId} /> : null}
        {props.sessionId ? <ContextMeter sessionId={props.sessionId} /> : null}
        {props.running && props.sessionId && hasText ? (
          <Tip label="Parar a mensagem" shortcut={["Esc"]}>
            <IconButton size="md" label="Parar a mensagem" disabled={stopping} onClick={() => void controller.stop(props.sessionId as string)}>
              <Square size={11} className="fill-current" />
            </IconButton>
          </Tip>
        ) : null}
        <Tip label={sendLabel} shortcut={[showStop ? "Esc" : "Enter"]}>
          <button
            type="button"
            aria-label={showStop ? "Parar a mensagem" : shell ? "Executar comando" : props.running ? "Enfileirar mensagem" : "Enviar mensagem"}
            disabled={showStop ? stopping : (!hasText && files.length === 0) || props.readOnly || starting}
            onClick={() => (showStop ? void controller.stop(props.sessionId as string) : void submit(false))}
            className={cn(
              "ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-95",
              showStop ? "bg-inverse text-inverse-fg" : "bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-active disabled:text-subtle",
            )}
          >
            <SwapIcon value={starting || stopping ? "busy" : showStop ? "stop" : "send"}>
              {starting || stopping ? (
                <Spinner size={13} />
              ) : showStop ? (
                <Square size={11} className="fill-current" />
              ) : (
                <ArrowUp size={16} strokeWidth={2.25} />
              )}
            </SwapIcon>
          </button>
        </Tip>
      </div>
    </div>
  );
}

const ToolbarTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: ReactNode; tone?: "warn" }
>(function ToolbarTrigger({ icon, label, tone, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-7 max-w-[240px] min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition-colors duration-100 hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg",
        tone === "warn" && "text-warn-text hover:text-warn-text",
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex min-w-0 items-center truncate">{label}</span>
      <ChevronDown size={12} className="shrink-0 opacity-60" />
    </button>
  );
});

/** Marca modelos de nível contribuidor. Nos menus a descrição da opção explica; no resto, uma dica explica. */
function ContributorBadge(props: { tip?: boolean }) {
  const badge = <span className="shrink-0 rounded-[5px] bg-warn-soft px-1 py-px text-2xs font-medium text-warn-text">{CONTRIBUTOR_LABEL}</span>;
  return props.tip ? <Tip label={CONTRIBUTOR_NOTICE}>{badge}</Tip> : badge;
}

/** Para que lado um menu da caixa abre: para longe da borda da tela contra a qual ela está. */
type PickerSide = "top" | "bottom";

function ModelPicker(props: { sessionId: string | null; side: PickerSide }) {
  const controller = useController();
  const open = useApp((s) => s.picker === "model");
  const models = useApp((s) => s.models);
  const sessionModel = useApp((s) =>
    props.sessionId ? (s.threads[props.sessionId]?.fold.meta.modelId ?? s.sessions[props.sessionId]?.modelId ?? null) : null,
  );
  const preferred = useApp((s) => s.prefs.defaultModelId);
  const current = props.sessionId ? sessionModel : (preferred ?? models.find((m) => m.isDefault)?.modelId ?? null);
  const model = models.find((m) => m.modelId === current);
  const contributor = model?.contributor ?? /contributor/i.test(current ?? "");
  return (
    <Menu open={open} onOpenChange={(next) => (next ? controller.setPicker("model") : controller.closePicker("model"))}>
      <MenuTrigger asChild>
        <ToolbarTrigger
          aria-label={`Modelo: ${modelDisplayName(current)}`}
          icon={<Cpu size={13} />}
          label={
            <>
              <span className="truncate">{modelDisplayName(current)}</span>
              {contributor ? (
                <span className="ml-1.5">
                  <ContributorBadge tip />
                </span>
              ) : null}
            </>
          }
        />
      </MenuTrigger>
      <MenuContent side={props.side} className="w-[330px]">
        <MenuLabel>Modelo</MenuLabel>
        {models.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-muted">A lista de modelos carrega quando o Muse estiver rodando.</p>
        ) : (
          <MenuRadioGroup value={current ?? ""} onValueChange={(value) => void controller.setModel(value)}>
            {models.map((m) => (
              <MenuOption
                key={m.modelId}
                value={m.modelId}
                label={modelDisplayName(m.modelId)}
                badge={m.contributor ? <ContributorBadge /> : null}
                description={
                  m.contributor
                    ? CONTRIBUTOR_NOTICE
                    : m.contextLimit
                      ? `contexto de ${formatTokens(m.contextLimit)} tokens`
                      : undefined
                }
              />
            ))}
          </MenuRadioGroup>
        )}
      </MenuContent>
    </Menu>
  );
}

/** Níveis de esforço na escala do mais rápido ao mais esperto. O Automático fica fora dela: o Muse escolhe por mensagem. */
export const LEVELS: { value: ReasoningEffort; label: string; description: string }[] = [
  { value: "none", label: "Desligado", description: "Responde na hora, sem raciocinar" },
  { value: "minimal", label: "Mínimo", description: "Uma pensada rápida antes de responder" },
  { value: "low", label: "Baixo", description: "Raciocínio leve para mudanças simples" },
  { value: "medium", label: "Médio", description: "Equilíbrio entre velocidade e profundidade" },
  { value: "high", label: "Alto", description: "Mastiga problemas mais difíceis" },
  { value: "xhigh", label: "Extra alto", description: "Raciocínio profundo para trabalho traiçoeiro" },
  // Sem Ultra: o Muse Code 1.3.0 envia "ultra" ao modelo como "max", e o CLI deixou de oferecê-lo.
  { value: "max", label: "Max", description: "O mais lento e minucioso" },
];
const TOP = LEVELS.length - 1;
// Onde o controle descansa com o Automático ligado e nada escolhido ainda: Médio.
const RESTING = 3;

/** Esforço de raciocínio como controle deslizante com etapas, inspirado no controle do Claude desktop. */
function EffortPicker(props: { side: PickerSide }) {
  const controller = useController();
  const open = useApp((s) => s.picker === "effort");
  const effort = useApp((s) => s.prefs.effort);
  const [resting, setResting] = useState(RESTING);
  const thumb = useRef<HTMLSpanElement>(null);
  const switchId = useId();
  const picked = LEVELS.findIndex((l) => l.value === effort);
  const auto = picked < 0;
  const position = auto ? resting : picked;
  const label = auto ? "Automático" : (LEVELS[picked]?.label ?? "Automático");
  const ultra = !auto && picked === TOP;
  const choose = (index: number) => {
    const level = LEVELS[index];
    if (level) {
      setResting(index);
      controller.setEffort(level.value);
    }
  };
  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? controller.setPicker("effort") : controller.closePicker("effort"))}>
      <Popover.Trigger asChild>
        <ToolbarTrigger aria-label={`Esforço de raciocínio: ${label}`} icon={<Brain size={13} />} label={label} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={props.side}
          align="start"
          sideOffset={6}
          {...FLOATING}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            thumb.current?.focus();
          }}
          className="pop z-[var(--z-dropdown)] w-[300px] max-w-[calc(100dvw-24px)] rounded-xl bg-raised p-3.5 text-fg shadow-pop outline-none"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Esforço</span>
            <span className={cn("text-sm font-semibold", !auto && picked === TOP ? "text-accent-text" : "text-fg")}>{label}</span>
            <span className="flex-1" />
            <Tip label="Esforço maior pensa mais para respostas mais completas, mas cada mensagem demora mais.">
              <button
                type="button"
                aria-label="O que o esforço faz"
                className="-m-1 rounded-full p-1 text-subtle transition-colors duration-100 hover:text-fg"
              >
                <CircleHelp size={15} />
              </button>
            </Tip>
          </div>
          <div className="mt-4 flex justify-between text-xs text-subtle">
            <span>Mais rápido</span>
            <span>Mais esperto</span>
          </div>
          <Slider.Root
            min={0}
            max={TOP}
            step={1}
            value={[position]}
            onValueChange={([index]) => {
              if (index !== undefined) {
                choose(index);
              }
            }}
            aria-label="Esforço de raciocínio"
            className={cn("effort-slider relative mt-2 flex h-8 touch-none items-center select-none", auto && "opacity-60")}
          >
            <Slider.Track className="relative h-full grow overflow-hidden rounded-lg bg-active">
              <Slider.Range className={cn("effort-range absolute h-full overflow-hidden", ultra ? "bg-accent-soft" : "bg-fg/15")}>
                {ultra ? <PixelFlow className="text-accent-text" /> : null}
              </Slider.Range>
              {/* Um ponto por nível, recuado de meia alavanca para cada um ficar onde ela para. */}
              {ultra ? null : (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[9px] left-[9px]">
                  {LEVELS.map((level, index) => (
                    <span
                      key={level.value}
                      className="absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/30"
                      style={{ left: `${(index / TOP) * 100}%` }}
                    />
                  ))}
                </span>
              )}
            </Slider.Track>
            <Slider.Thumb
              ref={thumb}
              aria-valuetext={LEVELS[position]?.label}
              className="block h-6 w-[18px] rounded-md bg-white shadow-[0_0_0_1px_oklch(0_0_0/0.08),0_1px_3px_oklch(0_0_0/0.3)] outline-none transition-transform duration-100 ease-out focus-visible:ring-2 focus-visible:ring-accent active:scale-95"
            />
          </Slider.Root>
          <p className={cn("mt-2 text-xs", auto ? "text-subtle" : "text-muted")}>
            {auto ? "O Muse escolhe o esforço de cada mensagem" : LEVELS[position]?.description}
          </p>
          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <label htmlFor={switchId} className="min-w-0 flex-1 cursor-default text-sm text-fg">
              Deixar o Muse decidir
            </label>
            <Switch.Root
              id={switchId}
              checked={auto}
              onCheckedChange={(on) => controller.setEffort(on ? null : (LEVELS[position]?.value ?? "medium"))}
              className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-line-strong outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:bg-accent"
            >
              <Switch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-150 ease-out data-[state=checked]:translate-x-4" />
            </Switch.Root>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const MODES: { value: ApprovalMode; label: string; description: string; icon: ReactNode }[] = [
  { value: "onRequest", label: "Perguntar antes", description: "O Muse pergunta antes de qualquer coisa que precise de aprovação.", icon: <Shield size={14} /> },
  {
    value: "promptUnmatched",
    label: "Perguntar o fora da lista",
    description: "Comandos que suas regras permitem executam direto; o resto pergunta.",
    icon: <ShieldQuestion size={14} />,
  },
  {
    value: "denyUnmatched",
    label: "Negar o fora da lista",
    description: "Comandos que suas regras permitem executam direto; o resto é recusado.",
    icon: <Lock size={14} />,
  },
  {
    value: "allowAll",
    label: "Acesso total",
    description: "Toda ferramenta executa sem perguntar. Só para ambientes descartáveis.",
    icon: <ShieldAlert size={14} />,
  },
];

function AccessPicker(props: { sessionId: string | null; side: PickerSide }) {
  const controller = useController();
  const open = useApp((s) => s.picker === "permissions");
  // `/permissions full` abre a confirmação direto, então mora no estado do app, não aqui.
  const confirming = useApp((s) => s.picker === "confirmFullAccess");
  const bypass = useApp((s) => s.bypassAll);
  const confirmingBypass = useApp((s) => s.picker === "confirmBypass");
  const bypassId = useId();
  const preferred = useApp((s) => s.prefs.defaultMode);
  const threadMode = useApp((s) => (props.sessionId ? (s.threads[props.sessionId]?.fold.meta.approvalMode ?? null) : null));
  const current = (props.sessionId ? threadMode : null) ?? preferred;
  const mode = MODES.find((m) => m.value === current) ?? MODES[0];
  const setConfirming = (next: boolean) => (next ? controller.setPicker("confirmFullAccess") : controller.closePicker("confirmFullAccess"));
  return (
    <>
      <Menu open={open} onOpenChange={(next) => (next ? controller.setPicker("permissions") : controller.closePicker("permissions"))}>
        <MenuTrigger asChild>
          <ToolbarTrigger
            aria-label={`Permissões: ${mode?.label}`}
            icon={mode?.icon}
            label={mode?.label}
            tone={current === "allowAll" || bypass ? "warn" : undefined}
          />
        </MenuTrigger>
        <MenuContent side={props.side} className="w-[300px]">
          <MenuLabel>Permissões</MenuLabel>
          <MenuRadioGroup
            value={current}
            onValueChange={(value) => {
              if (value === "allowAll") {
                setConfirming(true);
              } else {
                void controller.setMode(value as ApprovalMode);
              }
            }}
          >
            {MODES.map((m) => (
              <MenuOption key={m.value} value={m.value} icon={m.icon} label={m.label} description={m.description} />
            ))}
          </MenuRadioGroup>
          {/* O Muse pergunta sempre que não consegue resolver os argumentos de um comando, seja qual for o modo. Isto responde essas. */}
          <div className="mt-1 flex items-start gap-3 border-t border-line px-2 pt-2.5 pb-1">
            <label htmlFor={bypassId} className="min-w-0 flex-1 cursor-default">
              <span className="block text-sm text-fg">Responder aprovações por mim</span>
              <span className="block text-xs text-muted">Permitidos uma vez cada, em todas as conversas, até você fechar o Helicon.</span>
            </label>
            <Switch.Root
              id={bypassId}
              checked={bypass}
              onCheckedChange={(on) => (on ? controller.setPicker("confirmBypass") : controller.setBypassAll(false))}
              className="relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-line-strong outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:bg-accent"
            >
              <Switch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-150 ease-out data-[state=checked]:translate-x-4" />
            </Switch.Root>
          </div>
        </MenuContent>
      </Menu>
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title="Dar acesso total ao Muse?"
        description="Toda chamada de ferramenta, incluindo comandos e escrita de arquivos, vai executar sem perguntar antes. A sandbox do sistema continua confinando os shells, a menos que esta conversa tenha começado com a sandbox desligada nas Configurações. Use isto só num ambiente descartável."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              controller.navigate({ kind: "settings" });
            }}
          >
            Configurações da sandbox
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Continuar perguntando
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(false);
              void controller.setMode("allowAll");
            }}
          >
            Permitir acesso total
          </Button>
        </div>
      </Modal>
      <Modal
        open={confirmingBypass}
        onOpenChange={(next) => (next ? controller.setPicker("confirmBypass") : controller.closePicker("confirmBypass"))}
        title="Responder aprovações por você?"
        description="Toda aprovação que o Muse pedir, em qualquer conversa, é permitida uma vez sem mostrar o comando antes. O Muse pergunta sobre os comandos que não conseguiu resolver, então são estes que nada mais conferiu. Isto dura até você fechar o Helicon."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => controller.closePicker("confirmBypass")}>
            Continuar perguntando
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              controller.closePicker("confirmBypass");
              controller.setBypassAll(true);
            }}
          >
            Responda por mim
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Velocidade de saída ao lado do anel de contexto: uma estimativa enquanto o texto flui, senão a velocidade medida da última mensagem. */
function SpeedReadout(props: { sessionId: string }) {
  const controller = useController();
  const running = useApp((s) => Boolean(s.threads[props.sessionId]?.fold.activeTurnId));
  const last = useApp((s) => {
    const fold = s.threads[props.sessionId]?.fold;
    const speed = fold ? lastTurnSpeed(fold) : null;
    return speed ? { tps: speed.tokensPerSecond, tokens: speed.outputTokens, ms: speed.generationMs } : null;
  }, shallowEqual);
  const live = useSampled(() => {
    const fold = controller.store.get().threads[props.sessionId]?.fold;
    return fold?.activeTurnId ? streamingSpeed(fold.turns[fold.activeTurnId], Date.now()) : null;
  }, running);
  if (running && live !== null) {
    return (
      <Tip label="Estimado a partir do texto fluindo agora">
        <span tabIndex={0} className="shrink-0 px-1 text-2xs text-subtle tabular-nums">
          ~{formatSpeed(live)}
        </span>
      </Tip>
    );
  }
  if (!last) {
    return null;
  }
  return (
    <Tip label={`Última mensagem: ${formatTokens(last.tokens)} tokens de saída em ${formatDuration(last.ms)} de chamadas ao modelo`}>
      <span tabIndex={0} className="shrink-0 px-1 text-2xs text-subtle tabular-nums">
        {formatSpeed(last.tps)}
      </span>
    </Tip>
  );
}

export function ComposerFooter(props: { cwd: string | null; branch: string | null; running: boolean }) {
  return (
    <div className="flex h-8 items-center gap-3 px-2 text-xs text-subtle">
      {props.cwd ? (
        <Tip label={props.cwd} side="top" align="start">
          <span className="flex min-w-0 items-center gap-1.5" tabIndex={0}>
            <Folder size={12} className="shrink-0" />
            <span className="truncate">{basename(props.cwd)}</span>
          </span>
        </Tip>
      ) : null}
      {props.branch ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate font-mono text-2xs">{props.branch}</span>
        </span>
      ) : null}
      <span className="flex-1" />
      <span className="hidden truncate md:inline">
        {props.running
          ? `Enter enfileira, ${MOD}+Enter junta a esta mensagem, Esc para`
          : "Enter envia, Shift+Enter pula linha, / para comandos, ! para terminal"}
      </span>
    </div>
  );
}
