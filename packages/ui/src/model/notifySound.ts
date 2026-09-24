/**
 * Um bipe suave junto com o aviso do sistema, sintetizado na hora via WebAudio: sem arquivo de
 * áudio, sem rede, sem dependência. Falha fechada: sem áudio disponível ou qualquer erro no meio,
 * devolve false e nunca lança, então o aviso nunca quebra por causa do som.
 */

/** Frequência do bipe em Hz (lá acima do dó central). */
const BEEP_FREQ_HZ = 880;
/** Duração do bipe em segundos. */
const BEEP_DURATION_S = 0.12;
/** Pico do volume: audível sem assustar (0,07 era baixo demais no Teste). */
const BEEP_GAIN = 0.25;
/** Subida do volume em segundos: evita o estalo de começar no pico. */
const BEEP_ATTACK_S = 0.012;
/** Folga após o fim do bipe antes de parar o oscilador, em segundos. */
const BEEP_STOP_PAD_S = 0.02;
/** Espera antes de fechar o contexto por segurança, em milissegundos. */
const BEEP_CLOSE_FALLBACK_MS = 220;

/** O mínimo de um parâmetro de áudio que o bipe usa. */
export interface BeepAudioParam {
  value: number;
  setValueAtTime(value: number, at: number): void;
  exponentialRampToValueAtTime(value: number, at: number): void;
}

/** O mínimo de um oscilador que o bipe usa. */
export interface BeepOscillator {
  type: string;
  frequency: BeepAudioParam;
  onended: (() => void) | null;
  connect(target: unknown): void;
  start(at: number): void;
  stop(at: number): void;
}

/** O mínimo de um controle de volume que o bipe usa. */
export interface BeepGain {
  gain: BeepAudioParam;
  connect(target: unknown): void;
}

/** O mínimo de um contexto de áudio que o bipe usa; testes passam uma imitação. */
export interface BeepAudio {
  readonly currentTime: number;
  readonly destination: unknown;
  /** Estado do contexto (`running`, `suspended`...); ausente nas imitações de teste. */
  readonly state?: unknown;
  /** Retoma um contexto suspenso; ausente nas imitações que não precisam dele. */
  resume?: () => unknown;
  createOscillator(): BeepOscillator;
  createGain(): BeepGain;
  close(): unknown;
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return typeof Ctor === "function" ? Ctor : null;
}

function defaultAudio(): BeepAudio | null {
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return null;
  }
  try {
    return new Ctor() as unknown as BeepAudio;
  } catch {
    return null;
  }
}

/**
 * Toca o bipe da notificação. Sem argumento usa o AudioContext do ambiente; testes passam uma
 * imitação (ou null para simular ausência de áudio). Devolve true quando o bipe foi agendado.
 * A sonda opcional recebe o estado do contexto usado, para o diagnóstico temporário; nunca quebra o bipe.
 */
export function playNotifySound(context?: BeepAudio | null, probe?: (info: { state: string }) => void): boolean {
  try {
    const ctx = context === undefined ? defaultAudio() : context;
    if (!ctx) {
      return false;
    }
    const suspended = ctx.state === "suspended";
    if (suspended && typeof ctx.resume === "function") {
      try {
        void ctx.resume();
      } catch {
        /* retomar é melhor esforço; o bipe segue agendado de todo jeito */
      }
    }
    if (probe) {
      try {
        const state = typeof ctx.state === "string" ? ctx.state : "desconhecido";
        probe({ state: suspended && typeof ctx.resume === "function" ? `${state} (retomando)` : state });
      } catch {
        /* sonda é diagnóstico; nunca vale um erro */
      }
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = BEEP_FREQ_HZ;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(BEEP_GAIN, now + BEEP_ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_DURATION_S);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + BEEP_DURATION_S + BEEP_STOP_PAD_S);
    const close = () => {
      try {
        void ctx.close();
      } catch {
        /* fechar é limpeza; nunca vale um erro */
      }
    };
    try {
      osc.onended = close;
    } catch {
      /* alguns contextos não deixam atribuir; a segurança abaixo cobre */
    }
    if (typeof setTimeout === "function") {
      setTimeout(close, BEEP_CLOSE_FALLBACK_MS);
    }
    return true;
  } catch {
    return false;
  }
}
