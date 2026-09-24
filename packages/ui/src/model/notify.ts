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
  /**
   * O shell pede a permissão uma vez na abertura quando o balão está ligado e ela ainda não foi
   * concedida. Só o desktop marca: um navegador exige gesto do usuário para conceder.
   */
  startupRequest?: boolean;
  /** Caminho usado pelo último `show` ("nativo", "plugin"); para o diagnóstico temporário. */
  readonly lastShowPath?: string;
  /** O que o usuário já decidiu, sem perguntar de novo. */
  permission(): Promise<NotifyPermission>;
  /** Pergunta uma vez. Navegadores só honram isso a partir de um gesto real do usuário, por isso não é automático. */
  request(): Promise<NotifyPermission>;
  show(note: { title: string; body: string; tag: string }): Promise<void>;
}

export interface NotifySettings {
  /** O interruptor do balão. Desligado significa que nada é mostrado, aconteça o que acontecer. */
  enabled: boolean;
  /** Verdadeiro enquanto a janela tem a atenção dele; cada canal decide se isso o cala. */
  focused: boolean;
  /** O bipe, independente do balão: toca mesmo com o interruptor desligado ou a permissão negada. Ausente conta como desligado. */
  sound?: boolean;
  /** Balão também com a janela em primeiro plano. Ausente conta como desligado. */
  balloonForeground?: boolean;
  /** Bipe também com a janela em primeiro plano. Ausente conta como desligado. */
  soundForeground?: boolean;
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
  balloonForeground: boolean;
  soundForeground: boolean;
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
 * Decide o que realmente chega ao usuário. Cada canal tem seu interruptor e sua política de foco,
 * nada é mostrado sem permissão já concedida, e o mesmo evento repetido é dito uma vez — sem calar
 * um turno novo que termine logo depois.
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
    const { enabled, focused, sound, balloonForeground, soundForeground } = this.settings();
    // Balão e bipe são canais independentes: cada um tem seu interruptor e sua política de foco.
    // A permissão do sistema só trava o balão.
    const show = enabled && (!focused || balloonForeground === true);
    const beep = sound === true && (!focused || soundForeground === true);
    const trace: NotifyTrace = {
      at: this.now(),
      kind: event.kind,
      sessionId: event.sessionId,
      turnId: event.kind === "finished" ? (event.turnId ?? null) : null,
      enabled,
      focused,
      sound: sound === true,
      balloonForeground: balloonForeground === true,
      soundForeground: soundForeground === true,
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
    // Reserva antes de qualquer espera: dois anúncios do mesmo evento não passam juntos.
    // A etiqueta visível segue por conversa, mas a repetição de fim de turno é por turno.
    const tag = `${event.kind}:${event.sessionId}`;
    const key = event.kind === "finished" && event.turnId ? `${tag}:${event.turnId}` : tag;
    if (trace.at - (this.shown.get(key) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS) {
      if (show) {
        trace.balloon = "repetição 20s";
      }
      if (beep) {
        trace.beep = "repetição 20s";
      }
      this.pushTrace(trace);
      return;
    }
    this.shown.set(key, trace.at);
    // O bipe sai primeiro e nunca espera o balão: a consulta de permissão e o mostrador
    // não atrasam nem calam o som.
    if (beep) {
      this.soundTrace(trace);
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
    if (granted) {
      const { title, body } = copy(event);
      try {
        await this.notifier.show({ title, body, tag });
        trace.balloon = this.notifier.lastShowPath ? `mostrado (${this.notifier.lastShowPath})` : "mostrado";
      } catch (error) {
        // Não vale quebrar uma mensagem por causa de um notificador que recusa.
        trace.balloon = `falha: ${reason(error)}`;
      }
    } else if (show) {
      trace.balloon = "sem permissão";
    }
    this.pushTrace(trace);
  }

  /**
   * Prova de cada canal a pedido do usuário, sem depender de foco, interruptores ou repetição:
   * os botões de teste das Configurações passam por aqui. O balão de prova respeita a permissão
   * do sistema; o bipe de prova toca sempre. Não marca a janela de repetição.
   */
  async preview(channel: "balloon" | "sound" | "both"): Promise<void> {
    const { enabled, focused, sound, balloonForeground, soundForeground } = this.settings();
    const trace: NotifyTrace = {
      at: this.now(),
      kind: "finished",
      sessionId: "teste",
      turnId: null,
      enabled,
      focused,
      sound: sound === true,
      balloonForeground: balloonForeground === true,
      soundForeground: soundForeground === true,
      backend: this.notifier.label ?? "desconhecido",
      permission: "não consultada",
      permissionMs: null,
      balloon: channel === "sound" ? "não testado" : "",
      beep: channel === "balloon" ? "não testado" : "",
    };
    if (channel !== "balloon") {
      this.soundTrace(trace);
    }
    if (channel !== "sound") {
      const asked = this.now();
      const answer = await this.notifier.permission();
      trace.permission = answer;
      trace.permissionMs = Math.max(0, this.now() - asked);
      if (answer !== "granted") {
        trace.balloon = "sem permissão";
      } else {
        try {
          await this.notifier.show({
            title: "Helicon: teste de aviso",
            body: "Se você está vendo isto, o balão funciona.",
            tag: "helicon-teste",
          });
          trace.balloon = this.notifier.lastShowPath ? `mostrado (teste, ${this.notifier.lastShowPath})` : "mostrado (teste)";
        } catch (error) {
          trace.balloon = `falha: ${reason(error)}`;
        }
      }
    }
    this.pushTrace(trace);
  }

  /** Toca o bipe e anota o resultado no rastro; nunca lança. */
  private soundTrace(trace: NotifyTrace): void {
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
