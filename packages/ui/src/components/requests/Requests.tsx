import { Check, ChevronDown, ChevronUp, Circle, CircleCheck, CircleX, Clock, ListTodo, Lock, MessageCircleQuestion, Pencil, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp, useController } from "../../app/context.js";
import type { LocalEcho } from "../../model/fold.js";
import { approvalChoiceLabel } from "../../model/approvals.js";
import { describeApproval } from "../../model/format.js";
import type { ApprovalChoice, ApprovalRequest, TodoItem, UserInputAnswer, UserInputQuestion, UserInputRequest } from "../../types.js";
import { Tip } from "../ui/overlays.js";
import { Button, IconButton, Shortcut, Spinner, cn } from "../ui/primitives.js";
import { RollingDigits } from "../ui/sourced.js";

/** Em campos de texto, a tecla pertence à edição, não ao atalho de navegação. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const PANEL = "enter-up overflow-hidden rounded-2xl bg-raised shadow-[0_0_0_1px_var(--warn-line),0_2px_8px_-4px_oklch(0_0_0/0.18)]";

/** Recusas levam um X, um sim simples um tique, e um sim que grava regra o selo mais pesado. */
function choiceIcon(choice: ApprovalChoice) {
  if (choice.decision !== "approved") {
    return <X size={13} />;
  }
  return choice.rulePreview ? <CircleCheck size={13} /> : <Check size={13} />;
}

/** A recusa entre as opções oferecidas, seja qual for o nome que o host lhe dá. */
function refusalOf(choices: readonly ApprovalChoice[]): ApprovalChoice | undefined {
  return choices.find((choice) => choice.decision !== "approved");
}

