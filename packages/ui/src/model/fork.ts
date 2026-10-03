import type { TurnView } from "./fold.js";
import { stripAttachmentMentions, stripImageMarkers } from "./format.js";

export interface ForkPoint {
  /** The inclusive boundary for continuing after this turn. */
  lastTurnId: string;
  /** The preceding completed turn, used when the selected prompt will be sent again. */
  beforeTurnId: string | null;
  editText: string | null;
  editUnavailable: string | null;
}

/** Two fork points offer the same actions; `forkPoints` rebuilds them on every turns change, so compare by value. */
export function sameForkPoint(a: ForkPoint | null, b: ForkPoint | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.lastTurnId === b.lastTurnId &&
    a.beforeTurnId === b.beforeTurnId &&
    a.editText === b.editText &&
    a.editUnavailable === b.editUnavailable
  );
}

/** Only offer host-valid completed boundaries; never guess a predecessor across missing history. */
export function forkPoints(
  turns: readonly TurnView[],
  truncated: boolean,
  hasAttachments: (turnId: string) => boolean = () => false,
  ambiguousAttachments: (turnId: string) => boolean = () => false,
): (ForkPoint | null)[] {
  let previous: TurnView | null = null;
  return turns.map((turn) => {
    const before = previous;
    if (turn.turnId) {
      previous = turn;
    }
    if (!turn.turnId || !turn.prompt || turn.info?.terminal !== "completed") {
      return null;
    }
    const storedFiles = hasAttachments(turn.turnId);
    const text = turn.prompt.text ?? "";
    // The display text is the user's original prompt when the server appended attachment references.
    const editable = stripAttachmentMentions(stripImageMarkers(turn.prompt.displayText ?? text));
    let editUnavailable: string | null = null;
    if (!before) {
      editUnavailable = truncated
        ? "A mensagem anterior não está no histórico carregado."
        : "Não há mensagem antes da primeira para usar como corte.";
    } else if (before.info?.terminal !== "completed") {
      editUnavailable = "A mensagem anterior não terminou; não serve como ponto de corte.";
    } else if (ambiguousAttachments(turn.turnId)) {
      editUnavailable = "Esta mensagem recebeu anexos em mais de um envio; não é possível identificar quais pertencem ao pedido editado.";
    } else if (turn.prompt.displayText !== undefined && turn.prompt.displayText !== text && !storedFiles) {
      editUnavailable = "Este pedido foi transformado antes do envio e não pode ser copiado com segurança.";
    } else if (!editable.trim() && !storedFiles) {
      editUnavailable = "Este pedido não tem texto nem anexos para editar.";
    }
    return {
      lastTurnId: turn.turnId,
      beforeTurnId: editUnavailable ? null : before?.turnId ?? null,
      editText: editUnavailable ? null : editable,
      editUnavailable,
    };
  });
}
