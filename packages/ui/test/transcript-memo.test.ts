import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sameTurnBlockProps } from "../src/components/thread/Transcript.js";
import { forkPoints, sameForkPoint } from "../src/model/fork.js";
import type { TurnView } from "../src/model/fold.js";

function turn(id: string, text: string): TurnView {
  return {
    key: `turn:${id}`,
    turnId: id,
    prompt: { itemId: `item:${id}`, kind: "userMessage", status: "completed", revision: 1, turnId: id, text },
    entries: [],
    final: null,
    info: { turnId: id, terminal: "completed" },
    running: false,
  };
}

describe("memo dos turnos durante o streaming", () => {
  const turns = [turn("one", "Primeiro"), turn("two", "Segundo")];
  const gates = {};
  const answers = {};
  const attachments = {};

  function props(fork = forkPoints(turns, false)[1] ?? null) {
    return {
      turn: turns[1] as TurnView,
      gates,
      answers,
      attachments,
      ambiguousFiles: false,
      sessionId: "s1",
      isLast: false,
      readOnly: false,
      fork,
      speed: null,
      cost: null,
    };
  }

  it("pontos de bifurcação recriados com os mesmos valores são iguais", () => {
    const first = forkPoints(turns, false);
    const again = forkPoints(turns, false);
    assert.notEqual(first[1], again[1], "a descarga recria os objetos");
    assert.ok(sameForkPoint(first[1] ?? null, again[1] ?? null));
    assert.ok(sameForkPoint(null, null));
    assert.ok(!sameForkPoint(first[1] ?? null, null));
    assert.ok(!sameForkPoint(first[1] ?? null, { ...(first[1] as NonNullable<(typeof first)[1]>), editText: "outro" }));
  });

  it("um turno concluído não renderiza de novo só porque a lista de turnos mudou", () => {
    assert.ok(sameTurnBlockProps(props(), props(forkPoints(turns, false)[1] ?? null)));
  });

  it("renderiza de novo quando a conversa ou os anexos ambíguos mudam", () => {
    assert.ok(!sameTurnBlockProps(props(), { ...props(), sessionId: "s2" }));
    assert.ok(!sameTurnBlockProps(props(), { ...props(), ambiguousFiles: true }));
  });
});