export function ApprovalPanel(props: { request: ApprovalRequest; primary: boolean }) {
  const controller = useController();
  const { request } = props;
  const busy = useApp((s) => Boolean(s.busy[`approval:${request.approvalId}`]));
  const armed = useApp((s) => s.bypassAll || s.bypassThreads.includes(request.sessionId));
  const description = describeApproval(request);
  const choices = request.availableChoices ?? [];
  const primaryChoice = choices.find((c) => c.decision === "approved") ?? choices[0];
  const [chosen, setChosen] = useState<string | null>(null);
  const [feedbackChoice, setFeedbackChoice] = useState<ApprovalChoice | null>(null);
  const [feedback, setFeedback] = useState("");

  const pick = (choice: ApprovalChoice) => {
    if (choice.acceptsFeedback) {
      setFeedbackChoice(choice);
      return;
    }
    setChosen(choice.choiceId);
    void controller.decide(request, choice.choiceId, null);
  };

  useEffect(() => {
    if (!props.primary || feedbackChoice) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      // A e R são os atalhos que valem a pena; os dígitos escolhem qualquer opção, incluindo as de regra.
      const key = event.key.toLowerCase();
      if (key === "a" || key === "r") {
        const wanted = key === "a" ? primaryChoice : refusalOf(choices);
        if (wanted) {
          event.preventDefault();
          pick(wanted);
        }
        return;
      }
      const index = Number(event.key) - 1;
      const choice = Number.isInteger(index) ? choices[index] : undefined;
      if (choice) {
        event.preventDefault();
        pick(choice);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stageCount = request.subject?.stages?.length ?? 0;
  return (
    <section aria-label="Aprovação necessária" className={PANEL}>
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn-text">
          <ShieldAlert size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">O Muse quer {lowerFirst(description.title)}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {request.protectedWrite ? "Isso toca um caminho protegido. " : ""}
            {request.judgeEscalated ? "Uma verificação de segurança marcou para você revisar. " : ""}
            {stageCount > 1 ? `Parte de um comando de ${stageCount} etapas. ` : ""}
            Nada executa até você decidir.
          </p>
        </div>
      </div>
      {description.detail ? (
        <pre className="mx-4 mt-3 max-h-44 overflow-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg shadow-[0_0_0_1px_var(--border)] [overflow-wrap:anywhere]">
          {description.detail}
        </pre>
      ) : null}
      {feedbackChoice ? (
        <form
          className="flex flex-col gap-2 px-4 pt-3 pb-3.5"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setChosen(feedbackChoice.choiceId);
            void controller.decide(request, feedbackChoice.choiceId, feedback.trim() || null);
          }}
        >
          <label className="text-xs font-medium text-muted" htmlFor={`fb-${request.approvalId}`}>
            Diga ao Muse o que fazer em vez disso (opcional)
          </label>
          <textarea
            id={`fb-${request.approvalId}`}
            autoFocus
            rows={2}
            value={feedback}
            onChange={(event) => setFeedback(event.currentTarget.value)}
            className="w-full resize-none rounded-lg bg-sunken px-3 py-2 text-sm text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setFeedbackChoice(null)}>
              Voltar
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={busy}>
              {approvalChoiceLabel(feedbackChoice)}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3.5">
          {choices.map((choice) => {
            const button = (
              <Button
                key={choice.choiceId}
                size="sm"
                variant={choice === primaryChoice ? "primary" : "secondary"}
                loading={busy && chosen === choice.choiceId}
                disabled={busy}
                onClick={() => pick(choice)}
              >
                {choiceIcon(choice)}
                {approvalChoiceLabel(choice)}
              </Button>
            );
            return choice.rulePreview ? (
              <Tip key={choice.choiceId} label={`Adiciona a regra ${choice.rulePreview}`}>
                {button}
              </Tip>
            ) : (
              button
            );
          })}
          {choices.length === 0 ? <p className="text-xs text-muted">Nenhuma opção foi oferecida. Decida no terminal do Muse.</p> : null}
          {!armed && primaryChoice ? (
            <Tip label="Permitir isto e tudo o mais que esta conversa pedir, até você fechar o Helicon">
              <button
                type="button"
                onClick={() => controller.setThreadBypass(request.sessionId, true)}
                className="rounded-lg px-2 py-1 text-2xs text-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                Parar de perguntar nesta conversa
              </button>
            </Tip>
          ) : null}
          {props.primary && choices.length > 1 ? (
            <span className="ml-auto hidden items-center gap-1.5 text-2xs text-subtle sm:inline-flex">
              <Shortcut keys={["A"]} />
              permitir
              <Shortcut keys={["R"]} />
              rejeitar
              {choices.length > 2 ? <span className="text-subtle">· 1 a {Math.min(choices.length, 9)}</span> : null}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}

type Picks = Record<string, string[]>;
type Custom = Record<string, string>;

function isAnswered(question: UserInputQuestion, picks: Picks, custom: Custom): boolean {
  if (custom[question.id]?.trim()) {
    return true;
  }
  return (picks[question.id]?.length ?? 0) >= Math.max(1, question.selection.minSelections ?? 1);
}

function answerFor(question: UserInputQuestion, picks: Picks, custom: Custom): UserInputAnswer {
  const own = custom[question.id]?.trim();
  if (own || question.options.length === 0) {
    return { questionId: question.id, freeText: own ?? "" };
  }
  if (question.selection.mode === "multiple") {
    return { questionId: question.id, selectedLabels: picks[question.id] ?? [] };
  }
  return { questionId: question.id, selectedLabel: picks[question.id]?.[0] ?? "" };
}

/**
 * Perguntas do Muse, uma de cada vez. Respostas de escolha única avançam sozinhas; a última
 * envia. Uma linha "outra coisa" aceita resposta em texto livre.
 * via Beautiful UI ApprovalCard (beautifului.dev), MIT (c) 2026 Shane Levine.
 * Adapted: real MSP questions and answers, Helicon tokens, crossfade instead of a measured slide.
 */
export function QuestionPanel(props: { request: UserInputRequest; keyboard: boolean }) {
  const controller = useController();
  const { request } = props;
  const busy = useApp((s) => Boolean(s.busy[`input:${request.userInputId}`]));
  const questions = request.questions ?? [];
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Picks>({});
  const [custom, setCustom] = useState<Custom>({});
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const question = questions[index];
  const last = index >= questions.length - 1;

  const send = (nextPicks: Picks, nextCustom: Custom) => {
    const missing = questions.findIndex((q) => !isAnswered(q, nextPicks, nextCustom));
    if (missing >= 0) {
      setIndex(missing);
      return;
    }
    void controller.answer(
      request,
      questions.map((q) => answerFor(q, nextPicks, nextCustom)),
    );
  };

  const advance = (nextPicks: Picks, nextCustom: Custom) => {
    if (last) {
      send(nextPicks, nextCustom);
    } else {
      setIndex((i) => Math.min(questions.length - 1, i + 1));
    }
  };

  const choose = (label: string) => {
    if (!question || busy) {
      return;
    }
    const nextCustom = { ...custom, [question.id]: "" };
    setCustom(nextCustom);
    if (question.selection.mode === "multiple") {
      setPicks((previous) => {
        const current = previous[question.id] ?? [];
        if (current.includes(label)) {
          return { ...previous, [question.id]: current.filter((l) => l !== label) };
        }
        const max = question.selection.maxSelections;
        return max && current.length >= max ? previous : { ...previous, [question.id]: [...current, label] };
      });
      return;
    }
    const nextPicks = { ...picks, [question.id]: [label] };
    setPicks(nextPicks);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => advance(nextPicks, nextCustom), 420);
  };

  useEffect(() => {
    if (!props.keyboard || !question) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const option = question.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        choose(option.label);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!question) {
    return null;
  }
  const multiple = question.selection.mode === "multiple";
  const answered = isAnswered(question, picks, custom);
  return (
    <section aria-label="O Muse tem uma pergunta" className={PANEL}>
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn-text">
          <MessageCircleQuestion size={15} />
        </span>
        <div key={question.id} className="enter-up min-w-0 flex-1">
          <p className="text-2xs font-medium text-subtle">{question.header || "O Muse tem uma pergunta"}</p>
          <h3 id={`q-${request.userInputId}-${question.id}`} className="mt-0.5 text-md leading-snug font-medium text-pretty text-fg">
            {question.question}
          </h3>
        </div>
      </div>
      <div
        key={`options-${question.id}`}
        role={multiple ? "group" : "radiogroup"}
        aria-labelledby={`q-${request.userInputId}-${question.id}`}
        className="enter-up mt-2 flex flex-col gap-px px-2.5"
      >
        {question.options.map((option, optionIndex) => {
          const on = picks[question.id]?.includes(option.label) ?? false;
          return (
            <button
              key={option.label}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={on}
              disabled={busy}
              onClick={() => choose(option.label)}
              className={cn(
                "group/opt flex items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-100 hover:bg-hover disabled:opacity-60",
                on && "bg-hover",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                  multiple ? "rounded-[5px]" : "rounded-full",
                  on ? "bg-inverse text-inverse-fg" : "text-transparent shadow-[inset_0_0_0_1.5px_var(--border-strong)]",
                )}
              >
                {multiple ? (
                  <Check size={11} strokeWidth={3} />
                ) : (
                  <span className="size-1.5 rounded-full bg-current transition-transform duration-200" style={{ transform: on ? "scale(1)" : "scale(0)" }} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm transition-colors duration-150", on ? "font-medium text-fg" : "text-muted")}>{option.label}</span>
                {option.description ? <span className="mt-0.5 block text-xs leading-snug text-subtle">{option.description}</span> : null}
              </span>
              {props.keyboard && optionIndex < 9 ? (
                <span className="mt-0.5 font-mono text-2xs text-subtle opacity-0 transition-opacity group-hover/opt:opacity-100" aria-hidden="true">
                  {optionIndex + 1}
                </span>
              ) : null}
            </button>
          );
        })}
        <label className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors focus-within:bg-hover hover:bg-hover">
          <span className="flex size-4 shrink-0 items-center justify-center text-subtle" aria-hidden="true">
            <Pencil size={12} />
          </span>
          <input
            value={custom[question.id] ?? ""}
            maxLength={500}
            disabled={busy}
            aria-label={question.options.length > 0 ? "Responder outra coisa" : "Sua resposta"}
            placeholder={question.options.length > 0 ? "Outra coisa" : "Digite sua resposta"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCustom((previous) => ({ ...previous, [question.id]: value }));
              if (!multiple) {
                setPicks((previous) => ({ ...previous, [question.id]: [] }));
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && answered) {
                event.preventDefault();
                advance(picks, custom);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle focus-visible:outline-none"
          />
        </label>
        {multiple && question.selection.maxSelections ? (
          <p className="px-2 pt-1 text-xs text-subtle">Escolha até {question.selection.maxSelections}</p>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-line px-3 py-2.5">
        {questions.length > 1 ? (
          <div className="flex items-center gap-0.5 text-subtle">
            <IconButton size="xs" label="Pergunta anterior" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              <ChevronUp size={14} />
            </IconButton>
            <RollingDigits className="text-xs font-medium" value={`${index + 1} / ${questions.length}`} />
            <IconButton size="xs" label="Próxima pergunta" disabled={last} onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
              <ChevronDown size={14} />
            </IconButton>
          </div>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.skipQuestion(request)}>
          Pular
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!answered} onClick={() => advance(picks, custom)}>
          {last ? "Enviar resposta" : "Continuar"}
        </Button>
      </div>
    </section>
  );
}

function TodoMark(props: { status: string }) {
  switch (props.status) {
    case "completed":
      return <CircleCheck size={15} className="shrink-0 text-ok" aria-label="Feita" />;
    case "inProgress":
      return <Spinner size={13} className="m-px text-accent-text" label="Em andamento" />;
    case "cancelled":
      return <CircleX size={15} className="shrink-0 text-subtle" aria-label="Cancelada" />;
    default:
      return <Circle size={15} className="shrink-0 text-[var(--border-strong)]" aria-label="A fazer" />;
  }
}

/** Fecha um cartão até o usuário trazê-lo de volta pela barra superior da conversa. */
export function CloseCard(props: { label: string; onClose: () => void }) {
  return (
    <Tip label={`${props.label}. Traga de volta pela barra superior.`}>
      <IconButton size="sm" label={props.label} onClick={props.onClose} className="ml-1 shrink-0">
        <X size={13} />
      </IconButton>
    </Tip>
  );
}

export function PlanPanel(props: { sessionId: string; items: TodoItem[] }) {
  const controller = useController();
  // Guardado nas preferências, não aqui: este painel desmonta sempre que o usuário olha outra conversa.
  const cardKey = `plan:${props.sessionId}`;
  const open = useApp((s) => !s.prefs.collapsedCards.includes(cardKey));
  const hidden = useApp((s) => s.prefs.hiddenCards.includes(cardKey));
  const done = props.items.filter((i) => i.status === "completed").length;
  const active = props.items.find((i) => i.status === "inProgress");
  if (hidden) {
    return null;
  }
  return (
    <section aria-label="Plano" className="enter-up overflow-hidden rounded-2xl bg-raised shadow-card">
      <div className="flex items-center pr-1.5 transition-colors hover:bg-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => controller.setCardOpen(cardKey, !open)}
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 pl-3.5 text-left"
        >
          <ListTodo size={15} className="shrink-0 text-subtle" />
          <span className="text-sm font-medium text-fg">Plano</span>
          <span className="shrink-0 text-xs text-subtle tabular-nums">
            <RollingDigits value={String(done)} /> de {props.items.length} feitas
          </span>
          {!open && active ? <span className="min-w-0 truncate text-xs text-muted">{active.activeForm ?? active.text}</span> : null}
          <span className="flex-1" />
          <ChevronDown size={14} className={cn("shrink-0 text-subtle transition-transform duration-200", !open && "-rotate-90")} />
        </button>
        <CloseCard label="Ocultar o plano" onClose={() => controller.setCardHidden(cardKey, true)} />
      </div>
      {open ? (
        <ol className="flex max-h-52 flex-col gap-1.5 overflow-y-auto px-3.5 pb-3">
          {props.items.map((item, index) => (
            <li key={index} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex size-4 items-center justify-center">
                <TodoMark status={item.status} />
              </span>
              <span
                className={cn(
                  "min-w-0",
                  item.status === "completed" && "text-subtle line-through decoration-[var(--border-strong)]",
                  item.status === "inProgress" && "font-medium text-fg",
                  item.status !== "completed" && item.status !== "inProgress" && "text-muted",
                )}
              >
                {item.status === "inProgress" ? (item.activeForm ?? item.text) : item.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function QueuedList(props: { sessionId: string; items: LocalEcho[] }) {
  const controller = useController();
  return (
    <div className="flex flex-col gap-1.5">
      {props.items.map((echo) => (
        <div key={echo.localId} className="enter-up flex items-center gap-2.5 rounded-xl bg-sunken py-1.5 pr-1.5 pl-3 shadow-[0_0_0_1px_var(--border)]">
          <Clock size={14} className="shrink-0 text-subtle" />
          <span className="shrink-0 text-xs font-medium text-subtle">Na fila</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{echo.text}</span>
          <Tip label="Remover da fila">
            <IconButton size="xs" label="Remover da fila" onClick={() => void controller.unqueue(props.sessionId, echo)}>
              <X size={13} />
            </IconButton>
          </Tip>
        </div>
      ))}
    </div>
  );
}

/** O silêncio não permite concluir se o Muse parou ou terminou o trabalho. */
export function StalledNotice(props: { onRetry: () => void; busy: boolean }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
      <Clock size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Esta conversa está sem atualizações recentes</p>
        <p className="mt-0.5 text-xs text-muted">
          Duas recargas automáticas não confirmaram o fim da resposta. O Muse pode ainda estar
          trabalhando. Você pode recarregar o histórico; isso também permite até duas novas tentativas automáticas.
        </p>
      </div>
      <Button size="sm" onClick={props.onRetry} loading={props.busy}>
        Recarregar histórico
      </Button>
    </div>
  );
}

export function ReadOnlyNotice(props: { reason: string | null; onRetry: () => void; busy: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
      <Lock size={15} className="mt-0.5 shrink-0 text-subtle" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Aberta em outra sessão do Muse</p>
        <p className="mt-0.5 text-xs text-muted">
          Outro programa, geralmente o terminal do Muse, está com esta conversa. Feche lá e assuma aqui.
        </p>
      </div>
      <Button size="sm" onClick={props.onRetry} loading={props.busy}>
        Assumir
      </Button>
    </div>
  );
}
