import { it } from "node:test";
import assert from "node:assert/strict";
import { backfillDetail, groupRecovery, recoveryGap } from "../src/model/usage-recovery.js";
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
  assert.match(detail, /3 com leitura incompleta \(2 com total diferente das chamadas, 1 com falha ao ler o histórico\)/);
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
