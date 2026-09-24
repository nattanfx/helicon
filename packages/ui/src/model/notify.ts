/**
 * Contando ao usuário que algo aconteceu enquanto ele olhava para outro lugar. O shell fornece o
 * notificador: um navegador tem a API de Notificações, um shell desktop tem o que seu SO oferece. Nada
 * aqui toca em nenhum dos dois, então a decisão do que vale anunciar continua testável sozinha.
 */

import { statusLabel } from "./goal.js";

export type NotifyPermission = "granted" | "denied" | "default";

export interface Notifier {
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
  | { kind: "finished"; sessionId: string; thread: string; failed: boolean }
  | { kind: "goal"; sessionId: string; thread: string; status: string };

/** Uma conversa oscilando entre estados não deve apitar sem parar. */
const REPEAT_MS = 20_000;

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

  constructor(
    private readonly notifier: Notifier,
    private readonly settings: () => NotifySettings,
    private readonly now: () => number = () => Date.now(),
    private readonly playSound: () => void = () => {},
  ) {}

  async announce(event: NotifyEvent): Promise<void> {
    const { enabled, focused, sound } = this.settings();
    // Balão e bipe são canais independentes: cada um tem seu interruptor, mas os dois respeitam
    // a janela em foco e a janela de repetição. A permissão do sistema só trava o balão.
    const show = enabled && !focused;
    const beep = sound === true && !focused;
    if (!show && !beep) {
      return;
    }
    let granted = false;
    if (show) {
      // Nunca pergunta aqui: um navegador só concede permissão a partir de um gesto do usuário, então a página de configurações pergunta.
      granted = (await this.notifier.permission()) === "granted";
    }
    const tag = `${event.kind}:${event.sessionId}`;
    const at = this.now();
    if (at - (this.shown.get(tag) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS) {
      return;
    }
    this.shown.set(tag, at);
    if (granted) {
      const { title, body } = copy(event);
      try {
        await this.notifier.show({ title, body, tag });
      } catch {
        // Não vale quebrar uma mensagem por causa de um notificador que recusa.
      }
    }
    if (beep) {
      try {
        this.playSound();
      } catch {
        // Som nunca quebra um aviso: quem passou nas travas já mereceu ser notado.
      }
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
