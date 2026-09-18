/**
 * Contando ao usuário que algo aconteceu enquanto ele olhava para outro lugar. O shell fornece o
 * notificador: um navegador tem a API de Notificações, um shell desktop tem o que seu SO oferece. Nada
 * aqui toca em nenhum dos dois, então a decisão do que vale anunciar continua testável sozinha.
 */

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
    case "goal":
      return event.status === "complete"
        ? { title: "Meta concluída", body: `${event.thread} alcançou sua meta.` }
        : { title: "Uma meta precisa de atenção", body: `${event.thread} está ${event.status}.` };
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
  ) {}

  async announce(event: NotifyEvent): Promise<void> {
    const { enabled, focused } = this.settings();
    if (!enabled || focused) {
      return;
    }
    // Nunca pergunta aqui: um navegador só concede permissão a partir de um gesto do usuário, então a página de configurações pergunta.
    if ((await this.notifier.permission()) !== "granted") {
      return;
    }
    const tag = `${event.kind}:${event.sessionId}`;
    const at = this.now();
    if (at - (this.shown.get(tag) ?? Number.NEGATIVE_INFINITY) < REPEAT_MS) {
      return;
    }
    this.shown.set(tag, at);
    const { title, body } = copy(event);
    try {
      await this.notifier.show({ title, body, tag });
    } catch {
      // Não vale quebrar uma mensagem por causa de um notificador que recusa.
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
