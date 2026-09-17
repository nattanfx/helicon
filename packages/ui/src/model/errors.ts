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
