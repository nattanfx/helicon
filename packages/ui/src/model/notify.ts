/**
 * Contando ao usuário que algo aconteceu enquanto ele olhava para outro lugar. O shell fornece o
 * notificador: um navegador tem a API de Notificações, um shell desktop tem o que seu SO oferece. Nada
 * aqui toca em nenhum dos dois, então a decisão do que vale anunciar continua testável sozinha.
 */

import { statusLabel } from "./goal.js";

export type NotifyPermission = "granted" | "denied" | "default";

export interface Notifier {
  /** Nome do transporte para o diagnóstico temporário ("desktop", "navegador"); ausente conta como desconhecido. */
  label?: string;
  /** O que o usuário já decidiu, sem perguntar de novo. */
  permission(): Promise<NotifyPermission>;
  /** Pergunta uma vez. Navegadores só honram isso a partir de um gesto real do usuário, por isso não é automático. */
  request(): Promise<NotifyPermission>;
  show(note: { title: string; body: string; tag: string }): Promise<void>;
}

export interface NotifySettings {
  /** O interruptor do usuário. Desligado significa que nada é mostrado, aconteça o que acontecer. */
  enabled: boolean;
  /** Verdadeiro enquanto a janela tem a atenção dele: não há nada para contar a quem está olhando. */
  focused: boolean;
  /** O bipe, independente do balão: toca mesmo com o interruptor desligado ou a permissão negada. Ausente conta como desligado. */
  sound?: boolean;
}

/** Algo que aconteceu numa conversa e pode valer interromper alguém. */
export type NotifyEvent =
  | { kind: "approval"; sessionId: string; thread: string }
  | { kind: "question"; sessionId: string; thread: string }
  | { kind: "finished"; sessionId: string; thread: string; failed: boolean; turnId?: string | null }
  | { kind: "goal"; sessionId: string; thread: string; status: string };

/** Uma conversa oscilando entre estados não deve apitar sem parar. */
const REPEAT_MS = 20_000;

/** Resultado da tentativa de bipe, para o diagnóstico temporário. */
export interface SoundOutcome {
  scheduled: boolean;
  audioState: string;
}

/**
 * Diagnóstico temporário de uma tentativa de aviso (etapa 1 da confiabilidade das notificações).
 * Guarda até as tentativas suprimidas, ou a falha de abertura some sem deixar rastro. Será removido
 * com o bloco de diagnóstico das Configurações quando a causa estiver delimitada.
 */
export interface NotifyTrace {
  at: number;
  kind: NotifyEvent["kind"];
  sessionId: string;
  turnId: string | null;
  enabled: boolean;
  focused: boolean;
  sound: boolean;
  backend: string;
  permission: NotifyPermission | "não consultada";
  permissionMs: number | null;
  balloon: string;
  beep: string;
}

/** Quantas tentativas recentes ficam guardadas para o diagnóstico temporário. */
const TRACE_KEEP = 20;

/** Texto curto de um erro para o diagnóstico temporário, sem vazar objeto. */
function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "erro";
}

function copy(event: NotifyEvent): { title: string; body: string } {
  switch (event.kind) {
    case "approval":
      return { title: "Muse está esperando por você", body: `${event.thread} quer executar algo.` };
    case "question":
      return { title: "Muse fez uma pergunta", body: `${event.thread} está esperando uma resposta.` };
    case "finished":
      return event.failed
        ? { title: "Uma mensagem falhou", body: `${event.thread} parou com um erro.` }
        : { title: "Muse terminou", body: `${event.thread} terminou.` };
    case "goal": {
      if (event.status === "complete") {
        return { title: "Meta concluída", body: `${event.thread} alcançou sua meta.` };
      }
      const { label } = statusLabel(event.status);
      const estado = label.charAt(0).toLowerCase() + label.slice(1);
      return { title: "Uma meta precisa de atenção", body: `${event.thread} está ${estado}.` };
    }
  }
}

