/**
 * Rótulos de aprovação que o Muse envia em inglês. Só frases conhecidas viram português;
 * o restante, inclusive comando/regra no próprio rótulo, permanece fiel.
 */

const KNOWN_LABELS: readonly { match: string; pt: string }[] = [
  { match: "Allow and remember", pt: "Permitir e lembrar" },
  { match: "Allow for this session", pt: "Permitir nesta sessão" },
  { match: "Always allow", pt: "Permitir sempre" },
  { match: "Allow always", pt: "Permitir sempre" },
  { match: "Allow once", pt: "Permitir desta vez" },
  { match: "Don't allow", pt: "Não permitir" },
  { match: "Reject", pt: "Rejeitar" },
  { match: "Deny", pt: "Recusar" },
];

const REST_PREFIX = /^(?:\s*[:—]\s+|\s+-\s+)/;

function startsWithIgnoreCase(text: string, prefix: string): boolean {
  return text.length >= prefix.length && text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/**
 * Traduz um rótulo conhecido. Se houver texto de comando/regra depois de `:` ou traço, esse
 * trecho fica como veio. Rótulo desconhecido, inclusive um “Allow …” que não está na lista,
 * não vira autorização inferida.
 */
export function translateApprovalLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return label;
  }
  for (const { match, pt } of KNOWN_LABELS) {
    if (trimmed.toLowerCase() === match.toLowerCase()) {
      return pt;
    }
    if (!startsWithIgnoreCase(trimmed, match)) {
      continue;
    }
    const rest = trimmed.slice(match.length);
    if (REST_PREFIX.test(rest) && rest.replace(REST_PREFIX, "").length > 0) {
      return `${pt}${rest}`;
    }
  }
  return label;
}

/** Rótulo visível de uma escolha. `choiceId`, `decision` e `scope` não entram na tradução. */
export function approvalChoiceLabel(choice: { label: string }): string {
  return translateApprovalLabel(choice.label);
}
