import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { forkPoints } from "../src/model/fork.js";
import type { TurnView } from "../src/model/fold.js";

function turn(id: string, text: string, terminal = "completed", displayText?: string): TurnView {
  return {
    key: `turn:${id}`,
    turnId: id,
    prompt: { itemId: `item:${id}`, kind: "userMessage", status: "completed", revision: 1, turnId: id, text, displayText },
    entries: [],
    final: null,
    info: { turnId: id, terminal },
    running: false,
  };
}

describe("pontos de ramificação", () => {
  it("continua no corte inclusivo e edita a partir do turno anterior", () => {
    const points = forkPoints([turn("one", "Primeiro"), turn("two", "Segundo"), turn("three", "Terceiro")], false);
    assert.equal(points[0]?.lastTurnId, "one");
    assert.match(points[0]?.editUnavailable ?? "", /primeira mensagem/i);
    assert.deepEqual(points[1], { lastTurnId: "two", beforeTurnId: "one", editText: "Segundo", editUnavailable: null });
    assert.deepEqual(points[2], { lastTurnId: "three", beforeTurnId: "two", editText: "Terceiro", editUnavailable: null });
  });

  it("não inventa predecessor quando o histórico está truncado ou o turno anterior falhou", () => {
    const clipped = forkPoints([turn("two", "Segundo")], true);
    assert.match(clipped[0]?.editUnavailable ?? "", /histórico carregado/);
    const failed = forkPoints([turn("one", "Primeiro", "failed"), turn("two", "Segundo")], false);
    assert.equal(failed[0], null);
    assert.match(failed[1]?.editUnavailable ?? "", /fronteira concluída/);
    assert.equal(failed[1]?.lastTurnId, "two");
  });

  it("não copia texto transformado e aceita pedido somente com anexo quando o anexo existe", () => {
    const transformed = forkPoints([turn("one", "Primeiro"), turn("two", "texto enviado", "completed", "/skill x")], false);
    assert.match(transformed[1]?.editUnavailable ?? "", /transformado/);
    const attached = forkPoints([turn("one", "Primeiro"), turn("two", "")], false, (id) => id === "two");
    assert.deepEqual(attached[1], { lastTurnId: "two", beforeTurnId: "one", editText: "", editUnavailable: null });
    const appended = forkPoints([turn("one", "Primeiro"), turn("two", "Pedido\narquivo anexado", "completed", "Pedido")], false, (id) => id === "two");
    assert.equal(appended[1]?.editText, "Pedido");
  });
});
