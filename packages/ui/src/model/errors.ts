import { HeliconError, errorKind, errorMessage } from "../client.js";

/**
 * Falhas que deixam uma conversa travada em vez de falhar uma única vez. Cada mensagem envia a conversa
 * inteira, então um pedaço do histórico que o provedor não aceita faz todas as mensagens seguintes falharem
 * do mesmo jeito, por mais que se tente de novo. "Compactar" resume o histórico e descarta o pedaço que não
 * pode ser enviado.
 */
export type StuckKind = "image" | "reasoning";
/**
 * "Compactar" descarta o que não pode ser enviado em algumas falhas; em outras, só uma conversa nova resolve.
 * `none` é o caso em que não há nada de errado com a conversa: o arquivo que acabou de ser enviado é que o
 * modelo não conseguiu ler.
 */
export type StuckRemedy = "compact" | "fresh" | "none";

export interface StuckThread {
  kind: StuckKind;
  remedy: StuckRemedy;
  /** Dito no lugar do texto do próprio provedor, que não explica o que fazer. */
  message: string;
}

const PATTERNS: { kind: StuckKind; remedy: StuckRemedy; test: RegExp; message: string }[] = [
  {
    kind: "image",
    remedy: "compact",
    test: /invalid image data at input\[|payload could not be decoded/i,
    message:
      "Uma imagem mais antiga desta conversa está ilegível para o modelo. Como cada mensagem envia a conversa inteira, a próxima falharia do mesmo jeito. Usar 'Compactar' resume o que aconteceu e deixa a imagem para trás.",
  },
  {
    // "Compactar" mantém as mensagens recentes como estão, raciocínio incluído, então não resolve este caso.
    kind: "reasoning",
    remedy: "fresh",
    test: /provider-private history is incompatible|reasoning replay .* has no provider attribution/i,
    message:
      "O raciocínio guardado desta conversa pertence ao provedor onde ela rodava antes e não pode ser reaproveitado após a troca. 'Compactar' não resolve, porque as mensagens recentes são mantidas como estão. Uma nova conversa começa sem esse histórico.",
  },
];

/**
 * O que há de errado com o histórico desta conversa, quando uma falha indica que uma próxima mensagem também
 * não teria sucesso.
 *
 * `ownImages` diz que a mensagem que falhou levava imagens próprias. O provedor descreve uma imagem rejeitada
 * exatamente como descreve uma imagem ilegível mais antiga, e a diferença importa: compactar a conversa por
 * causa da imagem recém-enviada a descartaria e tentaria o pedido sozinho, discretamente perguntando outra
 * coisa. Só imagens contam: qualquer outro arquivo é escrito na pasta do projeto e não pode causar falha de
 * decodificação de imagem.
 */
export function stuckThread(
  message: string | null | undefined,
  options: { ownImages?: boolean } = {},
): StuckThread | null {
  const text = message ?? "";
  const found = text ? PATTERNS.find((pattern) => pattern.test.test(text)) : undefined;
  if (!found) {
    return null;
  }
  if (found.kind === "image" && options.ownImages) {
    // Cada pedido carrega a conversa inteira, então uma imagem atual não prova em qual delas o modelo
    // engasgou. Diga as duas possibilidades e mantenha o reparo da própria conversa disponível, em vez de
    // fingir que sabe.
    return {
      kind: "image",
      remedy: "none",
      message:
        "O modelo não conseguiu ler uma das imagens desta conversa. Provavelmente a que foi enviada nesta mensagem: tente de novo como PNG ou JPEG. Se ela abre normalmente em outro lugar, a culpada é uma imagem mais antiga — e 'Compactar' deixa essa para trás.",
    };
  }
  return { kind: found.kind, remedy: found.remedy, message: found.message };
}

export interface TurnErrorCopy {
  title: string;
  explanation: string;
  /** Texto original, sem credenciais, quando a explicação não o substitui por completo. */
  technical: string | null;
  offerRetry: boolean;
}

/** Kind estável que o Muse envia em `turn/completed` quando o plano estoura. */
const QUOTA_KIND = "rateLimit";

function isQuotaError(kind: string | null | undefined, message: string): boolean {
  if (kind === QUOTA_KIND) {
    return true;
  }
  // Servidores/hosts antigos: só a frase, e só se não houver outro código estável.
  if (kind && kind !== "error") {
    return false;
  }
  return /429|quota exhausted|rate[\s_-]?limit/i.test(message);
}

export interface AuthErrorCopy {
  title: string;
  explanation: string;
}

/**
 * Falhas de acesso ao daemon. Prefere `kind` estável; frases inglesas só se o kind vier vazio.
 * Nunca devolve o token. Tentar de novo com o mesmo segredo errado não resolve.
 */
export function authErrorCopy(kind: string | null | undefined, status: number, message: string): AuthErrorCopy | null {
  const text = message.trim();
  const desktop = kind === "desktopAuthExpired" || (kind == null && /expired desktop launch/i.test(text));
  if (desktop) {
    return {
      title: "Abertura do aplicativo expirada",
      explanation:
        "Esta abertura do Helicon expirou. Feche e abra de novo pelo atalho. Tentar de novo nesta tela não gera uma abertura nova.",
    };
  }
  const unauthorized =
    kind === "unauthorized" || (kind == null && status === 401 && /token|unauthorized|not match this daemon/i.test(text));
  if (unauthorized) {
    return {
      title: "Acesso recusado",
      explanation:
        "O servidor não aceitou o acesso. Confira o token. Tentar de novo com o mesmo valor errado não resolve. O Helicon não mostra o segredo aqui.",
    };
  }
  const host = kind === "hostForbidden" || (kind == null && /does not answer that host/i.test(text));
  if (host) {
    return {
      title: "Host não permitido",
      explanation: "Este servidor recusou o nome de host da requisição. Isso não se resolve repetindo a mesma chamada.",
    };
  }
  const origin = kind === "originForbidden" || (kind == null && /does not answer that origin/i.test(text));
  if (origin) {
    return {
      title: "Origem não permitida",
      explanation:
        "Este servidor recusou a origem desta página. Inicie-o com --allow-origin para ela. Repetir a mesma origem recusada não resolve.",
    };
  }
  return null;
}

export interface SessionErrorCopy {
  title: string;
  explanation: string;
}

/**
 * Sessão não carregada, fluxo desalinhado ou conversa sumida. Recarregar pode realinhar o fluxo;
 * não troca o modelo nem o perfil. Frases inglesas só se o kind vier vazio.
 */
export function sessionErrorCopy(kind: string | null | undefined, message: string): SessionErrorCopy | null {
  const text = message.trim();
  if (kind === "sessionNotFound" || (kind == null && /session not found|unknown session/i.test(text))) {
    return {
      title: "Esta conversa não foi encontrada",
      explanation: "O servidor não conhece mais esta conversa. Recarregar não a recria e não troca o perfil do modelo.",
    };
  }
  if (kind === "sessionStreamMismatch" || (kind == null && /stream mismatch/i.test(text))) {
    return {
      title: "O fluxo desta conversa não bate",
      explanation:
        "Esta janela perdeu o fluxo da conversa — outro cliente ou um recarregamento. Recarregar a conversa pode realinhar. Repetir a mesma mensagem não troca o perfil do modelo.",
    };
  }
  if (kind === "sessionNotLoaded" || (kind == null && /not loaded/i.test(text))) {
    return {
      title: "Esta conversa não estava carregada",
      explanation:
        "O servidor não tinha esta conversa pronta. Recarregar tenta carregá-la de novo. Isso não troca o modelo nem o perfil.",
    };
  }
  return null;
}

export function userFacingError(error: unknown): string {
  const kind = errorKind(error);
  const status = error instanceof HeliconError ? error.status : 0;
  const message = errorMessage(error);
  return (
    authErrorCopy(kind, status, message)?.explanation ??
    sessionErrorCopy(kind, message)?.explanation ??
    sanitizeErrorDetail(message)
  );
}

/** Tira tokens e ids de pedido do detalhe técnico; o usuário não precisa deles na tela. */
export function sanitizeErrorDetail(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer …")
    .replace(/\brequest_id[=:][^\s\]]+/gi, "request_id=…")
    .replace(/\bapi[_-]?key[=:][^\s]+/gi, "api_key=…")
    .trim();
}

/**
 * Como explicar uma mensagem falha. Cota nunca oferece “tentar de novo” como se isso restaurasse o plano.
 * Falhas de histórico (`stuckThread`) são tratadas à parte no cartão.
 */
export function turnErrorCopy(kind: string | null | undefined, message: string, retryable: boolean): TurnErrorCopy {
  const text = sanitizeErrorDetail(message.trim() || "A mensagem falhou.");
  if (isQuotaError(kind, message)) {
    return {
      title: "A cota do plano acabou",
      explanation:
        "O Muse recusou esta mensagem porque o limite do plano foi atingido. Tentar de novo agora não restaura a cota. Confira Uso para ver a janela atual, ou espere a renovação.",
      technical: text,
      offerRetry: false,
    };
  }
  return {
    title: "Esta mensagem falhou",
    explanation: text,
    technical: null,
    offerRetry: retryable,
  };
}