/**
 * Decide o que realmente chega ao usuário. Tudo é descartado enquanto a janela está focada ou o
 * interruptor está desligado, nada é mostrado sem permissão já concedida, e a mesma conversa dizendo
 * a mesma coisa duas vezes seguidas é dita uma vez.
 */
export class NotificationManager {
  private readonly shown = new Map<string, number>();
  private readonly traces: NotifyTrace[] = [];

  constructor(
    private readonly notifier: Notifier,
    private readonly settings: () => NotifySettings,
    private readonly now: () => number = () => Date.now(),
    private readonly playSound: () => SoundOutcome | void = () => {},
  ) {}

  /** Tentativas recentes, da mais antiga à mais nova, para o diagnóstico temporário. */
  recent(): NotifyTrace[] {
    return [...this.traces];
  }

  async announce(event: NotifyEvent): Promise<void> {
    const { enabled, focused, sound } = this.settings();
    // Balão e bipe são canais independentes: cada um tem seu interruptor, mas os dois respeitam
    // a janela em foco e a janela de repetição. A permissão do sistema só trava o balão.
    const show = enabled && !focused;
    const beep = sound === true && !focused;
    const trace: NotifyTrace = {
      at: this.now(),
      kind: event.kind,
      sessionId: event.sessionId,
      turnId: event.kind === "finished" ? (event.turnId ?? null) : null,
      enabled,
      focused,
      sound: sound === true,
      backend: this.notifier.label ?? "desconhecido",
      permission: "não consultada",
      permissionMs: null,
      balloon: show ? "" : enabled ? "foco" : "desligado",
      beep: beep ? "" : sound === true ? "foco" : "desligado",
    };
    if (!show && !beep) {
      this.pushTrace(trace);
      return;
    }
    let granted = false;
    if (show) {
      // Nunca pergunta aqui: um navegador só concede permissão a partir de um gesto do usuário, então a página de configurações pergunta.
      const asked = this.now();
      const answer = await this.notifier.permission();
      trace.permission = answer;
      trace.permissionMs = Math.max(0, this.now() - asked);
      granted = answer === "granted";
    }
    const tag = `${event.kind}:${event.sessionId}`;
    const at = this.now();
    if (at - (this.shown.get(tag) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS) {
      if (show) {
        trace.balloon = "repetição 20s";
      }
      if (beep) {
        trace.beep = "repetição 20s";
      }
      this.pushTrace(trace);
      return;
    }
    this.shown.set(tag, at);
    if (granted) {
      const { title, body } = copy(event);
      try {
        await this.notifier.show({ title, body, tag });
        trace.balloon = "mostrado";
      } catch (error) {
        // Não vale quebrar uma mensagem por causa de um notificador que recusa.
        trace.balloon = `falha: ${reason(error)}`;
      }
    } else if (show) {
      trace.balloon = "sem permissão";
    }
    if (beep) {
      try {
        const outcome = this.playSound();
        trace.beep =
          outcome !== undefined && typeof outcome === "object"
            ? outcome.scheduled
              ? `agendado (${outcome.audioState})`
              : `não agendado (${outcome.audioState})`
            : "chamado";
      } catch (error) {
        // Som nunca quebra um aviso: quem passou nas travas já mereceu ser notado.
        trace.beep = `falha: ${reason(error)}`;
      }
    }
    this.pushTrace(trace);
  }

  private pushTrace(trace: NotifyTrace): void {
    this.traces.push(trace);
    while (this.traces.length > TRACE_KEEP) {
      this.traces.shift();
    }
  }

  /** Deixa uma conversa se anunciar de novo, quando o usuário resolver o que ela disse. */
  forget(sessionId: string): void {
    for (const key of [...this.shown.keys()]) {
      if (key.endsWith(`:${sessionId}`)) {
        this.shown.delete(key);
      }
    }
  }
}
