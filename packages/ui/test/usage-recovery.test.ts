import { it } from "node:test";
import assert from "node:assert/strict";
import { backfillDetail, groupRecovery, reasonLabel, recoveryGap } from "../src/model/usage-recovery.js";
import type { UsageBackfillStatus } from "../src/types.js";

const status: UsageBackfillStatus = { running: false, total: 2, done: 2, calls: 0, failed: 0, startedAt: null, finishedAt: null, error: null };

it("discloses partial enumeration, incomplete histories and unidentified calls", () => {
  const detail = backfillDetail({ ...status, incomplete: 1, skipped: 2, enumerationIncomplete: true });
  assert.match(detail, /Recuperação parcial/);
  assert.match(detail, /0 chamadas novas/);
  assert.match(detail, /1 com leitura incompleta/);
  assert.match(detail, /2 registros sem identificação/);
  assert.match(detail, /lista de conversas não pôde ser lida por inteiro/);
  assert.match(backfillDetail({ ...status, failed: 1 }), /Recuperação parcial/);
});

it("reports the missing portion of a snapshot without duplicating detailed tokens", () => {
  const row = { sessionId: "s", complete: false, reason: null, promptTokens: 100, outputTokens: 50, recordedPromptTokens: 40, recordedOutputTokens: 60 };
  assert.deepEqual(recoveryGap(row), { promptTokens: 60, outputTokens: 0 });
  assert.deepEqual(recoveryGap({ ...row, promptTokens: null, outputTokens: null }), { promptTokens: null, outputTokens: null });
});

it("says why readings stayed incomplete, most frequent first", () => {
  const detail = backfillDetail({ ...status, done: 124, incomplete: 3, failed: 1, reasons: {
    "O acumulado disponível e as chamadas registradas divergem; a leitura pode ser parcial ou desatualizada.": 2,
    "Não foi possível ler todas as chamadas do histórico (o Muse respondeu overloaded).": 1,
  } });
  assert.match(detail, /3 com leitura incompleta: 2 com total diferente das chamadas e 1 com falha ao ler o histórico\./);
  assert.doesNotMatch(detail, /1 com falha de leitura/, "the failed one is already among the incomplete");
});

it("counts each conversation once: read failures are part of the incomplete ones", () => {
  // What build 44 showed: 16 failures (11 + 5) were told inside the 20 and again beside them.
  const detail = backfillDetail({ ...status, total: 138, done: 138, incomplete: 20, failed: 16, reasons: {
    "Não foi possível ler todas as chamadas do histórico (o Muse respondeu internal).": 9,
    "Não foi possível ler todas as chamadas do histórico (o Muse respondeu overloaded).": 2,
    "Não foi possível ler o consumo desta conversa (o Muse respondeu internal).": 5,
    "O histórico disponível não informa as chamadas ao modelo.": 2,
    "O acumulado disponível e as chamadas registradas divergem; a leitura pode ser parcial ou desatualizada.": 2,
  } });
  assert.equal(
    detail,
    "Recuperação parcial: 138 conversas lidas, 0 chamadas novas recuperadas. 20 com leitura incompleta: 16 com falha de leitura (11 ao ler o histórico e 5 ao ler a conversa), 2 sem as chamadas no histórico e 2 com total diferente das chamadas. Veja os dados disponíveis e os limites na página de Uso.",
  );
  assert.equal(detail.match(/16/g)?.length, 1);
});

it("does not promise that recovering again fixes the Muse's internal errors", () => {
  const base = { complete: false, recordedPromptTokens: 0, recordedOutputTokens: 0, cwd: null, deleted: true, title: null, promptTokens: null, outputTokens: null };
  const groups = groupRecovery([
    { ...base, sessionId: "a", reason: "Não foi possível ler todas as chamadas do histórico (o Muse respondeu internal)." },
    { ...base, sessionId: "b", reason: "Não foi possível ler o consumo desta conversa (o Muse respondeu internal)." },
    { ...base, sessionId: "c", reason: "Não foi possível ler todas as chamadas do histórico (o Muse respondeu overloaded)." },
  ]);
  const byReason = Object.fromEntries(groups.map((g) => [g.reason, g.explanation ?? ""]));
  const internal = groups.map((g) => g.reason).filter((r) => r.includes("internal"));
  assert.equal(internal.length, 2);
  for (const reason of internal) {
    assert.match(byReason[reason]!, /erro interno/);
    assert.match(byReason[reason]!, /excluídas ou muito antigas/);
    assert.match(byReason[reason]!, /em geral não resolve/);
    assert.match(byReason[reason]!, /restante do uso não é afetado/);
    assert.doesNotMatch(byReason[reason]!, /pode resolver/);
  }
  const busy = byReason["Não foi possível ler todas as chamadas do histórico (o Muse respondeu overloaded)."]!;
  assert.match(busy, /Recuperar uso de novo pode resolver/);
  assert.match(busy, /Entre parênteses, a resposta do Muse/);
});

it("groups by reason and keeps per-conversation gaps, never pricing them", () => {
  const base = { complete: false, recordedPromptTokens: 0, recordedOutputTokens: 0, cwd: null, deleted: false };
  const groups = groupRecovery([
    { ...base, sessionId: "a", reason: "x", promptTokens: 10, outputTokens: 1, title: "A" },
    { ...base, sessionId: "b", reason: "x", promptTokens: 30, outputTokens: 0, title: "B" },
    { ...base, sessionId: "c", reason: "y", promptTokens: 0, outputTokens: 0, title: "C" },
    { ...base, sessionId: "d", reason: "x", promptTokens: null, outputTokens: null, title: null, deleted: true },
  ]);
  assert.deepEqual(groups.map((g) => [g.reason, g.count, g.entries.length, g.noDifference, g.noTotal]), [["x", 3, 3, 0, 1], ["y", 1, 0, 1, 0]]);
  assert.deepEqual(groups[0]?.entries.map((e) => e.title), ["B", "A", "Conversa excluída"]);
  assert.equal(groups[0]?.promptTokens, 40);
});

it("says the Muse's error codes in Portuguese in the group heading", () => {
  assert.equal(
    reasonLabel("Não foi possível ler todas as chamadas do histórico (o Muse respondeu internal)."),
    "Não foi possível ler todas as chamadas do histórico (erro interno do Muse).",
  );
  assert.equal(reasonLabel("Não foi possível ler o consumo desta conversa (o Muse respondeu weird)."), "Não foi possível ler o consumo desta conversa (código do Muse: weird).");
  assert.equal(reasonLabel("O histórico disponível não informa as chamadas ao modelo."), "O histórico disponível não informa as chamadas ao modelo.");
});
