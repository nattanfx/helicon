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

/** Only offer host-valid completed boundaries; never guess a predecessor across missing history. */
export function forkPoints(
  turns: readonly TurnView[],
  truncated: boolean,
  hasAttachments: (turnId: string) => boolean = () => false,
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
        ? "O turno anterior não está no histórico carregado."
        : "A primeira mensagem não tem turno anterior para usar como corte.";
    } else if (before.info?.terminal !== "completed") {
      editUnavailable = "O turno anterior não é uma fronteira concluída.";
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
